// Tab Sender — background service worker.
// Maintains the WebSocket connection to the local bridge, relays open/close
// requests between content scripts and the peer browser, and keeps the bridge
// informed of this browser's tab list.

const BRIDGE_WS = "ws://127.0.0.1:18923/ws";
const BRIDGE_HTTP = "http://127.0.0.1:18923";

const L = (...a) => console.log("[tab-sender:bg]", ...a);
const LE = (...a) => console.error("[tab-sender:bg]", ...a);

// Resolve this browser's identity from the user agent. Edge's UA contains
// "Edg/" (note: no "e" before the slash) which is the reliable Edge marker.
function detectBrowser() {
  const ua = self.navigator.userAgent;
  L("userAgent =", ua);
  if (/Edg\//i.test(ua)) return "edge";
  if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return "chrome";
  return "chrome"; // default: assume chrome
}
const SELF = detectBrowser();
L("detected self =", SELF);

// State ---------------------------------------------------------------------
let ws = null;
let connected = false;
let peerTabs = []; // tabs reported by the other browser
let port = null; // single shared long-lived port for popup/sidepanel

// Settings (modifiable from popup). Defaults per the plan.
const DEFAULT_SETTINGS = {
  bgKey: "alt+shift", // background silent open
  fgKey: "alt+ctrl", // foreground raise open
};
let settings = DEFAULT_SETTINGS;

chrome.storage.sync.get(DEFAULT_SETTINGS, (s) => {
  settings = Object.assign({}, DEFAULT_SETTINGS, s);
  L("loaded settings =", settings);
});

function saveSettings(next) {
  settings = Object.assign({}, settings, next);
  chrome.storage.sync.set(settings);
  L("saved settings =", settings);
  // Push updated settings to the UI so it reflects immediately.
  broadcastState();
}

// WebSocket lifecycle -------------------------------------------------------

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  L("connecting to", BRIDGE_WS);
  try {
    ws = new WebSocket(BRIDGE_WS);
  } catch (e) {
    LE("ws construct failed:", e.message);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    connected = true;
    L("ws OPEN; registering as", SELF);
    send({ type: "register", data: { browser: SELF } });
    flushPending(); // deliver any messages queued while ws was down
    pushTabs(); // initial tab list
    broadcastState();
  };

  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch (e) {
      LE("ws onmessage parse error:", e.message, "raw=", ev.data);
      return;
    }
    L("ws <- bridge", msg.type, msg.data || "");
    handleMessage(msg);
  };

  ws.onclose = (ev) => {
    connected = false;
    ws = null;
    L("ws CLOSED code=", ev.code, "reason=", ev.reason);
    broadcastState();
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will fire and schedule a reconnect.
    LE("ws onerror (bridge not running? see netstat :18923)");
    try { ws.close(); } catch {}
  };
}

let reconnectTimer = null;
function scheduleReconnect() {
  if (reconnectTimer) return;
  L("scheduling reconnect in 2s");
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 2000);
}

// Outbound queue: messages sent while the WebSocket isn't open yet (e.g. right
// after the service worker wakes from eviction, before onopen fires) are
// buffered here and flushed once the connection is up. Without this, the FIRST
// click after an idle period is silently dropped — which is why a link needed
// to be clicked twice to take effect on the peer.
const pendingOut = [];
const MAX_PENDING = 50;

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
    L("ws -> bridge", obj.type, obj.data || "");
    return;
  }
  // Not open: queue and ensure a connect is in flight.
  pendingOut.push(obj);
  while (pendingOut.length > MAX_PENDING) {
    const dropped = pendingOut.shift();
    LE("pending queue overflow, dropping", dropped.type);
  }
  L("ws send QUEUED (ws not open); type=", obj.type, "queue_len=", pendingOut.length,
    "ws_state=", ws ? readyLabel(ws.readyState) : "null");
  if (!ws || (ws.readyState !== WebSocket.CONNECTING && ws.readyState !== WebSocket.OPEN)) {
    connect();
  }
}

function readyLabel(s) {
  switch (s) {
    case WebSocket.CONNECTING: return "CONNECTING";
    case WebSocket.OPEN: return "OPEN";
    case WebSocket.CLOSING: return "CLOSING";
    case WebSocket.CLOSED: return "CLOSED";
    default: return String(s);
  }
}

// flushPending delivers queued messages once the WebSocket is open. Must run
// AFTER the register handshake so the bridge (which requires register as the
// first frame) accepts the connection.
function flushPending() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    L("flushPending skip (ws not open)");
    return;
  }
  if (!pendingOut.length) return;
  L("flushing pending queue len=", pendingOut.length);
  while (pendingOut.length) {
    const obj = pendingOut.shift();
    ws.send(JSON.stringify(obj));
    L("ws -> bridge (flushed)", obj.type, obj.data || "");
  }
}

// Inbound message dispatch --------------------------------------------------

function handleMessage(msg) {
  switch (msg.type) {
    case "open-tab": {
      const d = msg.data || {};
      L("opening tab url=", d.url, "focus=", d.focus, "from=", d.source);
      chrome.tabs.create({ url: d.url, active: !!d.focus }, (t) => {
        if (chrome.runtime.lastError) LE("tabs.create error:", chrome.runtime.lastError.message);
        else L("tab created id=", t.id, "url=", t.url);
      });
      break;
    }
    case "close-tab-remote": {
      const d = msg.data || {};
      if (typeof d.tabId === "number") {
        L("closing remote tab id=", d.tabId, "from=", d.source || "?");
        chrome.tabs.remove(d.tabId, () => {
          if (chrome.runtime.lastError) LE("tabs.remove error:", chrome.runtime.lastError.message);
          else L("tab removed id=", d.tabId);
        });
      }
      break;
    }
    case "tabs-update": {
      const before = peerTabs.length;
      peerTabs = (msg.data && msg.data.tabs) || [];
      L("peer tabs updated", before, "->", peerTabs.length);
      broadcastState();
      break;
    }
    default:
      L("unknown message type:", msg.type);
      break;
  }
}

// Outbound: send a URL to the peer browser ---------------------------------

function sendOpenURL(url, focus, target) {
  const data = { url, focus: !!focus, sendTime: Date.now() };
  if (target) data.target = target;
  L("sendOpenURL url=", url, "focus=", focus, "target=", target || "peer");
  send({ type: "open-url", data });
}

function sendCloseTab(tabId, target) {
  const data = { tabId };
  if (target) data.target = target;
  L("sendCloseTab tabId=", tabId, "target=", target || "peer");
  send({ type: "close-tab", data });
}

// Tab list collection & sync ------------------------------------------------

const COLLECT_DEBOUNCE = 400;
let collectTimer = null;

function schedulePushTabs() {
  if (collectTimer) clearTimeout(collectTimer);
  collectTimer = setTimeout(pushTabs, COLLECT_DEBOUNCE);
}

async function pushTabs() {
  if (!connected) { L("pushTabs SKIP (not connected)"); return; }
  try {
    const tabs = await chrome.tabs.query({});
    const slim = tabs
      .filter((t) => !t.url.startsWith("chrome://") && !t.url.startsWith("edge://"))
      .map((t) => ({
        id: t.id,
        url: t.url,
        title: t.title || t.url,
        fav: t.favIconUrl || "",
        incognito: !!t.incognito,
      }));
    L("pushTabs count=", slim.length);
    send({ type: "tabs-update", data: { browser: SELF, tabs: slim } });
  } catch (e) {
    LE("pushTabs error:", e.message);
  }
}

chrome.tabs.onCreated.addListener(() => { L("tabs.onCreated"); schedulePushTabs(); });
chrome.tabs.onUpdated.addListener((id, info, tab) => {
  // Only react to meaningful changes to avoid spamming on favicons, etc.
  if (info.url || info.title || info.status === "complete") {
    L("tabs.onUpdated id=", id, "info=", Object.keys(info).join(","));
    schedulePushTabs();
  }
});
chrome.tabs.onRemoved.addListener((id) => { L("tabs.onRemoved id=", id); schedulePushTabs(); });
chrome.tabs.onAttached.addListener(() => { L("tabs.onAttached"); schedulePushTabs(); });
chrome.tabs.onDetached.addListener(() => { L("tabs.onDetached"); schedulePushTabs(); });

// Content script relay ------------------------------------------------------
// content.js sends { type: 'open-url', url, focus } for Alt+Shift / Alt+Ctrl
// clicks on anchors.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const from = sender && sender.tab ? "tab#" + sender.tab.id : "popup";
  L("msg <-", from, JSON.stringify(msg));
  if (msg && msg.type === "open-url" && typeof msg.url === "string") {
    sendOpenURL(msg.url, !!msg.focus, msg.target || undefined);
    sendResponse({ ok: true });
    return true;
  }
  if (msg && msg.type === "popup-status") {
    sendResponse({ connected, self: SELF, peerTabs, settings });
    return true;
  }
  if (msg && msg.type === "popup-open-tab" && typeof msg.url === "string") {
    L("popup open local tab url=", msg.url);
    chrome.tabs.create({ url: msg.url, active: true });
    sendResponse({ ok: true });
    return true;
  }
  if (msg && msg.type === "popup-close-peer-tab" && typeof msg.tabId === "number") {
    sendCloseTab(msg.tabId, msg.target || undefined);
    sendResponse({ ok: true });
    return true;
  }
  if (msg && msg.type === "save-settings") {
    saveSettings(msg.settings || {});
    sendResponse({ ok: true });
    return true;
  }
  if (msg && msg.type === "open-sidepanel") {
    chrome.sidePanel.open({}).then(() => L("sidepanel opened")).catch((e) => LE("sidepanel open:", e.message));
    sendResponse({ ok: true });
    return true;
  }
  L("unhandled msg type:", msg && msg.type);
  return false;
});

// Context menu: "Send this link to <peer>" / "Send this page to <peer>" ----

function peerName() {
  return SELF === "edge" ? "Chrome" : "Edge";
}

chrome.runtime.onInstalled.addListener(() => {
  L("onInstalled; creating context menus");
  chrome.contextMenus.create({
    id: "send-link-to-peer",
    title: "Send this link to " + peerName() + " (background)",
    contexts: ["link"],
  });
  chrome.contextMenus.create({
    id: "send-link-to-peer-focus",
    title: "Send this link to " + peerName() + " (focus)",
    contexts: ["link"],
  });
  chrome.contextMenus.create({
    id: "send-page-to-peer",
    title: "Send this page to " + peerName() + " (background)",
    contexts: ["page"],
  });
  chrome.contextMenus.create({
    id: "send-page-to-peer-focus",
    title: "Send this page to " + peerName() + " (focus)",
    contexts: ["page"],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  const url = info.linkUrl || info.pageUrl;
  if (!url) return;
  const focus = info.menuItemId.endsWith("focus");
  L("contextMenu", info.menuItemId, "url=", url, "focus=", focus);
  sendOpenURL(url, focus);
});

// Side panel command --------------------------------------------------------

chrome.commands.onCommand.addListener((cmd) => {
  L("command:", cmd);
  if (cmd === "open-sidepanel") {
    chrome.sidePanel.open({}).then(() => L("sidepanel opened via command")).catch((e) => LE("sidepanel open:", e.message));
  }
});

// UI state broadcast to popup/sidepanel -----------------------------------

function broadcastState() {
  if (!port) { L("broadcastState SKIP (no UI port)"); return; }
  try {
    port.postMessage({ type: "state", connected, self: SELF, peerTabs, settings });
    L("broadcastState -> UI connected=", connected, "peerTabs=", peerTabs.length, "settings=", settings);
  } catch (e) {
    LE("broadcastState postMessage failed:", e.message);
  }
}

chrome.runtime.onConnect.addListener((p) => {
  port = p;
  L("UI port connected name=", p.name);
  p.onMessage.addListener((msg) => {
    if (msg && msg.type === "get-state") broadcastState();
  });
  p.onDisconnect.addListener(() => { L("UI port disconnected"); port = null; });
  broadcastState();
});

// Lifecycle: keep alive while connected ------------------------------------
// Service workers are evicted after 30s of inactivity. We keep the WS alive by
// responding to the bridge's ping and by periodic activity from tab events.
// A reconnect-on-alarm ensures we re-establish after eviction.

chrome.alarms.create("keepalive", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => {
  L("alarm:", a.name, "connected=", connected);
  if (!connected) connect();
});

// Kick off on worker start.
L("service worker starting");
connect();

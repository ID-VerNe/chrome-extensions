// Tab Sender — background service worker.
// Maintains the WebSocket connection to the local bridge, relays open/close
// requests between content scripts and the peer browser, and keeps the bridge
// informed of this browser's tab list.

const BRIDGE_WS = "ws://127.0.0.1:18923/ws";
const BRIDGE_HTTP = "http://127.0.0.1:18923";

// Resolve this browser's identity from the user agent. Edge's UA contains
// "Edg/" (note: no "e" before the slash) which is the reliable Edge marker.
function detectBrowser() {
  const ua = self.navigator.userAgent;
  if (/Edg\//i.test(ua)) return "edge";
  if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return "chrome";
  return "chrome"; // default: assume chrome
}
const SELF = detectBrowser();

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
});

function saveSettings(next) {
  settings = Object.assign({}, settings, next);
  chrome.storage.sync.set(settings);
}

// WebSocket lifecycle -------------------------------------------------------

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  try {
    ws = new WebSocket(BRIDGE_WS);
  } catch (e) {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    connected = true;
    send({ type: "register", data: { browser: SELF } });
    pushTabs(); // initial tab list
    broadcastState();
  };

  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    handleMessage(msg);
  };

  ws.onclose = () => {
    connected = false;
    ws = null;
    broadcastState();
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will fire and schedule a reconnect.
    try { ws.close(); } catch {}
  };
}

let reconnectTimer = null;
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 2000);
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// Inbound message dispatch --------------------------------------------------

function handleMessage(msg) {
  switch (msg.type) {
    case "open-tab": {
      const d = msg.data || {};
      chrome.tabs.create({ url: d.url, active: !!d.focus });
      break;
    }
    case "close-tab-remote": {
      const d = msg.data || {};
      if (typeof d.tabId === "number") {
        chrome.tabs.remove(d.tabId, () => void chrome.runtime.lastError);
      }
      break;
    }
    case "tabs-update": {
      peerTabs = (msg.data && msg.data.tabs) || [];
      broadcastState();
      break;
    }
    default:
      break;
  }
}

// Outbound: send a URL to the peer browser ---------------------------------

function sendOpenURL(url, focus, target) {
  const data = { url, focus: !!focus, sendTime: Date.now() };
  if (target) data.target = target;
  send({ type: "open-url", data });
}

function sendCloseTab(tabId, target) {
  const data = { tabId };
  if (target) data.target = target;
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
  if (!connected) return;
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
    send({ type: "tabs-update", data: { browser: SELF, tabs: slim } });
  } catch {
    // service worker may have been suspended mid-query; ignore
  }
}

chrome.tabs.onCreated.addListener(schedulePushTabs);
chrome.tabs.onUpdated.addListener((id, info, tab) => {
  // Only react to meaningful changes to avoid spamming on favicons, etc.
  if (info.url || info.title || info.status === "complete") {
    schedulePushTabs();
  }
});
chrome.tabs.onRemoved.addListener(schedulePushTabs);
chrome.tabs.onAttached.addListener(schedulePushTabs);
chrome.tabs.onDetached.addListener(schedulePushTabs);

// Content script relay ------------------------------------------------------
// content.js sends { type: 'open-url', url, focus } for Alt+Shift / Alt+Ctrl
// clicks on anchors.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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
  return false;
});

// Context menu: "Send this link to <peer>" / "Send this page to <peer>" ----

function peerName() {
  return SELF === "edge" ? "Chrome" : "Edge";
}

chrome.runtime.onInstalled.addListener(() => {
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
  sendOpenURL(url, focus);
});

// Side panel command --------------------------------------------------------

chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === "open-sidepanel") {
    chrome.sidePanel.open({}).catch(() => {});
  }
});

// UI state broadcast to popup/sidepanel -----------------------------------

function broadcastState() {
  if (!port) return;
  try {
    port.postMessage({ type: "state", connected, self: SELF, peerTabs, settings });
  } catch {
    // port may be closed
  }
}

chrome.runtime.onConnect.addListener((p) => {
  port = p;
  p.onMessage.addListener((msg) => {
    if (msg && msg.type === "get-state") broadcastState();
  });
  p.onDisconnect.addListener(() => { port = null; });
  broadcastState();
});

// Lifecycle: keep alive while connected ------------------------------------
// Service workers are evicted after 30s of inactivity. We keep the WS alive by
// responding to the bridge's ping and by periodic activity from tab events.
// A reconnect-on-alarm ensures we re-establish after eviction.

chrome.alarms.create("keepalive", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(() => {
  if (!connected) connect();
});

// Kick off on worker start.
connect();

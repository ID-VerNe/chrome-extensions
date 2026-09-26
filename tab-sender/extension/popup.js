// Tab Sender — popup/sidepanel controller.
// Talks to the background service worker over a long-lived port.

const L = (...a) => console.log("[tab-sender:ui]", ...a);

const state = { connected: false, self: "?", peerTabs: [], settings: { bgKey: "alt+shift", fgKey: "alt+ctrl" } };
let port = null;

function connectPort() {
  port = chrome.runtime.connect({ name: "ui" });
  port.onMessage.addListener((msg) => {
    if (msg && msg.type === "state") {
      L("state <- bg", "connected=", msg.connected, "self=", msg.self, "peerTabs=", (msg.peerTabs || []).length, "settings=", msg.settings);
      Object.assign(state, msg);
      if (!msg.settings) state.settings = { bgKey: "alt+shift", fgKey: "alt+ctrl" };
      render();
      renderSettings();
    }
  });
  port.onDisconnect.addListener(() => {
    L("port disconnected");
    port = null;
    // Popup is short-lived; sidepanel should reconnect.
    setTimeout(connectPort, 500);
  });
  port.postMessage({ type: "get-state" });
}

// Rendering ----------------------------------------------------------------

const $status = document.getElementById("statusText");
const $dot = document.getElementById("dot");
const $self = document.getElementById("selfLabel");
const $list = document.getElementById("tabList");
const $empty = document.getElementById("empty");
const $filter = document.getElementById("filter");
const $openSide = document.getElementById("openSide");
const $bgKeyBtn = document.getElementById("bgKeyBtn");
const $fgKeyBtn = document.getElementById("fgKeyBtn");
const $setHint = document.getElementById("setHint");
const $bgHint = document.getElementById("bgHint");
const $fgHint = document.getElementById("fgHint");

function selfLabel(name) {
  if (name === "edge") return "Edge";
  if (name === "chrome") return "Chrome";
  return name;
}

function render() {
  $dot.classList.remove("ok", "err");
  if (state.connected) {
    $dot.classList.add("ok");
    $status.textContent = "桥梁正常连接";
  } else {
    $dot.classList.add("err");
    $status.textContent = "未连接桥梁";
  }
  const peer = state.self === "edge" ? "Chrome" : state.self === "chrome" ? "Edge" : "?";
  $self.textContent = "本机 " + selfLabel(state.self) + " · 对端 " + peer;

  renderTabs($filter.value.trim());
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return url; }
}

function renderTabs(query) {
  $list.innerHTML = "";
  const q = query.toLowerCase();
  const tabs = (state.peerTabs || []).filter((t) => {
    if (!q) return true;
    return (t.title || "").toLowerCase().includes(q) ||
           (t.url || "").toLowerCase().includes(q);
  });

  if (!tabs.length) {
    $empty.hidden = false;
    $empty.textContent = q ? "没有匹配的标签页" : "对端没有打开的标签页";
    return;
  }
  $empty.hidden = true;

  for (const t of tabs) {
    const li = document.createElement("li");
    li.title = t.url;

    const img = document.createElement("img");
    img.className = "fav";
    img.src = t.fav || faviconFor(t.url);
    img.onerror = () => {
      if (img.src !== FALLBACK_FAV) {
        img.src = FALLBACK_FAV;
      } else {
        img.style.visibility = "hidden";
      }
    };

    const meta = document.createElement("div");
    meta.className = "meta";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = t.title || hostOf(t.url);
    const host = document.createElement("div");
    host.className = "host";
    host.textContent = hostOf(t.url);
    meta.appendChild(title);
    meta.appendChild(host);

    const close = document.createElement("button");
    close.className = "close";
    close.textContent = "×";
    close.title = "远程关闭对端该标签页";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      L("close-peer-tab id=", t.id, "url=", t.url);
      port && port.postMessage({ type: "popup-close-peer-tab", tabId: t.id });
      li.remove();
      if (!$list.children.length) {
        $empty.hidden = false;
        $empty.textContent = $filter.value.trim() ? "没有匹配的标签页" : "对端没有打开的标签页";
      }
    });

    li.appendChild(img);
    li.appendChild(meta);
    li.appendChild(close);
    li.addEventListener("click", () => {
      L("open-local-tab url=", t.url);
      port && port.postMessage({ type: "popup-open-tab", url: t.url });
    });
    $list.appendChild(li);
  }
}

// Local SVG icon fallback (avoids leaking intranet/internal URLs to external services).
const FALLBACK_FAV = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='%23666'%3E%3Cpath d='M8 0a8 8 0 100 16A8 8 0 008 0zm5.9 7H10.1A12.7 12.7 0 009 2.5a6.03 6.03 0 014.9 4.5zM8 2.1c.7 1.3 1.3 3.1 1.5 4.9H6.5C6.7 5.2 7.3 3.4 8 2.1zM2.1 9h3.8c.1 1.8.7 3.6 1.4 4.9A6.03 6.03 0 012.1 9zm3.8-2H2.1A6.03 6.03 0 017 2.5C6.3 3.8 5.8 5.5 5.9 7zm2.2 6.9c-.7-1.3-1.3-3.1-1.5-4.9h3c-.2 1.8-.8 3.6-1.5 4.9zm1-6.9c.1-1.8.7-3.6 1.4-4.9A6.03 6.03 0 0113.9 7h-3.8z'/%3E%3C/svg%3E";

function faviconFor(url) {
  return FALLBACK_FAV;
}

// Settings: keybind recording ------------------------------------------------

// Order modifiers canonically so "shift+alt" and "alt+shift" normalize alike.
const MOD_ORDER = ["ctrl", "alt", "shift", "meta"];
function normalizeCombo(mods) {
  const set = new Set(mods.map((m) => m.toLowerCase()));
  const out = MOD_ORDER.filter((m) => set.has(m));
  return out.join("+");
}
function prettyCombo(combo) {
  return (combo || "").split("+").filter(Boolean).map((p) => {
    switch (p) {
      case "alt": return "Alt";
      case "ctrl": return "Ctrl";
      case "shift": return "Shift";
      case "meta": return "Meta";
      default: return p;
    }
  }).join("+");
}

function renderSettings() {
  const bg = prettyCombo(state.settings.bgKey);
  const fg = prettyCombo(state.settings.fgKey);
  $bgKeyBtn.textContent = bg || "(未设置)";
  $fgKeyBtn.textContent = fg || "(未设置)";
  if ($bgHint) $bgHint.textContent = bg;
  if ($fgHint) $fgHint.textContent = fg;
}

// Start recording on a button. Accumulates modifiers on keydown and finalizes
// on keyup (or Escape / blur to cancel).
function startRecording(btn, keyName) {
  btn.classList.add("recording");
  $setHint.textContent = "录制中… 按住 " + keyName + " 的修饰键组合，松开完成（Esc 取消）";

  const activeMods = new Set();

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      L("recording cancelled");
      cleanup();
      $setHint.textContent = "已取消录制。";
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    if (e.altKey) activeMods.add("alt");
    if (e.ctrlKey) activeMods.add("ctrl");
    if (e.shiftKey) activeMods.add("shift");
    if (e.metaKey) activeMods.add("meta");

    if (activeMods.size > 0) {
      const currentCombo = normalizeCombo(Array.from(activeMods));
      $setHint.textContent = "录制中: " + prettyCombo(currentCombo) + " (松开按键完成，Esc 取消)";
    } else {
      $setHint.textContent = "需要至少一个修饰键（Alt/Ctrl/Shift/Meta）。";
    }
  };

  const onKeyUp = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (activeMods.size > 0) {
      const combo = normalizeCombo(Array.from(activeMods));
      L("recorded", keyName, "=", combo);
      $setHint.textContent = "已设置 " + keyName + " = " + prettyCombo(combo);
      cleanup();
      saveSettingsToBg(keyName === "bgKey" ? { bgKey: combo } : { fgKey: combo });
    }
  };

  function cleanup() {
    btn.classList.remove("recording");
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", cleanup);
  }

  // capture-phase, so the recording sees the key before any inputs do.
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", cleanup);
}

function saveSettingsToBg(patch) {
  const next = Object.assign({}, state.settings, patch);
  state.settings = next;
  renderSettings();
  L("save-settings ->", next);
  port && port.postMessage({ type: "save-settings", settings: next });
}

// Events -------------------------------------------------------------------

$filter.addEventListener("input", () => renderTabs($filter.value.trim()));
if ($openSide) {
  $openSide.addEventListener("click", async () => {
    L("open-sidepanel clicked");
    try {
      if (chrome.sidePanel && typeof chrome.sidePanel.open === "function") {
        const win = await chrome.windows.getCurrent();
        if (win && win.id) {
          await chrome.sidePanel.open({ windowId: win.id });
          window.close();
          return;
        }
      }
    } catch (e) {
      L("direct sidePanel.open failed/unsupported:", e.message);
    }
    chrome.runtime.sendMessage({ type: "open-sidepanel" }, () => void chrome.runtime.lastError);
    window.close();
  });
}
if ($bgKeyBtn) $bgKeyBtn.addEventListener("click", () => startRecording($bgKeyBtn, "bgKey"));
if ($fgKeyBtn) $fgKeyBtn.addEventListener("click", () => startRecording($fgKeyBtn, "fgKey"));

connectPort();

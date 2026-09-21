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
    img.onerror = () => { img.style.visibility = "hidden"; };

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

// Google's favicon service is a reasonable default; falls back via onerror.
function faviconFor(url) {
  const h = hostOf(url);
  if (!h || h === url) return "";
  return "https://www.google.com/s2/favicons?sz=32&domain=" + encodeURIComponent(h);
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

// Start recording on a button. Captures the next keydown with at least one
// modifier; non-modifier keys cancel recording (to avoid binding plain keys).
function startRecording(btn, keyName) {
  btn.classList.add("recording");
  $setHint.textContent = "录制中… 按下 " + keyName + " 的修饰键组合（Esc 取消）";

  const onKey = (e) => {
    if (e.key === "Escape") {
      L("recording cancelled");
      cleanup();
      $setHint.textContent = "已取消录制。";
      return;
    }
    const mods = [];
    if (e.altKey) mods.push("alt");
    if (e.ctrlKey) mods.push("ctrl");
    if (e.shiftKey) mods.push("shift");
    if (e.metaKey) mods.push("meta");
    if (!mods.length) {
      $setHint.textContent = "需要至少一个修饰键（Alt/Ctrl/Shift/Meta）。";
      return; // keep recording
    }
    e.preventDefault();
    e.stopPropagation();
    const combo = normalizeCombo(mods);
    L("recorded", keyName, "=", combo);
    $setHint.textContent = "已设置 " + keyName + " = " + prettyCombo(combo);
    cleanup();
    saveSettingsToBg(keyName === "bgKey" ? { bgKey: combo } : { fgKey: combo });
  };

  function cleanup() {
    btn.classList.remove("recording");
    window.removeEventListener("keydown", onKey, true);
  }
  // capture-phase, so the recording sees the key before the input field does.
  window.addEventListener("keydown", onKey, true);
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
$openSide.addEventListener("click", () => {
  L("open-sidepanel clicked");
  chrome.runtime.sendMessage({ type: "open-sidepanel" }, () => void chrome.runtime.lastError);
  window.close();
});
if ($bgKeyBtn) $bgKeyBtn.addEventListener("click", () => startRecording($bgKeyBtn, "bgKey"));
if ($fgKeyBtn) $fgKeyBtn.addEventListener("click", () => startRecording($fgKeyBtn, "fgKey"));

connectPort();

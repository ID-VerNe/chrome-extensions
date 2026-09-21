// Tab Sender — popup/sidepanel controller.
// Talks to the background service worker over a long-lived port.

const state = { connected: false, self: "?", peerTabs: [], settings: {} };
let port = null;

function connectPort() {
  port = chrome.runtime.connect({ name: "ui" });
  port.onMessage.addListener((msg) => {
    if (msg && msg.type === "state") {
      Object.assign(state, msg);
      render();
    }
  });
  port.onDisconnect.addListener(() => {
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
  const tabs = state.peerTabs.filter((t) => {
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
      port && port.postMessage({ type: "popup-close-peer-tab", tabId: t.id });
      li.remove();
    });

    li.appendChild(img);
    li.appendChild(meta);
    li.appendChild(close);
    li.addEventListener("click", () => {
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
// Events -------------------------------------------------------------------

$filter.addEventListener("input", () => renderTabs($filter.value.trim()));
$openSide.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "open-sidepanel" }, () => void chrome.runtime.lastError);
  window.close();
});

connectPort();

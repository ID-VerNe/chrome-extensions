// Tab Sender — content script.
// Captures modified clicks on anchors and forwards the URL to the background
// service worker to be sent to the peer browser. Shows a lightweight toast.

(function () {
  const SELF_HINT = (() => {
    const ua = navigator.userAgent;
    return /Edg\//i.test(ua) ? "edge" : "chrome";
  })();
  const PEER_LABEL = SELF_HINT === "edge" ? "Chrome" : "Edge";

  // Settings are stored in chrome.storage.sync and mirrored here.
  let settings = { bgKey: "alt+shift", fgKey: "alt+ctrl" };
  chrome.storage.sync.get(settings, (s) => {
    settings = Object.assign({}, settings, s);
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.bgKey) settings.bgKey = changes.bgKey.newValue;
    if (changes.fgKey) settings.fgKey = changes.fgKey.newValue;
  });

  // Parse a combo string like "alt+shift" into a predicate on a MouseEvent.
  function makeMatcher(combo) {
    const parts = (combo || "").toLowerCase().split("+").map((p) => p.trim());
    return (e) => {
      for (const p of parts) {
        switch (p) {
          case "alt": if (!e.altKey) return false; break;
          case "ctrl": case "control": if (!e.ctrlKey) return false; break;
          case "shift": if (!e.shiftKey) return false; break;
          case "meta": case "cmd": if (!e.metaKey) return false; break;
        }
      }
      return true;
    };
  }

  function findAnchor(target) {
    let el = target;
    while (el && el.nodeType === Node.ELEMENT_NODE) {
      if (el.tagName === "A" && el.href) return el;
      el = el.parentElement;
    }
    return null;
  }

  document.addEventListener("click", (e) => {
    // Ignore middle-click and non-primary buttons; let the browser handle them.
    if (e.button !== 0) return;

    const a = findAnchor(e.target);
    if (!a) return;

    const bg = makeMatcher(settings.bgKey);
    const fg = makeMatcher(settings.fgKey);
    const focus = fg(e);
    if (!bg(e) && !focus) return;

    e.preventDefault();
    e.stopPropagation();

    const url = a.href;
    chrome.runtime.sendMessage({ type: "open-url", url, focus }, () => {
      // Swallow runtime.lastError when the service worker is mid-restart.
      void chrome.runtime.lastError;
      showToast(focus);
    });
  }, true); // capture phase: beat site scripts that call stopPropagation

  // Toast UI ---------------------------------------------------------------

  function showToast(focus) {
    const msg = focus
      ? "已在 " + PEER_LABEL + " 打开并置顶"
      : "已在 " + PEER_LABEL + " 后台打开";
    let host = document.getElementById("__tab_sender_toast__");
    if (!host) {
      host = document.createElement("div");
      host.id = "__tab_sender_toast__";
      host.className = "__ts-toast";
      document.documentElement.appendChild(host);
    }
    host.textContent = msg;
    host.classList.remove("__ts-toast-show");
    // force reflow to restart animation
    void host.offsetWidth;
    host.classList.add("__ts-toast-show");
    clearTimeout(host.__tsTimer);
    host.__tsTimer = setTimeout(() => {
      host.classList.remove("__ts-toast-show");
    }, 2200);
  }
})();

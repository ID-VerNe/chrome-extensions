// Tab Sender — content script.
// Captures modified clicks on anchors and forwards the URL to the background
// service worker to be sent to the peer browser. Shows a lightweight toast.

(function () {
  const L = (...a) => console.log("[tab-sender:cs]", ...a);

  const SELF_HINT = (() => {
    const ua = navigator.userAgent;
    return /Edg\//i.test(ua) ? "edge" : "chrome";
  })();
  const PEER_LABEL = SELF_HINT === "edge" ? "Chrome" : "Edge";
  L("injected on", location.href, "self=", SELF_HINT, "peer=", PEER_LABEL);

  // Settings are stored in chrome.storage.sync and mirrored here.
  let settings = { bgKey: "alt+shift", fgKey: "alt+ctrl" };
  chrome.storage.sync.get(settings, (s) => {
    settings = Object.assign({}, settings, s);
    L("loaded settings =", settings);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    let changed = false;
    if (changes.bgKey) { settings.bgKey = changes.bgKey.newValue; changed = true; }
    if (changes.fgKey) { settings.fgKey = changes.fgKey.newValue; changed = true; }
    if (changed) L("settings changed ->", settings);
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

  function describeMods(e) {
    const m = [];
    if (e.altKey) m.push("Alt");
    if (e.ctrlKey) m.push("Ctrl");
    if (e.shiftKey) m.push("Shift");
    if (e.metaKey) m.push("Meta");
    return m.join("+") || "(none)";
  }

  // Evaluate both configured combos against a mouse event.
  function matchCombo(e) {
    const bg = makeMatcher(settings.bgKey)(e);
    const fg = makeMatcher(settings.fgKey)(e);
    return { bg, fg, any: bg || fg };
  }

  function findAnchor(target) {
    let el = target;
    while (el && el.nodeType === Node.ELEMENT_NODE) {
      if (el.tagName === "A" && el.href) return el;
      el = el.parentElement;
    }
    return null;
  }

  // Edge/Chromium route some modified-click defaults through the EARLY mouse
  // events, not through `click`'s default action:
  //   - Alt+click            -> download link
  //   - Ctrl/Meta+click      -> open in new background tab
  //   - Shift+click          -> open in new window
  //   - Alt+Ctrl+click       -> Edge split-screen ("分屏")
  // preventDefault() on `click` alone does NOT cancel those, so the browser
  // still performs its default while we also relay to the peer (hence the
  // "sends to peer AND opens split-screen/new-tab" double action).
  //
  // Fix: suppress the default at pointerdown/mousedown (capture phase, before
  // the browser acts), and only when the target is a link and our combo matches,
  // so normal drags/selections on non-links are unaffected.
  function suppressDefault(e) {
    if (e.button !== 0) return;
    const a = findAnchor(e.target);
    if (!a) return;
    const { any } = matchCombo(e);
    if (!any) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    L(e.type, "suppressed default mods=", describeMods(e), "href=", a.href);
  }

  document.addEventListener("pointerdown", suppressDefault, true);
  document.addEventListener("mousedown", suppressDefault, true);

  document.addEventListener("click", (e) => {
    // Ignore middle-click and non-primary buttons; let the browser handle them.
    if (e.button !== 0) {
      L("click button=", e.button, "(ignored, not primary)");
      return;
    }

    const a = findAnchor(e.target);
    if (!a) {
      // Not a link click; log at debug only to avoid spam.
      return;
    }

    const mods = describeMods(e);
    const { bg, fg } = matchCombo(e);
    const focus = fg;
    L("link click mods=", mods, "href=", a.href, "bgMatch=", bg, "fgMatch=", fg);

    if (!bg && !focus) {
      L("-> no modifier match; letting browser handle. configured bgKey=", settings.bgKey, "fgKey=", settings.fgKey);
      return;
    }

    e.preventDefault();
    e.stopImmediatePropagation();
    L("-> preventDefault+stopImmediatePropagation; sending to bg focus=", focus);

    const url = a.href;
    chrome.runtime.sendMessage({ type: "open-url", url, focus }, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) L("sendMessage lastError:", err.message);
      else L("sendMessage resp=", resp);
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
    L("toast shown:", msg);
  }
})();

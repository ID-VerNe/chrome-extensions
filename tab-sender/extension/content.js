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

  // Parse a combo string like "alt+shift" into a strict predicate on a MouseEvent.
  // Checks that configured modifiers match and unconfigured modifiers are NOT pressed.
  function makeMatcher(combo) {
    const parts = new Set((combo || "").toLowerCase().split("+").map((p) => p.trim()).filter(Boolean));
    if (!parts.size) return () => false;
    const wantAlt = parts.has("alt");
    const wantCtrl = parts.has("ctrl") || parts.has("control");
    const wantShift = parts.has("shift");
    const wantMeta = parts.has("meta") || parts.has("cmd");
    return (e) => {
      return (
        Boolean(e.altKey) === wantAlt &&
        Boolean(e.ctrlKey) === wantCtrl &&
        Boolean(e.shiftKey) === wantShift &&
        Boolean(e.metaKey) === wantMeta
      );
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

  // Safely extract href string from HTML or SVG anchor elements.
  function extractHref(el) {
    if (!el) return "";
    let h = el.href;
    if (typeof h === "object" && h !== null) {
      // SVGAnimatedString support for SVG <a> tags
      h = h.baseVal || h.animVal || "";
    }
    if (typeof h !== "string" || !h) {
      h = (typeof el.getAttribute === "function" && (el.getAttribute("href") || el.getAttribute("xlink:href"))) || "";
    }
    if (typeof h === "string" && h) {
      try {
        const u = new URL(h, document.baseURI);
        // Exclude pseudo-protocols like javascript: which cannot be opened in tabs
        if (u.protocol === "javascript:") return "";
        return u.href;
      } catch {
        if (/^\s*javascript:/i.test(h)) return "";
        return h;
      }
    }
    return "";
  }

  // Evaluate both configured combos against a mouse event.
  function matchCombo(e) {
    const bg = makeMatcher(settings.bgKey)(e);
    const fg = makeMatcher(settings.fgKey)(e);
    return { bg, fg, any: bg || fg };
  }

  function findAnchor(e) {
    // Penetrate Shadow DOM boundaries using composedPath()
    if (e && typeof e.composedPath === "function") {
      const path = e.composedPath();
      for (const el of path) {
        if (el && (el.nodeType === 1 || el.nodeType === (window.Node?.ELEMENT_NODE || 1))) {
          if ((el.tagName || "").toLowerCase() === "a" && extractHref(el)) {
            return el;
          }
        }
      }
    }
    let el = e && e.target ? e.target : e;
    while (el && (el.nodeType === 1 || el.nodeType === (window.Node?.ELEMENT_NODE || 1))) {
      if ((el.tagName || "").toLowerCase() === "a" && extractHref(el)) {
        return el;
      }
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
    const a = findAnchor(e);
    if (!a) return;
    const { any } = matchCombo(e);
    if (!any) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    L(e.type, "suppressed default mods=", describeMods(e), "href=", extractHref(a));
  }

  document.addEventListener("pointerdown", suppressDefault, true);
  document.addEventListener("mousedown", suppressDefault, true);

  document.addEventListener("click", (e) => {
    // Ignore middle-click and non-primary buttons; let the browser handle them.
    if (e.button !== 0) {
      L("click button=", e.button, "(ignored, not primary)");
      return;
    }

    const a = findAnchor(e);
    if (!a) {
      // Not a link click; log at debug only to avoid spam.
      return;
    }

    const mods = describeMods(e);
    const { bg, fg } = matchCombo(e);
    const focus = fg;
    const url = extractHref(a);
    L("link click mods=", mods, "href=", url, "bgMatch=", bg, "fgMatch=", fg);

    if (!bg && !focus) {
      L("-> no modifier match; letting browser handle. configured bgKey=", settings.bgKey, "fgKey=", settings.fgKey);
      return;
    }

    e.preventDefault();
    e.stopImmediatePropagation();
    L("-> preventDefault+stopImmediatePropagation; sending to bg focus=", focus);

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

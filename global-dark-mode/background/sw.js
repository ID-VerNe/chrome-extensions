// src/shared/constants.js
var STORAGE = Object.freeze({
  STATE: "gdm_state",
  // {enabled, brightness, contrast, sepia, darkBg, darkText}
  SITES: "gdm_disabled_sites"
  // string[] 站点 origin 关闭名单
});
var MSG = Object.freeze({
  FETCH: "gdm_fetch"
  // 内容脚本 -> background：代取跨域 CSS
});
var DEFAULTS = Object.freeze({
  enabled: true,
  brightness: 90,
  contrast: 90,
  sepia: 30,
  darkBg: "#241d18",
  darkText: "#e8e0d6"
});
var RANGES = Object.freeze({
  brightness: { min: 50, max: 150, step: 1 },
  contrast: { min: 50, max: 150, step: 1 },
  sepia: { min: 0, max: 100, step: 1 }
});

// src/background/sw.js
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install") {
    await chrome.storage.sync.set({
      [STORAGE.STATE]: { ...DEFAULTS },
      [STORAGE.SITES]: []
    });
  }
});
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "sync") return;
  if (changes[STORAGE.STATE] || changes[STORAGE.SITES]) {
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    const state = changes[STORAGE.STATE] ? changes[STORAGE.STATE].newValue : (await chrome.storage.sync.get(STORAGE.STATE))[STORAGE.STATE] || DEFAULTS;
    const sites = changes[STORAGE.SITES] ? changes[STORAGE.SITES].newValue : (await chrome.storage.sync.get(STORAGE.SITES))[STORAGE.SITES] || [];
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: "gdm_update", state, sites }).catch(() => {
      });
    }
  }
});
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === MSG.FETCH) {
    fetch(msg.url, { credentials: "omit" }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    }).then((text) => sendResponse({ ok: true, text })).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
//# sourceMappingURL=sw.js.map

// Background Service Worker — 全局状态管理 + 跨域 fetch 代理。
// 存储变化通过 chrome.storage.onChanged 广播到所有活跃标签页。

import { STORAGE, MSG, DEFAULTS } from '../shared/constants.js';

// ---- 安装 / 更新 ----
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await chrome.storage.sync.set({
      [STORAGE.STATE]: { ...DEFAULTS },
      [STORAGE.SITES]: [],
    });
  }
});

// ---- 存储变更广播到所有标签页 ----
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync') return;

  if (changes[STORAGE.STATE] || changes[STORAGE.SITES]) {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    const state = changes[STORAGE.STATE]
      ? changes[STORAGE.STATE].newValue
      : (await chrome.storage.sync.get(STORAGE.STATE))[STORAGE.STATE] || DEFAULTS;
    const sites = changes[STORAGE.SITES]
      ? changes[STORAGE.SITES].newValue
      : (await chrome.storage.sync.get(STORAGE.SITES))[STORAGE.SITES] || [];

    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'gdm_update', state, sites }).catch(() => {
        // 内容脚本未就绪，忽略
      });
    }
  }
});

// ---- 跨域 CSS 代理（内容脚本 fetch 受限） ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === MSG.FETCH) {
    fetch(msg.url, { credentials: 'omit' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => sendResponse({ ok: true, text }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // 保持通道打开
  }
});
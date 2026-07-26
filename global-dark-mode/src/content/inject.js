// Content Script 入口 — 使用 darkreader 引擎注入夜间模式。
// 通过 esbuild 打包，将 darkreader 作为 ESM 依赖一并 bundle 进来。

import * as DarkReader from 'darkreader';
import { STORAGE, DEFAULTS } from '../shared/constants.js';
import { originOf, siteDisabled } from '../shared/matching.js';

// ---- 初始化 ----
let state = { ...DEFAULTS };
let disabledSites = [];
let active = false;

function buildTheme(state) {
  return {
    brightness: state.brightness,
    contrast: state.contrast,
    sepia: state.sepia,
    darkSchemeBackgroundColor: state.darkBg,
    darkSchemeTextColor: state.darkText,
  };
}

function apply() {
  const origin = originOf(location.href);
  const disabled = siteDisabled(origin, disabledSites);

  if (!state.enabled || disabled) {
    if (active) {
      DarkReader.disable();
      active = false;
    }
    return;
  }

  if (!active) {
    // 禁用样式表代理和自定义元素代理，因为 injectProxy 的
    // 内联脚本会被部分站点的 CSP 拦截（如 bilibili）。
    // 回退到 RAF 轮询，所有站点都兼容。
    DarkReader.enable(buildTheme(state), {
      disableStyleSheetsProxy: true,
      disableCustomElementRegistryProxy: true,
    });
    active = true;
  } else {
    // 已启用，更新主题
    DarkReader.enable(buildTheme(state), {
      disableStyleSheetsProxy: true,
      disableCustomElementRegistryProxy: true,
    });
  }

  // 部分站点（如 bilibili）CSP 会拦截 darkreader 内部注入的内联脚本，
  // 导致 __darkreader__inlineScriptsAllowed 事件无法触发。
  // 手动分发该事件，使 darkreader 内部状态正常。
  try {
    document.dispatchEvent(new CustomEvent('__darkreader__inlineScriptsAllowed'));
  } catch (e) {
    // 非关键，忽略
  }
}

// ---- 跨域 fetch 代理必须设置 ----
// 添加重试机制：MV3 Service Worker 可能刚被唤醒，第一次消息可能失败。
DarkReader.setFetchMethod(async (url) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'gdm_fetch', url });
      if (resp && resp.ok) {
        return new Response(resp.text, {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'text/css' },
        });
      }
      throw new Error(resp?.error || 'fetch failed');
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
});

// ---- 加载初始状态 ----
async function init() {
  const stored = await chrome.storage.sync.get([STORAGE.STATE, STORAGE.SITES]);
  state = { ...DEFAULTS, ...(stored[STORAGE.STATE] || {}) };
  disabledSites = stored[STORAGE.SITES] || [];
  apply();
}

// ---- 监听存储变化 ----
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes[STORAGE.STATE]) {
    state = { ...DEFAULTS, ...changes[STORAGE.STATE].newValue };
  }
  if (changes[STORAGE.SITES]) {
    disabledSites = changes[STORAGE.SITES].newValue || [];
  }
  apply();
});

// ---- 监听后台直接消息 ----
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'gdm_update') {
    state = { ...DEFAULTS, ...msg.state };
    disabledSites = msg.sites || [];
    apply();
  }
});

init();
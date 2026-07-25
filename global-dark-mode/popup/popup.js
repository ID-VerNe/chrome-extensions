// Popup — 弹出面板：全局开关 + 三项滑块 + 当前站点切换 + 打开选项页。

import { STORAGE, DEFAULTS, RANGES } from '../shared/constants.js';
import { originOf, siteDisabled } from '../shared/matching.js';

const els = {
  toggle: document.getElementById('toggle'),
  statusText: document.getElementById('status-text'),
  brightness: document.getElementById('brightness'),
  contrast: document.getElementById('contrast'),
  sepia: document.getElementById('sepia'),
  bVal: document.getElementById('brightness-val'),
  cVal: document.getElementById('contrast-val'),
  sVal: document.getElementById('sepia-val'),
  siteToggle: document.getElementById('site-toggle'),
  siteLabel: document.getElementById('site-label'),
  openOptions: document.getElementById('open-options'),
};

let state = { ...DEFAULTS };
let disabledSites = [];
let currentOrigin = null;
let isSiteDisabled = false;

async function load() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentOrigin = tab ? originOf(tab.url) : null;

  const stored = await chrome.storage.sync.get([STORAGE.STATE, STORAGE.SITES]);
  state = { ...DEFAULTS, ...(stored[STORAGE.STATE] || {}) };
  disabledSites = stored[STORAGE.SITES] || [];
  isSiteDisabled = siteDisabled(currentOrigin, disabledSites);

  render();
}

function render() {
  els.toggle.checked = state.enabled;
  els.statusText.textContent = state.enabled ? '已开启（全局）' : '已关闭';

  els.brightness.value = state.brightness;
  els.contrast.value = state.contrast;
  els.sepia.value = state.sepia;
  els.bVal.textContent = state.brightness;
  els.cVal.textContent = state.contrast;
  els.sVal.textContent = state.sepia;

  // 调节项在全局关闭时禁用
  const disabled = !state.enabled;
  [els.brightness, els.contrast, els.sepia].forEach((el) => (el.disabled = disabled));

  // 当前站点状态
  if (currentOrigin) {
    els.siteLabel.textContent = currentOrigin;
    els.siteToggle.checked = !isSiteDisabled;
    els.siteToggle.disabled = false;
  } else {
    els.siteLabel.textContent = '当前页面不可用';
    els.siteToggle.checked = false;
    els.siteToggle.disabled = true;
  }
}

async function saveState() {
  await chrome.storage.sync.set({ [STORAGE.STATE]: state });
}

async function saveSites() {
  await chrome.storage.sync.set({ [STORAGE.SITES]: disabledSites });
}

els.toggle.addEventListener('change', () => {
  state.enabled = els.toggle.checked;
  render();
  saveState();
});

function bindSlider(el, valEl, key) {
  el.addEventListener('input', () => {
    state[key] = Number(el.value);
    valEl.textContent = el.value;
  });
  el.addEventListener('change', saveState);
}
bindSlider(els.brightness, els.bVal, 'brightness');
bindSlider(els.contrast, els.cVal, 'contrast');
bindSlider(els.sepia, els.sVal, 'sepia');

els.siteToggle.addEventListener('change', async () => {
  if (!currentOrigin) return;
  const wantEnabled = els.siteToggle.checked; // 勾选=对该站点启用夜间
  isSiteDisabled = !wantEnabled;
  const set = new Set(disabledSites);
  if (wantEnabled) set.delete(currentOrigin);
  else set.add(currentOrigin);
  disabledSites = [...set];
  await saveSites();
});

els.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

// 实时响应外部存储变化（如选项页修改）
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes[STORAGE.STATE]) {
    state = { ...DEFAULTS, ...changes[STORAGE.STATE].newValue };
  }
  if (changes[STORAGE.SITES]) {
    disabledSites = changes[STORAGE.SITES].newValue || [];
    isSiteDisabled = siteDisabled(currentOrigin, disabledSites);
  }
  render();
});

load();

// Options — 高级设置页面：完整参数调节 + 站点关闭名单管理 + 重置默认。

import { STORAGE, DEFAULTS, RANGES } from '../shared/constants.js';
import { originOf, siteDisabled, toggleSite } from '../shared/matching.js';

const els = {
  toggle: document.getElementById('toggle'),
  brightness: document.getElementById('brightness'),
  contrast: document.getElementById('contrast'),
  sepia: document.getElementById('sepia'),
  bVal: document.getElementById('brightness-val'),
  cVal: document.getElementById('contrast-val'),
  sVal: document.getElementById('sepia-val'),
  darkBg: document.getElementById('dark-bg'),
  darkText: document.getElementById('dark-text'),
  resetBtn: document.getElementById('reset'),
  siteList: document.getElementById('site-list'),
  siteInput: document.getElementById('site-input'),
  addBtn: document.getElementById('add-site'),
  noSites: document.getElementById('no-sites'),
};

let state = { ...DEFAULTS };
let disabledSites = [];

async function load() {
  const stored = await chrome.storage.sync.get([STORAGE.STATE, STORAGE.SITES]);
  state = { ...DEFAULTS, ...(stored[STORAGE.STATE] || {}) };
  disabledSites = stored[STORAGE.SITES] || [];
  render();
}

function render() {
  els.toggle.checked = state.enabled;
  els.brightness.value = state.brightness;
  els.contrast.value = state.contrast;
  els.sepia.value = state.sepia;
  els.bVal.textContent = state.brightness;
  els.cVal.textContent = state.contrast;
  els.sVal.textContent = state.sepia;
  els.darkBg.value = state.darkBg;
  els.darkText.value = state.darkText;

  renderSiteList();
}

function renderSiteList() {
  els.siteList.innerHTML = '';
  if (disabledSites.length === 0) {
    els.noSites.style.display = 'block';
    return;
  }
  els.noSites.style.display = 'none';
  for (const origin of disabledSites) {
    const li = document.createElement('li');
    li.textContent = origin;
    const btn = document.createElement('button');
    btn.textContent = '移除';
    btn.className = 'remove-btn';
    btn.addEventListener('click', () => {
      disabledSites = toggleSite(disabledSites, origin, false);
      saveSites();
      renderSiteList();
    });
    li.appendChild(btn);
    els.siteList.appendChild(li);
  }
}

async function saveState() {
  await chrome.storage.sync.set({ [STORAGE.STATE]: state });
}

async function saveSites() {
  await chrome.storage.sync.set({ [STORAGE.SITES]: disabledSites });
}

// 事件绑定
els.toggle.addEventListener('change', () => {
  state.enabled = els.toggle.checked;
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

els.darkBg.addEventListener('change', () => {
  state.darkBg = els.darkBg.value;
  saveState();
});
els.darkText.addEventListener('change', () => {
  state.darkText = els.darkText.value;
  saveState();
});

els.resetBtn.addEventListener('click', async () => {
  state = { ...DEFAULTS };
  await saveState();
  render();
});

els.addBtn.addEventListener('click', () => {
  let val = els.siteInput.value.trim();
  if (!val) return;
  // 尝试补全协议
  if (!/^https?:\/\//i.test(val)) val = 'https://' + val;
  const o = originOf(val);
  if (!o) return;
  disabledSites = toggleSite(disabledSites, o, true);
  saveSites();
  els.siteInput.value = '';
  renderSiteList();
});

els.siteInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') els.addBtn.click();
});

// 实时响应外部存储变化
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes[STORAGE.STATE]) {
    state = { ...DEFAULTS, ...changes[STORAGE.STATE].newValue };
  }
  if (changes[STORAGE.SITES]) {
    disabledSites = changes[STORAGE.SITES].newValue || [];
  }
  render();
});

load();
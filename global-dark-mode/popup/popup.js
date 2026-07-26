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

// src/shared/matching.js
function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
function siteDisabled(currentOrigin2, disabledSites2) {
  if (!currentOrigin2) return false;
  return (disabledSites2 || []).includes(currentOrigin2);
}

// src/popup/popup.js
var els = {
  toggle: document.getElementById("toggle"),
  statusText: document.getElementById("status-text"),
  brightness: document.getElementById("brightness"),
  contrast: document.getElementById("contrast"),
  sepia: document.getElementById("sepia"),
  bVal: document.getElementById("brightness-val"),
  cVal: document.getElementById("contrast-val"),
  sVal: document.getElementById("sepia-val"),
  siteToggle: document.getElementById("site-toggle"),
  siteLabel: document.getElementById("site-label"),
  openOptions: document.getElementById("open-options")
};
var state = { ...DEFAULTS };
var disabledSites = [];
var currentOrigin = null;
var isSiteDisabled = false;
async function load() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentOrigin = tab ? originOf(tab.url) : null;
  const stored = await chrome.storage.sync.get([STORAGE.STATE, STORAGE.SITES]);
  state = { ...DEFAULTS, ...stored[STORAGE.STATE] || {} };
  disabledSites = stored[STORAGE.SITES] || [];
  isSiteDisabled = siteDisabled(currentOrigin, disabledSites);
  render();
}
function render() {
  els.toggle.checked = state.enabled;
  els.statusText.textContent = state.enabled ? "\u5DF2\u5F00\u542F\uFF08\u5168\u5C40\uFF09" : "\u5DF2\u5173\u95ED";
  els.brightness.value = state.brightness;
  els.contrast.value = state.contrast;
  els.sepia.value = state.sepia;
  els.bVal.textContent = state.brightness;
  els.cVal.textContent = state.contrast;
  els.sVal.textContent = state.sepia;
  const disabled = !state.enabled;
  [els.brightness, els.contrast, els.sepia].forEach((el) => el.disabled = disabled);
  if (currentOrigin) {
    els.siteLabel.textContent = currentOrigin;
    els.siteToggle.checked = !isSiteDisabled;
    els.siteToggle.disabled = false;
  } else {
    els.siteLabel.textContent = "\u5F53\u524D\u9875\u9762\u4E0D\u53EF\u7528";
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
els.toggle.addEventListener("change", () => {
  state.enabled = els.toggle.checked;
  render();
  saveState();
});
function bindSlider(el, valEl, key) {
  el.addEventListener("input", () => {
    state[key] = Number(el.value);
    valEl.textContent = el.value;
  });
  el.addEventListener("change", saveState);
}
bindSlider(els.brightness, els.bVal, "brightness");
bindSlider(els.contrast, els.cVal, "contrast");
bindSlider(els.sepia, els.sVal, "sepia");
els.siteToggle.addEventListener("change", async () => {
  if (!currentOrigin) return;
  const wantEnabled = els.siteToggle.checked;
  isSiteDisabled = !wantEnabled;
  const set = new Set(disabledSites);
  if (wantEnabled) set.delete(currentOrigin);
  else set.add(currentOrigin);
  disabledSites = [...set];
  await saveSites();
});
els.openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
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
//# sourceMappingURL=popup.js.map

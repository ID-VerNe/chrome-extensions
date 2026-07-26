// 共享常量：存储键、消息类型、默认配置。
// 所有入口（content / background / popup / options）都通过 esbuild 打包此模块。

export const STORAGE = Object.freeze({
  STATE: 'gdm_state', // {enabled, brightness, contrast, sepia, darkBg, darkText}
  SITES: 'gdm_disabled_sites', // string[] 站点 origin 关闭名单
});

export const MSG = Object.freeze({
  FETCH: 'gdm_fetch', // 内容脚本 -> background：代取跨域 CSS
});

// 默认配置：暖色调深褐。
// darkreader 的 brightness/contrast/sepia 均为百分比；sepia 即色温（越大越暖）。
export const DEFAULTS = Object.freeze({
  enabled: true,
  brightness: 90,
  contrast: 90,
  sepia: 30,
  darkBg: '#241d18',
  darkText: '#e8e0d6',
});

// 调节参数范围，供 UI 滑块使用。
export const RANGES = Object.freeze({
  brightness: { min: 50, max: 150, step: 1 },
  contrast: { min: 50, max: 150, step: 1 },
  sepia: { min: 0, max: 100, step: 1 },
});

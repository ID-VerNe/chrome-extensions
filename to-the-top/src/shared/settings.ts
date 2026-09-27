/**
 * Shared settings module — consumed by both content script and options page.
 *
 * No Background Service Worker. Both contexts read/write `chrome.storage.sync`
 * directly. `storage.onChanged` propagates option edits to open tabs in real time.
 */

export type IconStyle = 'arrow-up' | 'chevron-up' | 'circle-arrow' | 'rounded-arrow'
export type CornerStyle = 'auto' | 'square' | 'soft' | 'pill'
export type VisualStyle = 'auto' | 'flat' | 'elevated'
export type ThemeMode = 'auto' | 'light' | 'dark'
export type InjectionMode = 'auto' | 'floating' | 'toolbar'

export interface ExtensionSettings {
  enabled: boolean
  /** URL patterns where the extension is disabled (supports `*.example.com`). */
  disabledSites: string[]
  themeMode: ThemeMode
  iconStyle: IconStyle
  /** Opacity 0–100. */
  opacity: number
  /** Custom primary color (hex) or `'auto'` to extract from the page. */
  primaryColor: 'auto' | string
  injectionMode: InjectionMode
  /** Button corner radius style. */
  cornerStyle: CornerStyle
  /** Button material / shadow style. */
  visualStyle: VisualStyle
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: true,
  disabledSites: [],
  themeMode: 'auto',
  iconStyle: 'arrow-up',
  opacity: 80,
  primaryColor: 'auto',
  injectionMode: 'auto',
  cornerStyle: 'auto',
  visualStyle: 'auto',
}

/**
 * Check if a hostname is in the disabled list. Supports wildcard `*.example.com`.
 */
export function isSiteDisabled(
  hostname: string,
  disabledSites: string[],
): boolean {
  return disabledSites.some((pattern) => {
    if (pattern === hostname) return true
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1) // `.example.com`
      return hostname.endsWith(suffix)
    }
    return false
  })
}

/**
 * Load settings from `storage.sync`, merged over defaults so missing keys
 * (e.g. new options added after an install) always have sane values.
 */
export async function loadSettings(): Promise<ExtensionSettings> {
  const { settings } = await chrome.storage.sync.get('settings')
  return { ...DEFAULT_SETTINGS, ...(settings as Partial<ExtensionSettings> | undefined) }
}

/**
 * Save settings to `storage.sync`.
 */
export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.sync.set({ settings })
}

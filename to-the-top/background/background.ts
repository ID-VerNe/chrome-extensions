/**
 * Background Service Worker.
 *
 * Responsibilities:
 *   - Manage default settings on install
 *   - Store/retrieve whitelist and preferences via chrome.storage
 *   - Handle messages from content script and options page
 */

export interface ExtensionSettings {
  enabled: boolean
  disabledSites: string[] // URL patterns where the extension is disabled
  /** 'auto' | 'light' | 'dark' */
  themeMode: 'auto' | 'light' | 'dark'
  /** 'arrow-up' | 'chevron-up' | 'circle-arrow' | 'rounded-arrow' */
  iconStyle: 'arrow-up' | 'chevron-up' | 'circle-arrow' | 'rounded-arrow'
  /** Opacity 0–100 */
  opacity: number
  /** Custom primary color (hex) or 'auto' */
  primaryColor: 'auto' | string
  /** Button injection mode: 'auto' | 'floating' | 'toolbar' */
  injectionMode: 'auto' | 'floating' | 'toolbar'
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: true,
  disabledSites: [],
  themeMode: 'auto',
  iconStyle: 'arrow-up',
  opacity: 80,
  primaryColor: 'auto',
  injectionMode: 'auto',
}

/**
 * Get the current hostname from the active tab URL.
 */
export function getCurrentHost(): string {
  return window.location.hostname
}

/**
 * Check if a given hostname is in the disabled list (supports wildcard patterns).
 */
export function isSiteDisabled(
  hostname: string,
  disabledSites: string[],
): boolean {
  return disabledSites.some((pattern) => {
    // Exact match
    if (pattern === hostname) return true
    // Wildcard: *.example.com
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1) // .example.com
      return hostname.endsWith(suffix)
    }
    return false
  })
}

/**
 * Get settings from storage.
 */
export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.sync.get('settings')
  if (result.settings) {
    return { ...DEFAULT_SETTINGS, ...result.settings }
  }
  return DEFAULT_SETTINGS
}

/**
 * Save settings to storage.
 */
export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.sync.set({ settings })
}

// --- Bootstrap ---

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.sync.get('settings')
  if (!settings) {
    await chrome.storage.sync.set({ settings: DEFAULT_SETTINGS })
  }
})

// Listen for messages from content script or options page
chrome.runtime.onMessage.addListener(
  (
    message: { type: string },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => {
    if (message.type === 'GET_SETTINGS') {
      getSettings().then(sendResponse)
      return true // Keep channel open for async response
    }
    return false
  },
)
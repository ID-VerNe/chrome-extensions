/**
 * Content Script — Main Entry Point
 *
 * Orchestration flow:
 *   0. Load settings; bail if disabled or site is blacklisted
 *   1. Detect if page already has a back-to-top button → skip if yes
 *   2. Extract page colors (primary + scheme), honoring user overrides
 *   3. Resolve visual config (corner + material): heuristic → site preset → user override
 *   4. Detect right toolbar → inject as toolbar item, else floating
 *   5. Attach scroll visibility + click handler
 *   6. Watch for SPA route changes + storage changes → re-run
 */

import { detectExistingTopButton } from './detector'
import { getPageColors } from './color'
import {
  detectRightToolbar,
  injectButton,
  removeButton,
  type ButtonConfig,
  type InjectionMode,
} from './injector'
import { setupScrollVisibility, attachClickHandler } from './animator'
import { getVisualConfig } from './form'
import { loadSettings, isSiteDisabled } from '../shared/settings'

// Track current state for cleanup / re-injection
let currentButton: HTMLElement | null = null
let currentCleanup: (() => void) | null = null
// Generation token: guards against overlapping init() runs when SPA nav and
// storage.onChanged fire near-simultaneously.
let gen = 0

/**
 * Main init: detect → decide → inject.
 */
async function init(): Promise<void> {
  // Snapshot the generation; if a newer init() started, this run is stale.
  const myGen = ++gen
  // Cleanup previous state (for SPA re-runs)
  cleanup()

  // Step 0: Load settings; bail if disabled or site is blacklisted
  const settings = await loadSettings()
  if (myGen !== gen) return // stale
  if (!settings.enabled) return
  if (isSiteDisabled(location.hostname, settings.disabledSites)) return

  // Step 1: Detect existing button
  const existing = await detectExistingTopButton()
  if (myGen !== gen) return // stale
  if (existing.hasExistingButton) {
    return // Page already has one — do nothing
  }

  // Step 2: Extract page colors (with user overrides)
  const pageColors = getPageColors(settings)

  // Step 3: Resolve visual config
  const visual = getVisualConfig(settings, location.hostname)

  // Step 4: Resolve injection mode
  let mode: InjectionMode
  let toolbarParent: HTMLElement | undefined

  if (settings.injectionMode === 'floating') {
    mode = 'floating'
  } else if (settings.injectionMode === 'toolbar') {
    mode = 'toolbar'
    toolbarParent = detectRightToolbar() ?? undefined
    // User explicitly chose toolbar-only; if there's no toolbar, don't inject.
    if (!toolbarParent) return
  } else {
    // 'auto' — toolbar if available, else floating
    const toolbar = detectRightToolbar()
    if (toolbar) {
      mode = 'toolbar'
      toolbarParent = toolbar
    } else {
      mode = 'floating'
    }
  }

  // Step 5: Inject button
  const config: ButtonConfig = {
    mode,
    pageColors,
    toolbarParent,
    iconStyle: settings.iconStyle,
    visual,
  }
  const button = injectButton(config)
  if (myGen !== gen) {
    // A newer init() won mid-flight; clean up our button and bail.
    removeButton(button)
    return
  }
  currentButton = button

  // Step 6: Attach behavior with lazy re-detection
  // Re-run detection when the user is about to see our button,
  // to catch lazily-appearing native buttons (e.g. Bilibili, Twitter)
  const visibilityCtrl = setupScrollVisibility(button, {
    visibleOpacity: settings.opacity / 100,
    onBeforeShow: async () => {
      const recheck = await detectExistingTopButton()
      return recheck.hasExistingButton
    },
    onAbort: () => {
      // Guard: only cleanup if WE are the current init instance
      if (currentCleanup === myCleanup) cleanup()
    },
  })
  const detachClick = attachClickHandler(button, () => {
    visibilityCtrl.hideUntilManualScroll()
  })

  // Bind cleanup closure before assigning to module-level var
  const myCleanup = () => {
    visibilityCtrl.disconnect()
    detachClick()
    removeButton(button)
  }
  currentCleanup = myCleanup
}

/**
 * Clean up everything.
 */
function cleanup(): void {
  if (currentCleanup) {
    currentCleanup()
    currentCleanup = null
  }
  currentButton = null
}

/**
 * Set up SPA route change detection.
 * Re-runs init() when the URL changes or the DOM gets a major overhaul.
 */
function setupSPAWatcher(): () => void {
  const cleanups: (() => void)[] = []

  // History API interception
  const originalPushState = history.pushState.bind(history)
  const originalReplaceState = history.replaceState.bind(history)

  const onUrlChange = () => {
    // Debounce: wait for DOM to settle
    clearTimeout((onUrlChange as any)._timer)
    ;(onUrlChange as any)._timer = setTimeout(() => {
      init()
    }, 500)
  }

  history.pushState = function (...args) {
    originalPushState(...args)
    onUrlChange()
  }
  history.replaceState = function (...args) {
    originalReplaceState(...args)
    onUrlChange()
  }

  window.addEventListener('popstate', onUrlChange)
  cleanups.push(() => {
    history.pushState = originalPushState
    history.replaceState = originalReplaceState
    window.removeEventListener('popstate', onUrlChange)
  })

  // MutationObserver for heavy DOM changes
  let observerTimer: ReturnType<typeof setTimeout> | null = null
  const observer = new MutationObserver(() => {
    if (observerTimer) clearTimeout(observerTimer)
    observerTimer = setTimeout(() => {
      // Only re-run if the button is gone or DOM changed significantly
      if (currentButton && !document.body.contains(currentButton)) {
        init()
      }
    }, 2000) // Longer debounce — only fire after 2s of inactivity
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: false,
  })
  cleanups.push(() => observer.disconnect())

  return () => {
    for (const c of cleanups) c()
  }
}

// Boot

const boot = () => {
  init().then(() => { /* setupSPAWatcher called once at boot */ })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true })
} else {
  boot()
}

// SPA watcher — set up ONCE at boot time, not inside init()
setupSPAWatcher()

// React to settings changes from the options page — re-run init() so toggles,
// blacklist edits, and visual overrides apply to already-open tabs live.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    init()
  }
})

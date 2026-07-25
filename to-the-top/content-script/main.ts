/**
 * Content Script — Main Entry Point
 *
 * Orchestration flow:
 *   1. Detect if page already has a back-to-top button → skip if yes
 *   2. Extract page colors (primary + scheme)
 *   3. Detect right toolbar → inject as toolbar item
 *   4. No toolbar → inject floating button (bottom-right)
 *   5. Attach scroll visibility + click handler
 *   6. Watch for SPA route changes → re-detect
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
import {
  setupScrollVisibility,
  attachClickHandler,
} from './animator'

// Track current state for cleanup / re-injection
let currentButton: HTMLElement | null = null
let currentCleanup: (() => void) | null = null

/**
 * Main init: detect → decide → inject.
 */
async function init(): Promise<void> {
  // Cleanup previous state (for SPA re-runs)
  cleanup()

  // Step 1: Detect existing button
  const existing = await detectExistingTopButton()
  if (existing.hasExistingButton) {
    return // Page already has one — do nothing
  }

  // Step 2: Extract page colors
  const pageColors = getPageColors()

  // Step 3: Detect toolbar
  const toolbar = detectRightToolbar()

  let mode: InjectionMode
  let toolbarParent: HTMLElement | undefined

  if (toolbar) {
    mode = 'toolbar'
    toolbarParent = toolbar
  } else {
    mode = 'floating'
  }

  // Step 4: Inject button
  const config: ButtonConfig = { mode, pageColors, toolbarParent }
  const button = injectButton(config)
  currentButton = button

  // Step 5: Attach behavior with lazy re-detection
  // Re-run detection when the user is about to see our button,
  // to catch lazily-appearing native buttons (e.g. Bilibili, Twitter)
  const visibilityCtrl = setupScrollVisibility(button, {
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

// ⚡ Boot

// Run on initial load
const boot = () => {
  init().then(() => { /* setupSPAWatcher called once at boot */ })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true })
} else {
  boot()
}

// SPA watcher — set up ONCE at boot time, not inside init()
// This avoids stacking multiple history wrappers and MutationObservers.
setupSPAWatcher()
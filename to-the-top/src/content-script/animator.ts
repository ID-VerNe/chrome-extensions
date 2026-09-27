/**
 * Scroll-to-top animation and button visibility controller.
 *
 * Responsibilities:
 *   - Smooth scroll to top on click
 *   - Button fade-in/fade-out based on scroll position (pure opacity transition,
 *     no translate — the injector owns the `transition: opacity` rule)
 *   - Button hover/click animation effects
 */

/**
 * Smoothly scroll the page to the top with a customizable animation.
 */
export function scrollToTop(): void {
  window.scrollTo({
    top: 0,
    behavior: 'smooth',
  })
}

/**
 * Inject the press keyframe. Fade is driven by the injector's `transition:
 * opacity`, so no fade keyframes here. The press is a gentle, overshoot-free
 * scale-down and back — reads as "press" on both flat and Material-style sites.
 */
function createButtonClickAnimation(): HTMLStyleElement {
  const style = document.createElement('style')
  style.textContent = `
    @keyframes sbt-press {
      0% { transform: scale(1); }
      50% { transform: scale(0.92); }
      100% { transform: scale(1); }
    }
  `
  return style
}

/**
 * Play the "press" animation when button is clicked.
 */
function animatePress(btn: HTMLElement): void {
  btn.style.animation = 'sbt-press 0.2s ease-out'
  btn.addEventListener(
    'animationend',
    () => {
      btn.style.animation = ''
    },
    { once: true },
  )
}

/**
 * Setup intersection tracking for the top of the page.
 * When the top anchor is visible → hide button.
 * Otherwise → show button.
 *
 * Optionally accepts a recheck function: right before showing the button,
 * call recheck(). If it returns true, the button is removed and the
 * visibility controller disconnects itself (defers to native button).
 */
export function setupScrollVisibility(
  button: HTMLElement,
  options?: {
    scrollThreshold?: number
    /** Opacity (0–1) the button settles at when visible. */
    visibleOpacity?: number
    onBeforeShow?: () => boolean | Promise<boolean> // return true = native found, abort
    onAbort?: () => void // called when aborted due to native detection
  },
): { disconnect: () => void; hideUntilManualScroll: () => void } {
  const threshold = options?.scrollThreshold ?? window.innerHeight * 1.5
  const visibleOpacity = options?.visibleOpacity ?? 1

  // Inject animation keyframes
  document.head.appendChild(createButtonClickAnimation())

  let visible = false
  let disconnected = false
  // Lock mechanism: when the user clicks to scroll to top, prevent the button
  // from reappearing during the smooth-scroll journey.
  let lockUntilThresholdCycle = false
  // Tracks whether the user has scrolled ABOVE the threshold at least once
  // since the lock was set. Only then can the lock be released.
  let hasBeenAboveThresholdSinceLock = false
  // Guards against concurrent onBeforeShow promises during rapid scrolling
  let detectionInflight = false

  const onScroll = () => {
    if (disconnected) return

    const nowPast = window.scrollY > threshold

    // If we're above the threshold (scrolled up), mark the crossing
    if (!nowPast) {
      hasBeenAboveThresholdSinceLock = true
    }

    const shouldShow = nowPast

    if (shouldShow && !visible) {
      // If locked and user hasn't scrolled above threshold since lock,
      // keep hidden
      if (lockUntilThresholdCycle && !hasBeenAboveThresholdSinceLock) {
        return
      }
      // Lock satisfied — clear it
      lockUntilThresholdCycle = false

      // Re-check for native button before showing ours
      if (options?.onBeforeShow) {
        // Guard: skip if a detection is already in-flight
        const result = options.onBeforeShow()
        if (result instanceof Promise) {
          if (detectionInflight) return
          detectionInflight = true
          result.then((nativeFound) => {
            detectionInflight = false
            if (nativeFound) {
              if (!disconnected) {
                disconnected = true
                options.onAbort?.()
              }
            } else {
              showButton()
            }
          })
          return
        } else if (result) {
          if (!disconnected) {
            disconnected = true
            options.onAbort?.()
          }
          return
        }
      }
      showButton()
    } else if (!shouldShow && visible) {
      hideButton()
    }
  }

  function showButton(): void {
    if (disconnected) return
    visible = true
    button.style.opacity = String(visibleOpacity)
    button.style.pointerEvents = 'auto'
  }

  function hideButton(): void {
    visible = false
    button.style.opacity = '0'
    button.style.pointerEvents = 'none'
  }

  // Set initial state
  button.style.opacity = '0'
  button.style.pointerEvents = 'none'

  // Throttled scroll listener
  let ticking = false
  const throttledScroll = () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        onScroll()
        ticking = false
      })
      ticking = true
    }
  }

  window.addEventListener('scroll', throttledScroll, { passive: true })

  // Run once on init
  onScroll()

  return {
    disconnect: () => {
      disconnected = true
      window.removeEventListener('scroll', throttledScroll)
    },
    /**
     * Lock the button from showing again until the user manually scrolls
     * back past the threshold. Call this when the user clicks to top.
     */
    hideUntilManualScroll: () => {
      visible = false
      lockUntilThresholdCycle = true
      hasBeenAboveThresholdSinceLock = false
      button.style.opacity = '0'
      button.style.pointerEvents = 'none'
    },
  }
}

/**
 * Attach click handler: animate, then scroll to top.
 *
 * The scroll visibility controller (setupScrollVisibility) is the single source
 * of truth for show/hide. Click just triggers the press animation + smooth scroll,
 * then notifies the visibility controller to lock.
 */
export function attachClickHandler(
  button: HTMLElement,
  onHide?: () => void,
): () => void {
  const onClick = (e: MouseEvent) => {
    e.preventDefault()
    animatePress(button)
    // Immediately hide and lock until user manually rescrolls
    onHide?.()
    scrollToTop()
  }

  button.addEventListener('click', onClick)

  return () => {
    button.removeEventListener('click', onClick)
  }
}
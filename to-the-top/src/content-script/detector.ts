/**
 * Detects whether the page already has a built-in "back to top" button.
 *
 * Strategy — three layers:
 *   1. CSS selector matching (class/id patterns)
 *   2. Text content matching (TreeWalker over text nodes)
 *   3. Behavior verification (click interception, check if scrollY → 0)
 */

const SELECTOR_PATTERNS = [
  // class-based
  '[class*="back-to-top"]',
  '[class*="backtotop"]',
  '[class*="back-top"]',    // Bilibili, common pattern
  '[class*="scroll-top"]',
  '[class*="scrolltop"]',
  '[class*="go-top"]',
  '[class*="gotop"]',
  '[class*="to-top"]',
  '[class*="totop"]',
  '[class*="return-top"]',
  '[class*="btn-top"]',     // Common
  '[class*="top-btn"]',     // Common
  // id-based
  '[id*="back-to-top"]',
  '[id*="backtotop"]',
  '[id*="back-top"]',
  '[id*="scroll-top"]',
  '[id*="go-top"]',
  '[id*="gotop"]',
  '[id*="to-top"]',
  // href-based
  'a[href="#"]',
  'a[href="#top"]',
  'a[href="#0"]',
  // compound class (e.g. class="scroll top") — inspired by Maxun's pagination detector
  '[class*="scroll"][class*="top"]',
  // aria
  '[aria-label*="top" i]',
  '[title*="top" i]',
]

const TEXT_PATTERNS = [
  '回到顶部',
  '回到頂部',
  '回顶部',
  'back to top',
  'scroll to top',
]

const ARROW_CHARS = ['▲', '△', '↑', '⇧', '⇪', '⬆']

/** CSS position values that suggest a floating/overlay element (likely a back-to-top button) */
const FLOATING_POSITIONS = new Set(['fixed', 'sticky'])

/** Navigation-like roles/containers to exclude from candidate matching */
const NAVIGATION_ROLES = new Set(['navigation', 'menu', 'menubar', 'tablist', 'toolbar'])

/** Navigation-like tags to exclude */
const NAVIGATION_TAGS = new Set(['nav', 'header', 'menu'])

/**
 * Collect candidate elements using CSS selector matching.
 */
function collectSelectorCandidates(): Set<Element> {
  const candidates = new Set<Element>()
  for (const sel of SELECTOR_PATTERNS) {
    try {
      const els = document.querySelectorAll(sel)
      for (const el of els) candidates.add(el)
    } catch {
      // skip invalid selectors
    }
  }
  return candidates
}

/**
 * Collect candidate elements by scanning text content with a TreeWalker.
 */
function collectTextCandidates(): Set<Element> {
  const candidates = new Set<Element>()
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
  )

  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const text = node.textContent?.trim() ?? ''

    // Check text patterns
    const lower = text.toLowerCase()
    const matchesText = TEXT_PATTERNS.some((p) => lower.includes(p))

    // Check arrow characters
    const matchesArrow = ARROW_CHARS.some((c) => text.includes(c))

    if (matchesText || matchesArrow) {
      const parent = node.parentElement
      if (parent && isClickable(parent)) {
        candidates.add(parent)
      }
    }
  }

  return candidates
}

/**
 * Heuristic: is this element likely clickable (button, anchor, or has cursor/click)?
 */
function isClickable(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  if (tag === 'a' || tag === 'button') return true
  const role = el.getAttribute('role')
  if (role === 'button' || role === 'link') return true
  const style = getComputedStyle(el)
  if (style.cursor === 'pointer') return true
  return false
}

/**
 * Check if element is inside a navigation-like container.
 * A real back-to-top button is always page-level, not embedded in nav/menu/tabs.
 */
function isInsideNavigation(el: Element): boolean {
  let current: Element | null = el
  while (current) {
    const tag = current.tagName.toLowerCase()
    if (NAVIGATION_TAGS.has(tag)) return true
    const role = current.getAttribute('role')?.toLowerCase()
    if (role && NAVIGATION_ROLES.has(role)) return true
    current = current.parentElement
  }
  return false
}

/**
 * Check if an element has back-to-top affordances:
 * - Contains arrow characters or an up-arrow SVG
 * - Has aria-label / title containing "top"
 */
function hasTopAffordance(el: Element): boolean {
  // Check aria-label / title
  const label = (el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase()
  if (label.includes('top') || label.includes('back') || label.includes('scroll') || label.includes('回到顶部') || label.includes('回顶部')) return true

  // Check text content for arrow chars
  const text = el.textContent || ''
  for (const ch of ARROW_CHARS) {
    if (text.includes(ch)) return true
  }

  // Check for inline up-arrow SVG
  const svg = el.querySelector('svg')
  if (svg) {
    const svgAttrs = svg.outerHTML.toLowerCase()
    // Look for upward-pointing path patterns
    if (svgAttrs.includes('d="m') && (svgAttrs.includes('v-') || svgAttrs.includes('v0'))) {
      // Many up-arrow SVGs contain a vertical line going up: M12 20V5
      if (/d="[^"]*[Mm]\s*\d+\s+\d+\s*[Vv]\s*-/.test(svgAttrs)) return true
    }
  }

  return false
}

/**
 * Check if an element is a likely back-to-top button based on position.
 * Real back-to-top buttons are floating (fixed/sticky) near the bottom-right.
 */
function isLikelyFloatingButton(el: Element): boolean {
  const style = getComputedStyle(el)
  if (!FLOATING_POSITIONS.has(style.position)) return false
  const rect = el.getBoundingClientRect()
  const viewportH = window.innerHeight
  const viewportW = window.innerWidth
  // Must be in bottom 40% of viewport AND right 40%
  const isNearBottom = rect.bottom > viewportH * 0.6
  const isNearRight = rect.right > viewportW * 0.6
  // And small (button-sized, not sidebar-sized)
  const isSmall = rect.width < 100 && rect.height < 100
  return isNearBottom && isNearRight && isSmall
}

/**
 * Score a candidate: higher = more likely to be a real back-to-top button.
 */
function scoreCandidate(el: Element): number {
  let score = 0
  const style = getComputedStyle(el)
  const rect = el.getBoundingClientRect()
  const viewportH = window.innerHeight
  const viewportW = window.innerWidth

  // +2 for floating position near bottom-right
  if (FLOATING_POSITIONS.has(style.position)) {
    score += 1
    if (rect.bottom > viewportH * 0.6 && rect.right > viewportW * 0.6) score += 1
  }

  // +2 for explicit top affordance
  if (hasTopAffordance(el)) score += 2

  // +1 for being small (button-sized, < 80px)
  if (rect.width < 80 && rect.height < 80) score += 1

  // +1 for specific class/id containing "back-to-top" or "go-top"
  const className = (el.className || '').toLowerCase()
  const id = (el.id || '').toLowerCase()
  if (className.includes('back') || id.includes('back') || className.includes('go-top') || id.includes('go-top')) score += 1

  // -2 if inside navigation/menu
  if (isInsideNavigation(el)) score -= 2

  // -2 if inside header
  let parent: Element | null = el
  while (parent) {
    if (parent.tagName.toLowerCase() === 'header') { score -= 2; break }
    parent = parent.parentElement
  }

  return score
}

/**
 * Safe behavior verification — checks if clicking the element scrolls to top
 * WITHOUT causing real side effects (navigation, new tab, etc.).
 *
 * For a[href="#"] — NOT unconditionally trusted. Must have additional
 * affordance signals (arrow, aria-label, floating position) first.
 */
function verifyBehavior(el: Element): Promise<boolean> {
  // For anchor elements: only short-circuit if the element ALSO has
  // top-affordance signals (arrow icon, aria-label, floating position, etc.)
  if (el.tagName.toLowerCase() === 'a') {
    const href = (el as HTMLAnchorElement).getAttribute('href') || ''
    const isTopAnchor = ['#', '#top', '#0'].includes(href) || href.endsWith('#') || href.endsWith('#top')
    if (isTopAnchor) {
      // Require at least one additional signal before trusting unconditionally
      if (hasTopAffordance(el) || isLikelyFloatingButton(el)) {
        return Promise.resolve(true)
      }
      // Fall through to click probe for unlabeled href="#" elements
    }
  }

  // Check inline onclick handlers for scroll references
  const onclick = el.getAttribute('onclick')
  if (onclick) {
    const sig = onclick.replace(/\s+/g, '').toLowerCase()
    if (sig.includes('scrolltop') || sig.includes('scrollto(0') || sig.includes('scrollto(0,0)') || sig.includes('scrollingintoview')) {
      return Promise.resolve(true)
    }
  }

  // Safe click probe — intercept and preventDefault so real navigation doesn't happen
  return new Promise((resolve) => {
    const scrollYBefore = window.scrollY
    if (scrollYBefore < 10) {
      resolve(false)
      return
    }

    let handled = false

    const handler = (e: Event) => {
      if (handled) return
      handled = true
      e.preventDefault()
      el.removeEventListener('click', handler, { capture: true })

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const scrolledUp = window.scrollY < scrollYBefore - 50
          resolve(scrolledUp)
        })
      })
    }

    el.addEventListener('click', handler, { capture: true })
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    setTimeout(() => {
      if (!handled) {
        el.removeEventListener('click', handler, { capture: true })
        resolve(false)
      }
    }, 500)
  })
}

export interface DetectionResult {
  hasExistingButton: boolean
  candidate: Element | null
}

/**
 * Main detection entry point.
 * Returns whether the page already has a back-to-top button and the best candidate.
 */
export async function detectExistingTopButton(): Promise<DetectionResult> {
  const candidates = new Set<Element>()

  // Layer 1: CSS selector matching
  for (const el of collectSelectorCandidates()) {
    candidates.add(el)
  }

  // Layer 2: Text matching
  for (const el of collectTextCandidates()) {
    candidates.add(el)
  }

  if (candidates.size === 0) {
    return { hasExistingButton: false, candidate: null }
  }

  // Sort by score (highest = most likely a real back-to-top button)
  const scored = [...candidates]
    .map((el) => ({ el, score: scoreCandidate(el) }))
    .filter((s) => s.score > 0) // Remove negative-score (nav-internal) elements
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) {
    return { hasExistingButton: false, candidate: null }
  }

  // Test top candidates (max 3) with behavior verification.
  // Only a verified candidate counts as "page already has a button";
  // otherwise we always inject ours (the extension's core promise is to
  // provide a button when none provably exists).
  const testBatch = scored.slice(0, 3)
  for (const { el } of testBatch) {
    const verified = await verifyBehavior(el)
    if (verified) {
      return { hasExistingButton: true, candidate: el }
    }
  }

  return { hasExistingButton: false, candidate: null }
}
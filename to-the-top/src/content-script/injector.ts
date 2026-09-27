/**
 * Button injection logic.
 *
 * Two injection modes:
 *   1. Toolbar-embedded — appends button to an existing right-side toolbar
 *   2. Floating — creates a semi-transparent floating button in the bottom-right corner
 *
 * The injector creates the DOM element, applies theme-aware styles,
 * and returns the button element for the caller to attach behavior.
 *
 * Visual axes (resolved before injection, never `'auto'` here):
 *   - `iconStyle`    — SVG glyph shape
 *   - `cornerStyle`  — border-radius bucket (square / soft / pill)
 *   - `visualStyle`  — material (flat = no shadow/blur, elevated = shadow + blur)
 */

import type { PageColors } from './color'
import { getButtonColors } from './color'
import type { IconStyle } from '../shared/settings'
import type { ResolvedVisual } from './form'

export type InjectionMode = 'toolbar' | 'floating'

/** Radius (px) per resolved corner style, keyed by mode (floating / toolbar). */
const RADIUS_BY_MODE: Record<ResolvedVisual['cornerStyle'], { floating: number; toolbar: number }> = {
  square: { floating: 2, toolbar: 2 },
  soft: { floating: 8, toolbar: 6 },
  pill: { floating: 22, toolbar: 18 },
}

/** SVG inner markup per icon style. Outer `<svg>` wrapper is shared. */
const ICON_PATHS: Record<IconStyle, string> = {
  'arrow-up': '<path d="M12 20V5"/><path d="M5 12L12 5L19 12"/>',
  'chevron-up': '<path d="M6 14L12 7L18 14"/>',
  'circle-arrow': '<circle cx="12" cy="12" r="9"/><path d="M12 16V8"/><path d="M9 11L12 8L15 11"/>',
  'rounded-arrow': '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 16V8"/><path d="M9 11L12 8L15 11"/>',
}

export interface ButtonConfig {
  mode: InjectionMode
  pageColors: PageColors
  /** Optional parent element for toolbar mode */
  toolbarParent?: HTMLElement
  iconStyle: IconStyle
  visual: ResolvedVisual
}

/**
 * Detect a right-side toolbar on the page.
 *
 * Strategy:
 *   1. Find all `position: fixed` or `position: sticky` elements on the right side
 *   2. Filter toolbar-like containers (narrow width, sufficient height, has child elements)
 *   3. Sort by "most right + narrowest" → return the best candidate
 *
 * Performance: uses TreeWalker with cheap offset checks before getComputedStyle.
 */
export function detectRightToolbar(): HTMLElement | null {
  const candidates: HTMLElement[] = []
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node) => {
        const el = node as HTMLElement
        if (el === document.body || el === document.documentElement) return NodeFilter.FILTER_REJECT
        // Cheap pre-filter before expensive getComputedStyle
        if (el.offsetWidth < 10 || el.offsetHeight < 10) return NodeFilter.FILTER_REJECT
        if (el.offsetWidth > 120) return NodeFilter.FILTER_REJECT // too wide for toolbar
        if (el.offsetHeight < 60) return NodeFilter.FILTER_REJECT // too short
        return NodeFilter.FILTER_ACCEPT
      },
    },
  )

  while (walker.nextNode()) {
    const el = walker.currentNode as HTMLElement
    // Must contain at least one child
    if (el.children.length === 0) continue

    const style = getComputedStyle(el)
    // Must be fixed or sticky positioned
    if (style.position !== 'fixed' && style.position !== 'sticky') continue

    const rect = el.getBoundingClientRect()
    // Must be on the right side of the viewport
    if (rect.right < window.innerWidth * 0.7) continue
    if (rect.left < window.innerWidth * 0.4) continue

    candidates.push(el)
  }

  // Sort: most-right first, narrowest first
  candidates.sort((a, b) => {
    const aRect = a.getBoundingClientRect()
    const bRect = b.getBoundingClientRect()
    const rightDiff = bRect.right - aRect.right
    if (Math.abs(rightDiff) > 5) return rightDiff
    return aRect.width - bRect.width
  })

  return candidates[0] ?? null
}

/**
 * Build the base button element with shared attributes.
 */
function buildButtonElement(config: ButtonConfig): HTMLElement {
  const btn = document.createElement('button')
  btn.setAttribute('data-sbt', '')
  btn.setAttribute('aria-label', '回到顶部')
  btn.setAttribute('title', '回到顶部')

  const { background, icon, hoverBackground } = getButtonColors(config.pageColors)
  const { cornerStyle, visualStyle } = config.visual
  const radius = RADIUS_BY_MODE[cornerStyle][config.mode]
  const isElevated = visualStyle === 'elevated'
  const shadow = isElevated ? '0 2px 8px rgba(0,0,0,0.15)' : 'none'
  const hoverShadow = isElevated ? '0 4px 16px rgba(0,0,0,0.25)' : 'none'
  const backdrop = isElevated ? 'blur(4px)' : 'none'

  // SVG arrow icon — inline so no external resources needed
  btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${icon}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px;display:block">${ICON_PATHS[config.iconStyle]}</svg>`

  if (config.mode === 'toolbar') {
    // Toolbar mode: minimal inline button
    Object.assign(btn.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '36px',
      height: '36px',
      padding: '6px',
      margin: '4px auto',
      border: 'none',
      borderRadius: `${radius}px`,
      background: 'transparent',
      opacity: '0',
      cursor: 'pointer',
      boxShadow: 'none',
      transition: 'opacity 0.3s ease-out, background 0.2s ease-out, transform 0.2s ease-out',
    })
    // Hover: subtle background
    btn.addEventListener('mouseenter', () => {
      btn.style.background = `${background}22` // ~13% opacity
      btn.style.transform = 'scale(1.05)'
    })
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'transparent'
      btn.style.transform = 'scale(1)'
    })
  } else {
    // Floating mode
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: '2147483647',  // max z-index
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '44px',
      height: '44px',
      padding: '10px',
      border: 'none',
      borderRadius: `${radius}px`,
      background,
      opacity: '0',
      cursor: 'pointer',
      boxShadow: shadow,
      transition: 'opacity 0.3s ease-out, transform 0.2s ease-out, box-shadow 0.2s ease-out',
      backdropFilter: backdrop,
      WebkitBackdropFilter: backdrop,
    })

    // Hover state
    btn.addEventListener('mouseenter', () => {
      btn.style.background = hoverBackground
      btn.style.boxShadow = hoverShadow
      btn.style.transform = 'scale(1.05)'
    })
    btn.addEventListener('mouseleave', () => {
      btn.style.background = background
      btn.style.boxShadow = shadow
      btn.style.transform = 'scale(1)'
    })
  }

  return btn
}

/**
 * Inject the button into the page.
 * Returns [buttonElement, parentElement].
 */
export function injectButton(config: ButtonConfig): HTMLElement {
  const btn = buildButtonElement(config)

  // Inject animation keyframes
  injectBaseStyles()

  if (config.mode === 'toolbar' && config.toolbarParent) {
    config.toolbarParent.appendChild(btn)
  } else {
    document.body.appendChild(btn)
  }

  return btn
}

/**
 * Inject base CSS styles (only once).
 */
let stylesInjected = false

function injectBaseStyles(): void {
  if (stylesInjected) return
  stylesInjected = true

  const style = document.createElement('style')
  style.textContent = `
    [data-sbt] {
      -webkit-appearance: none;
      -moz-appearance: none;
      appearance: none;
      outline: none;
      user-select: none;
      -webkit-user-select: none;
      touch-action: manipulation;
    }
    [data-sbt]:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 2px;
    }
  `
  document.head.appendChild(style)
}

/**
 * Clean up: remove the injected button from the DOM.
 */
export function removeButton(button: HTMLElement): void {
  button.remove()
}
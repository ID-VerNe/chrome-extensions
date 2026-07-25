/**
 * Color utilities: extract page primary color + detect light/dark color scheme.
 *
 * Primary color extraction (priority order):
 *   1. CSS custom properties (--primary, --color-primary, --accent, etc.)
 *   2. First <a> or <button> element's color
 *   3. Fallback to a neutral blue (#1a73e8)
 *
 * Light/dark detection (two layers):
 *   1. Check <html>/<body> data-theme / class markers
 *   2. Compute body background brightness
 */

export interface PageColors {
  primary: string
  scheme: 'light' | 'dark'
}

// CSS custom properties to check for primary/accent color — ordered by likelihood
const PRIMARY_CSS_VARS = [
  '--primary',
  '--color-primary',
  '--accent',
  '--color-accent',
  '--theme-color',
  '--brand-color',
  '--brand-primary',
  '--link-color',
  '--color-link',
  '--button-primary-bg',
  '--btn-primary-bg',
  '--main-color',
  '--base-color',
]

const DARK_CLASS_PATTERNS = ['dark', 'theme-dark', 'dark-mode', 'darkmode']
const DARK_ATTR_PATTERNS = ['theme', 'data-theme', 'data-mode']

/**
 * Extract primary color from CSS custom properties.
 */
function extractFromCSSVars(): string | null {
  const root = getComputedStyle(document.documentElement)
  for (const v of PRIMARY_CSS_VARS) {
    const val = root.getPropertyValue(v).trim()
    if (val && val !== 'transparent' && val !== 'initial' && val !== 'inherit') {
      // Expand CSS variables that reference other variables
      if (val.startsWith('var(')) {
        const innerVar = val.slice(4, -1).trim()
        const innerVal = root.getPropertyValue(innerVar).trim()
        if (innerVal) return innerVal
      }
      return val
    }
  }
  return null
}

/**
 * Extract color from the first prominent <a> or <button> element.
 */
function extractFromFirstInteractive(): string | null {
  const el = document.querySelector('a, button, [role="button"]')
  if (!el) return null
  const color = getComputedStyle(el).color
  // Skip default black/white in rgb format
  if (color === 'rgb(0, 0, 0)' || color === 'rgb(255, 255, 255)') return null
  return color
}

/**
 * Try to extract from a common link color — the first non-default link on the page.
 */
function extractFromLinkColor(): string | null {
  const links = document.querySelectorAll('a:not([href="#"])')
  for (const link of links) {
    if (!link.textContent?.trim()) continue
    const color = getComputedStyle(link).color
    if (color && color !== 'rgb(0, 0, 0)' && color !== 'rgb(255, 255, 255)') {
      return color
    }
    // Only check first few links
    break
  }
  return null
}

/**
 * Detect color scheme from CSS class/attribute markers on <html> or <body>.
 */
function detectSchemeFromMarkers(): 'light' | 'dark' | null {
  // Check <html> first
  const html = document.documentElement
  for (const attr of DARK_ATTR_PATTERNS) {
    const val = html.getAttribute(attr)?.toLowerCase()
    if (val === 'dark' || val === 'dim') return 'dark'
    if (val === 'light') return 'light'
  }
  for (const cls of DARK_CLASS_PATTERNS) {
    if (html.classList.contains(cls)) return 'dark'
  }

  // Check <body> next
  const body = document.body
  for (const attr of DARK_ATTR_PATTERNS) {
    const val = body.getAttribute(attr)?.toLowerCase()
    if (val === 'dark' || val === 'dim') return 'dark'
    if (val === 'light') return 'light'
  }
  for (const cls of DARK_CLASS_PATTERNS) {
    if (body.classList.contains(cls)) return 'dark'
  }

  return null
}

/**
 * Detect color scheme from background color brightness.
 */
function detectSchemeFromBrightness(): 'light' | 'dark' {
  const bg = getComputedStyle(document.body).backgroundColor
  const brightness = computeBrightness(bg)
  return brightness < 128 ? 'dark' : 'light'
}

/**
 * Parse an rgb/rgba string and compute perceived brightness.
 * Formula: (R * 299 + G * 587 + B * 114) / 1000
 */
function computeBrightness(rgbStr: string): number {
  const match = rgbStr.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (!match) return 255 // can't parse → assume light
  const r = Number(match[1])
  const g = Number(match[2])
  const b = Number(match[3])
  return (r * 299 + g * 587 + b * 114) / 1000
}

/**
 * Convert an rgb/rgba CSS color string to hex.
 */
export function rgbToHex(rgbStr: string): string {
  const match = rgbStr.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (!match) return rgbStr
  const r = Number(match[1])
  const g = Number(match[2])
  const b = Number(match[3])
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/**
 * Darken a hex color by a given percentage (0-1).
 */
export function darkenColor(hex: string, amount: number): string {
  const { r, g, b } = parseHex(hex)
  const factor = 1 - amount
  return `#${Math.round(r * factor).toString(16).padStart(2, '0')}${Math.round(g * factor).toString(16).padStart(2, '0')}${Math.round(b * factor).toString(16).padStart(2, '0')}`
}

/**
 * Lighten a hex color by a given percentage (0-1).
 */
export function lightenColor(hex: string, amount: number): string {
  const { r, g, b } = parseHex(hex)
  return `#${Math.round(r + (255 - r) * amount).toString(16).padStart(2, '0')}${Math.round(g + (255 - g) * amount).toString(16).padStart(2, '0')}${Math.round(b + (255 - b) * amount).toString(16).padStart(2, '0')}`
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '')
  const full = clean.length === 3
    ? clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2]
    : clean
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

/**
 * Main entry: get page colors (primary accent + scheme).
 */
export function getPageColors(): PageColors {
  // Primary color
  const primary =
    extractFromCSSVars() ??
    extractFromLinkColor() ??
    extractFromFirstInteractive() ??
    '#1a73e8' // fallback

  // Normalize to hex
  const primaryHex = primary.startsWith('#') ? primary : rgbToHex(primary)

  // Color scheme
  const scheme = detectSchemeFromMarkers() ?? detectSchemeFromBrightness()

  return { primary: primaryHex, scheme }
}

/**
 * Compute appropriate button colors based on page colors.
 */
export function getButtonColors(pageColors: PageColors): {
  background: string
  icon: string
  hoverBackground: string
} {
  const isDark = pageColors.scheme === 'dark'

  if (isDark) {
    return {
      background: lightenColor(pageColors.primary, 0.3),
      icon: '#ffffff',
      hoverBackground: lightenColor(pageColors.primary, 0.5),
    }
  }

  return {
    background: darkenColor(pageColors.primary, 0.1),
    icon: '#ffffff',
    hoverBackground: darkenColor(pageColors.primary, 0.25),
  }
}
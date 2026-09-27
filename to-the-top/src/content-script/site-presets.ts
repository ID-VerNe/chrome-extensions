/**
 * Per-site visual presets for high-traffic sites with strong, stable design
 * languages. Only stores the axes that matter for blending in (corner +
 * material); never touches color / position / icon.
 *
 * Keep this list deliberately short. Sites not listed fall back to the generic
 * heuristic in `form.ts`. If a site redesigns and a preset no longer matches,
 * the only consequence is that the button reverts to the heuristic baseline —
 * it never breaks.
 */

import type { CornerStyle, VisualStyle } from '../shared/settings'

export interface VisualOverride {
  cornerStyle?: CornerStyle
  visualStyle?: VisualStyle
}

interface SitePreset {
  host: string
  override: VisualOverride
}

const PRESETS: SitePreset[] = [
  { host: 'github.com', override: { cornerStyle: 'square', visualStyle: 'flat' } },
  { host: 'x.com', override: { cornerStyle: 'pill', visualStyle: 'flat' } },
  { host: 'twitter.com', override: { cornerStyle: 'pill', visualStyle: 'flat' } },
  { host: 'bilibili.com', override: { cornerStyle: 'soft', visualStyle: 'elevated' } },
  { host: 'zhihu.com', override: { cornerStyle: 'soft', visualStyle: 'flat' } },
  { host: 'stackoverflow.com', override: { cornerStyle: 'square', visualStyle: 'flat' } },
]

/**
 * Returns the visual preset for a hostname, or `null` if none matches.
 * Subdomains match the bare host (`www.x.com` hits `x.com`).
 */
export function getSitePreset(hostname: string): VisualOverride | null {
  const match = PRESETS.find(
    (p) => hostname === p.host || hostname.endsWith('.' + p.host),
  )
  return match ? match.override : null
}

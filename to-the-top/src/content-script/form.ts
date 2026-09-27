/**
 * Generic visual-form inference: derive the page's dominant corner-radius and
 * material style by sampling computed styles on a handful of interactive
 * elements. Cheap O(≤20) `getComputedStyle` calls, runs once per injection.
 *
 * Used as the baseline; site presets and user overrides apply on top.
 */

import type { CornerStyle, VisualStyle, ExtensionSettings } from '../shared/settings'
import { getSitePreset, type VisualOverride } from './site-presets'

/** Selector for interactive elements to sample. */
const SAMPLE_SELECTOR = 'button, a[class], [role="button"], .btn, [class*="btn"]'
const MAX_SAMPLES = 20
const MIN_SAMPLES = 5

/**
 * Map a raw border-radius (px) to a corner style bucket.
 * < 4px → square, 4–14px → soft, > 14px → pill.
 */
function radiusToCorner(radiusPx: number): CornerStyle {
  if (radiusPx < 4) return 'square'
  if (radiusPx > 14) return 'pill'
  return 'soft'
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

/**
 * Sample up to MAX_SAMPLES interactive elements and return their radii (px).
 */
function sampleRadii(): number[] {
  const els = document.querySelectorAll(SAMPLE_SELECTOR)
  const radii: number[] = []
  for (const el of els) {
    if (radii.length >= MAX_SAMPLES) break
    const r = getComputedStyle(el).borderRadius
    // Use the first corner; absolute px, ignore `%` / multi-value.
    const px = parseFloat(r)
    if (!Number.isNaN(px)) radii.push(px)
  }
  return radii
}

/**
 * Infer the dominant corner style from sampled radii.
 */
function inferCornerStyle(): CornerStyle {
  const radii = sampleRadii()
  if (radii.length < MIN_SAMPLES) return 'soft' // safest default
  return radiusToCorner(median(radii))
}

/**
 * Infer the dominant material style: elevated if most sampled elements have a
 * box-shadow or backdrop-filter, otherwise flat.
 */
function inferVisualStyle(): VisualStyle {
  const els = document.querySelectorAll(SAMPLE_SELECTOR)
  let elevated = 0
  let flat = 0
  for (const el of els) {
    if (elevated + flat >= MAX_SAMPLES) break
    const style = getComputedStyle(el)
    const hasShadow = style.boxShadow !== 'none'
    const hasBackdrop = style.backdropFilter !== 'none'
    if (hasShadow || hasBackdrop) elevated++
    else flat++
  }
  if (elevated + flat < MIN_SAMPLES) return 'elevated' // floating button wants a lift
  return elevated > flat ? 'elevated' : 'flat'
}

/** Resolved (non-auto) corner + material values ready for the injector. */
export interface ResolvedVisual {
  cornerStyle: Exclude<CornerStyle, 'auto'>
  visualStyle: Exclude<VisualStyle, 'auto'>
}

/**
 * Merge visual sources by priority:
 *   1. Generic heuristic (form.ts)
 *   2. Site preset overrides only the axes it specifies
 *   3. User setting overrides when not `'auto'`
 */
export function getVisualConfig(
  settings: Pick<ExtensionSettings, 'cornerStyle' | 'visualStyle'>,
  hostname: string,
): ResolvedVisual {
  let corner: CornerStyle = inferCornerStyle()
  let material: VisualStyle = inferVisualStyle()

  const preset: VisualOverride | null = getSitePreset(hostname)
  if (preset?.cornerStyle && preset.cornerStyle !== 'auto') corner = preset.cornerStyle
  if (preset?.visualStyle && preset.visualStyle !== 'auto') material = preset.visualStyle

  if (settings.cornerStyle !== 'auto') corner = settings.cornerStyle
  if (settings.visualStyle !== 'auto') material = settings.visualStyle

  return {
    cornerStyle: corner as Exclude<CornerStyle, 'auto'>,
    visualStyle: material as Exclude<VisualStyle, 'auto'>,
  }
}

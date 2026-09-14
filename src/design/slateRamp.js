// The roster-stats visuals all encode "concern" (thin bench, uneven
// distribution, cramped spacing, low coverage) as a single muted SLATE hue that
// deepens with concern, keeping RED reserved for true danger. Three charts —
// the availability heatmap, the distribution/rotation/spacing bars, and the
// quality-metrics spacing dots — independently hardcoded the same hue (215) and
// re-derived the same light→deep hsla interpolation. This module owns that one
// hue and the interpolation math so the charts share a token instead of copies.
//
// Endpoints stay PER CHART on purpose: each visual picks its own light/deep
// {s,l,a} so its ramp reads well against its own surface (the heatmap's deepest
// slate is intentionally aligned to the distribution bars' deepest, but the
// spacing dots run paler with a coloured border). What is shared — and what was
// duplicated — is the hue and the lerp, not the endpoints.

export const SLATE_HUE = 215

const lerp = (a, b, t) => a + (b - a) * t
const clamp01 = (n) => Math.min(1, Math.max(0, n))

/**
 * Interpolate one slate hsla colour at concern `t` between two endpoints.
 * `t` is clamped to [0,1]; `t = 0` is the light (comfortable) end, `t = 1` the
 * deep (most-concerning) end. Endpoints are `{ s, l, a }` (percent, percent,
 * 0..1 alpha) at the shared `SLATE_HUE`.
 *
 * @param {{ s: number, l: number, a: number }} light  comfortable-end endpoint
 * @param {{ s: number, l: number, a: number }} deep   concern-end endpoint
 * @param {number} t  concern in [0,1]
 * @returns {string}  `hsla(215, S%, L%, A)` CSS colour
 */
export function slateRampColor(light, deep, t) {
  const k = clamp01(t)
  const s = lerp(light.s, deep.s, k)
  const l = lerp(light.l, deep.l, k)
  const a = lerp(light.a, deep.a, k)
  return `hsla(${SLATE_HUE}, ${s.toFixed(0)}%, ${l.toFixed(0)}%, ${a.toFixed(2)})`
}

import { describe, it, expect } from 'vitest'
import { SLATE_HUE, slateRampColor } from './slateRamp'

describe('slateRamp', () => {
  const light = { s: 16, l: 74, a: 0.72 }
  const deep = { s: 25, l: 30, a: 0.72 }

  it('exposes the single shared slate hue', () => {
    expect(SLATE_HUE).toBe(215)
  })

  it('always emits the shared hue', () => {
    expect(slateRampColor(light, deep, 0)).toMatch(/^hsla\(215,/)
    expect(slateRampColor(light, deep, 1)).toMatch(/^hsla\(215,/)
  })

  it('returns the light endpoint at t = 0 and the deep endpoint at t = 1', () => {
    expect(slateRampColor(light, deep, 0)).toBe('hsla(215, 16%, 74%, 0.72)')
    expect(slateRampColor(light, deep, 1)).toBe('hsla(215, 25%, 30%, 0.72)')
  })

  it('deepens (lower lightness) as concern rises', () => {
    const lo = Number(slateRampColor(light, deep, 0).match(/(\d+)%,\s*0\.72/)[1])
    const hi = Number(slateRampColor(light, deep, 1).match(/(\d+)%,\s*0\.72/)[1])
    expect(hi).toBeLessThan(lo)
  })

  it('clamps t outside [0,1] to the endpoints', () => {
    expect(slateRampColor(light, deep, -1)).toBe(slateRampColor(light, deep, 0))
    expect(slateRampColor(light, deep, 2)).toBe(slateRampColor(light, deep, 1))
  })

  it('interpolates alpha between endpoints', () => {
    const faded = { s: 16, l: 80, a: 0.4 }
    const solid = { s: 25, l: 30, a: 1 }
    expect(slateRampColor(faded, solid, 0.5)).toBe('hsla(215, 21%, 55%, 0.70)')
  })
})

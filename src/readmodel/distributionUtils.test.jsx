import { describe, expect, it } from 'vitest'
import {
  distributionConcern,
  spacingDotConcern,
  normalizeMetricRange,
  verticalConcernGradient,
  horizontalConcernGradient,
  fullTrackConcernGradient,
  availabilityCellColor,
} from './distributionUtils.jsx'

describe('distributionConcern', () => {
  it('gets darker as shift count rises across the chart range', () => {
    expect(distributionConcern(1, 1, 5)).toBe(0)
    expect(distributionConcern(3, 1, 5)).toBe(0.5)
    expect(distributionConcern(5, 1, 5)).toBe(1)
  })

  it('falls back to a mid concern when the range is flat', () => {
    expect(distributionConcern(3, 3, 3)).toBe(0.5)
  })
})

describe('normalizeMetricRange', () => {
  it('spreads values across the full 0..1 range', () => {
    expect(normalizeMetricRange(2, 2, 10)).toBe(0)
    expect(normalizeMetricRange(6, 2, 10)).toBe(0.5)
    expect(normalizeMetricRange(10, 2, 10)).toBe(1)
  })

  it('falls back when the range is flat', () => {
    expect(normalizeMetricRange(5, 5, 5, 0.3)).toBe(0.3)
  })
})

describe('spacingDotConcern', () => {
  const dates = [
    { date: '2026-01-01' },
    { date: '2026-01-03' },
    { date: '2026-02-20' },
  ]
  const periodSpan = new Date('2026-03-01').getTime() - new Date('2026-01-01').getTime()

  it('marks tightly clustered dots as more concerning', () => {
    const clustered = spacingDotConcern(dates, 0, periodSpan)
    const spread = spacingDotConcern(dates, 2, periodSpan)
    expect(clustered).toBeGreaterThan(spread)
  })

  it('returns a low baseline concern for a solitary dot', () => {
    expect(spacingDotConcern([{ date: '2026-01-01' }], 0, periodSpan)).toBe(0.12)
  })
})

describe('concern gradients', () => {
  it('produces vertical and horizontal gradient strings', () => {
    expect(verticalConcernGradient(0.8)).toContain('linear-gradient(to top')
    expect(horizontalConcernGradient(0.8)).toContain('linear-gradient(to right')
  })

  it('produces a shared full-track gradient for row-normalized bars', () => {
    expect(fullTrackConcernGradient()).toContain('linear-gradient(to right')
  })
})

describe('availabilityCellColor', () => {
  const scale = { min: 1.5, max: 3 }

  it('returns none (neutral) when there is no demand', () => {
    const { category } = availabilityCellColor(5, 0, scale)
    expect(category).toBe('none')
  })

  it('reserves red for shortage and exact cover regardless of scale', () => {
    expect(availabilityCellColor(1, 2, scale).category).toBe('short') // available < required
    expect(availabilityCellColor(2, 2, scale).category).toBe('exact') // exactly enough
  })

  it('gives slack cells a continuous single-hue ramp colour', () => {
    const { category, color } = availabilityCellColor(6, 2, scale) // ratio 3 -> top of scale
    expect(category).toBe('slack')
    expect(color).toMatch(/^hsla\(215,/) // always the shared slate hue
  })

  it('deepens (lower lightness) as coverage ratio falls within the scale', () => {
    // Same hue throughout; darker slate now means thinner still-coverable bench.
    const low = availabilityCellColor(3, 2, scale)  // ratio 1.5 = min → deep
    const high = availabilityCellColor(6, 2, scale) // ratio 3 = max → pale
    const lightLow = Number(low.color.match(/(\d+)%,\s*0\.72/)[1])
    const lightHigh = Number(high.color.match(/(\d+)%,\s*0\.72/)[1])
    expect(lightLow).toBeLessThan(lightHigh)
  })

  it('defaults a flat scale to the deepest (most concerning) end', () => {
    const { color } = availabilityCellColor(3, 1, undefined) // no scale → t = 1
    const light = Number(color.match(/(\d+)%,\s*0\.72/)[1])
    expect(light).toBe(30) // HEATMAP_SLATE_DEEP.l
  })
})


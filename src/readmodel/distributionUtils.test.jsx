import { describe, expect, it } from 'vitest'
import {
  distributionConcern,
  spacingDotConcern,
  normalizeMetricRange,
  verticalConcernGradient,
  horizontalConcernGradient,
  fullTrackConcernGradient,
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

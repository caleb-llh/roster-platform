import { describe, it, expect } from 'vitest'
import { CONSTRAINTS } from './constraints'
import { SCORERS, SCORING_WEIGHTS } from './scorers'
import { defineRule, defineScorer } from './defineRule'

/**
 * Conformance tests for the two rule registries. These lock in the shared
 * `rules/` shape so a new descriptor cannot silently omit a required field
 * (which would otherwise blow up deep inside the generator).
 */

describe('CONSTRAINTS registry conformance', () => {
  it('every constraint has the required shape', () => {
    for (const rule of CONSTRAINTS) {
      expect(typeof rule.key).toBe('string')
      expect(typeof rule.kind).toBe('string')
      expect(typeof rule.enabled).toBe('function')
      expect(typeof rule.check).toBe('function')
    }
  })

  it('constraint keys are unique', () => {
    const keys = CONSTRAINTS.map(r => r.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('SCORERS registry conformance', () => {
  it('every scorer has the required shape', () => {
    for (const scorer of SCORERS) {
      expect(typeof scorer.key).toBe('string')
      expect(typeof scorer.enabled).toBe('function')
      expect(typeof scorer.score).toBe('function')
    }
  })

  it('scorer keys are unique', () => {
    const keys = SCORERS.map(s => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('every scorer has a weight in SCORING_WEIGHTS', () => {
    for (const scorer of SCORERS) {
      expect(typeof SCORING_WEIGHTS[scorer.key]).toBe('number')
    }
  })
})

describe('descriptor factories fail loud on missing fields', () => {
  it('defineRule requires key, kind, enabled, check', () => {
    expect(() => defineRule({ key: 'x', kind: 'feasibility', enabled: () => true })).toThrow(/check/)
    expect(() => defineRule({ key: 'x', enabled: () => true, check: () => null })).toThrow(/kind/)
  })

  it('defineScorer requires key, enabled, score', () => {
    expect(() => defineScorer({ key: 'x', enabled: () => true })).toThrow(/score/)
    expect(() => defineScorer({ key: 'x', score: () => 1 })).toThrow(/enabled/)
  })

  it('returns the descriptor unchanged when valid (identity, no wrapping)', () => {
    const d = { key: 'x', kind: 'feasibility', enabled: () => true, check: () => null }
    expect(defineRule(d)).toBe(d)
  })
})

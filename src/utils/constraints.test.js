import { describe, it, expect } from 'vitest'
import {
  CONSTRAINTS,
  CONSTRAINT_MODES,
  checkConstraints,
  getConstraint,
  formatViolation,
} from './constraints'
import { CONSTRAINT_KEYS } from '../schema/rosterSchema'

// memberConstraints is the array shape from YAML: one entry per member.
const memberConstraints = [
  { member_id: 'm1', unavailable_dates: ['2026-01-10'] },
]
const enabled = { [CONSTRAINT_KEYS.ENFORCE_MEMBER_AVAILABILITY]: true }
const event = { date: '2026-01-10', roster: [] }
const freeEvent = { date: '2026-01-11', roster: [] }

describe('availability constraint descriptor', () => {
  const availability = getConstraint('availability')

  it('is a feasibility constraint', () => {
    expect(availability.kind).toBe('feasibility')
  })

  it('flags an unavailable member the same way in both modes', () => {
    const ctx = { memberConstraints }
    const placement = { memberId: 'm1', role: 'lead', event }

    const would = availability.check(placement, ctx, CONSTRAINT_MODES.WOULD_PLACE)
    const isPlaced = availability.check(placement, ctx, CONSTRAINT_MODES.IS_PLACED)

    expect(would).toEqual({ code: 'unavailable', params: { memberId: 'm1', date: '2026-01-10' } })
    // Feasibility ignores mode: the answer is identical.
    expect(isPlaced).toEqual(would)
  })

  it('passes an available member', () => {
    const ctx = { memberConstraints }
    expect(
      availability.check({ memberId: 'm1', role: 'lead', event: freeEvent }, ctx, CONSTRAINT_MODES.WOULD_PLACE)
    ).toBeNull()
  })
})

describe('checkConstraints runner', () => {
  it('skips disabled constraints', () => {
    const ctx = { rosterConstraints: {}, memberConstraints }
    const violations = checkConstraints({ memberId: 'm1', role: 'lead', event }, ctx)
    expect(violations).toEqual([])
  })

  it('reports a violation when the constraint is enabled', () => {
    const ctx = { rosterConstraints: enabled, memberConstraints }
    const violations = checkConstraints({ memberId: 'm1', role: 'lead', event }, ctx)
    expect(violations).toHaveLength(1)
    expect(violations[0].code).toBe('unavailable')
  })

  it('restricts to a kind when asked', () => {
    const ctx = { rosterConstraints: enabled, memberConstraints }
    const feasibility = checkConstraints({ memberId: 'm1', role: 'lead', event }, ctx, { kind: 'feasibility' })
    const loadCadence = checkConstraints({ memberId: 'm1', role: 'lead', event }, ctx, { kind: 'load-cadence' })
    expect(feasibility).toHaveLength(1)
    expect(loadCadence).toEqual([])
  })
})

describe('formatViolation', () => {
  it('renders the unavailable code with a resolved name', () => {
    const nameOf = (id) => (id === 'm1' ? 'Alice' : id)
    const sentence = formatViolation(
      { code: 'unavailable', params: { memberId: 'm1', date: '2026-01-10' } },
      nameOf
    )
    expect(sentence).toBe('Alice is unavailable on 2026-01-10.')
  })

  it('returns null for a null violation', () => {
    expect(formatViolation(null)).toBeNull()
  })

  it('falls back to a generic sentence for unknown codes', () => {
    expect(formatViolation({ code: 'mystery', params: {} })).toBe(
      'Assignment violates a roster constraint.'
    )
  })
})

describe('registry integrity', () => {
  it('exposes the migrated constraints with valid kinds', () => {
    expect(CONSTRAINTS.map(c => c.key)).toEqual([
      'availability',
      'once-per-event',
      'no-clash',
      'once-per-week',
      'max-per-month',
      'understudy-before-role',
    ])
    for (const c of CONSTRAINTS) {
      expect(['feasibility', 'load-cadence']).toContain(c.kind)
      expect(typeof c.enabled).toBe('function')
      expect(typeof c.check).toBe('function')
    }
  })
})

describe('load-cadence descriptors (mode-sensitive counting)', () => {
  // A ctx whose counts are supplied directly, mimicking a consumer's tracker or
  // scan. This is the uniform counting interface the descriptors depend on.
  const makeCtx = (over, counts = {}) => ({
    rosterConstraints: {
      ONLY_ONCE_PER_WEEK: true,
      MAX_ASSIGNMENTS_PER_MONTH: 2,
      ...over,
    },
    weeklyCount: () => counts.weekly ?? 0,
    monthlyCount: () => counts.monthly ?? 0,
  })
  const placement = { memberId: 'm1', role: 'lead', event: { date: '2026-03-10' } }

  describe('once-per-week (cap 1)', () => {
    const rule = getConstraint('once-per-week')
    it('would-place: blocks at >= 1 prior', () => {
      expect(rule.check(placement, makeCtx({}, { weekly: 1 }), CONSTRAINT_MODES.WOULD_PLACE)).not.toBeNull()
      expect(rule.check(placement, makeCtx({}, { weekly: 0 }), CONSTRAINT_MODES.WOULD_PLACE)).toBeNull()
    })
    it('is-placed: violation only at > 1 (self is counted)', () => {
      expect(rule.check(placement, makeCtx({}, { weekly: 1 }), CONSTRAINT_MODES.IS_PLACED)).toBeNull()
      expect(rule.check(placement, makeCtx({}, { weekly: 2 }), CONSTRAINT_MODES.IS_PLACED)).not.toBeNull()
    })
  })

  describe('max-per-month (cap 2)', () => {
    const rule = getConstraint('max-per-month')
    it('would-place: blocks at >= cap', () => {
      expect(rule.check(placement, makeCtx({}, { monthly: 2 }), CONSTRAINT_MODES.WOULD_PLACE)).not.toBeNull()
      expect(rule.check(placement, makeCtx({}, { monthly: 1 }), CONSTRAINT_MODES.WOULD_PLACE)).toBeNull()
    })
    it('is-placed: violation only at > cap (self is counted)', () => {
      expect(rule.check(placement, makeCtx({}, { monthly: 2 }), CONSTRAINT_MODES.IS_PLACED)).toBeNull()
      const v = rule.check(placement, makeCtx({}, { monthly: 3 }), CONSTRAINT_MODES.IS_PLACED)
      expect(v).toEqual({ code: 'max-per-month', params: { memberId: 'm1', date: '2026-03-10', count: 3, cap: 2 } })
    })
    it('is disabled when the cap key is absent', () => {
      expect(rule.enabled({ rosterConstraints: {} })).toBe(false)
    })
  })
})

describe('once-per-event descriptor', () => {
  const rule = getConstraint('once-per-event')
  const ctx = (roster) => ({
    rosterConstraints: { ONLY_ONCE_PER_EVENT: true },
    currentRoster: () => roster,
  })
  it('flags a member already present in another slot', () => {
    const roster = [{ role: 'lead', member_id: 'm1' }]
    const v = rule.check({ memberId: 'm1', role: 'cam', event: { date: 'd' } }, ctx(roster), CONSTRAINT_MODES.WOULD_PLACE)
    expect(v.code).toBe('once-per-event')
  })
  it('passes a member not yet in the event', () => {
    expect(rule.check({ memberId: 'm2', role: 'cam', event: { date: 'd' } }, ctx([]), CONSTRAINT_MODES.WOULD_PLACE)).toBeNull()
  })
})

describe('no-clash descriptor', () => {
  const rule = getConstraint('no-clash')
  const target = { date: '2026-04-01', roster: [] }
  // Same-day event the member is already in → overlaps (bare dates are whole days).
  const otherSameDay = { date: '2026-04-01', roster: [{ role: 'lead', member_id: 'm1' }] }
  const ctx = (clashers) => ({
    rosterConstraints: { ENFORCE_NO_CLASH: true },
    overlappingEvents: () => clashers,
  })

  it('is a feasibility constraint', () => {
    expect(rule.kind).toBe('feasibility')
  })

  it('flags a member already in an overlapping event', () => {
    const v = rule.check({ memberId: 'm1', role: 'cam', event: target }, ctx([otherSameDay]), CONSTRAINT_MODES.WOULD_PLACE)
    expect(v).toEqual({ code: 'clash', params: { memberId: 'm1', date: '2026-04-01', otherDate: '2026-04-01', external: false } })
  })

  it('ignores overlapping events the member is not in', () => {
    const otherWithoutMember = { date: '2026-04-01', roster: [{ role: 'lead', member_id: 'm2' }] }
    expect(rule.check({ memberId: 'm1', role: 'cam', event: target }, ctx([otherWithoutMember]), CONSTRAINT_MODES.WOULD_PLACE)).toBeNull()
  })

  it('passes when there are no overlapping events', () => {
    expect(rule.check({ memberId: 'm1', role: 'cam', event: target }, ctx([]), CONSTRAINT_MODES.WOULD_PLACE)).toBeNull()
  })

  it('is mode-insensitive (overlappingEvents already excludes self)', () => {
    const would = rule.check({ memberId: 'm1', role: 'cam', event: target }, ctx([otherSameDay]), CONSTRAINT_MODES.WOULD_PLACE)
    const isPlaced = rule.check({ memberId: 'm1', role: 'cam', event: target }, ctx([otherSameDay]), CONSTRAINT_MODES.IS_PLACED)
    expect(isPlaced).toEqual(would)
  })

  it('is disabled when the flag is absent', () => {
    expect(rule.enabled({ rosterConstraints: {} })).toBe(false)
  })
})

describe('understudy-before-role descriptor', () => {
  const rule = getConstraint('understudy-before-role')
  const members = [
    { id: 'trainee', name: 'Trainee', roles: [], understudyFor: ['lead'] },
    { id: 'perf', name: 'Perf', roles: ['lead'], understudyFor: [] },
  ]
  const ctx = (priorSessions) => ({
    rosterConstraints: { ENFORCE_UNDERSTUDY_BEFORE_ROLE: true },
    members,
    priorUnderstudySessions: () => priorSessions,
  })

  it('blocks a trainee in the real role before enough sessions', () => {
    const v = rule.check({ memberId: 'trainee', role: 'lead', event: { date: 'd' } }, ctx(0), CONSTRAINT_MODES.IS_PLACED)
    expect(v).toEqual({ code: 'understudy-before-role', params: { memberId: 'trainee', role: 'lead', minSessions: 1 } })
  })
  it('allows a trainee once promoted', () => {
    expect(rule.check({ memberId: 'trainee', role: 'lead', event: { date: 'd' } }, ctx(1), CONSTRAINT_MODES.IS_PLACED)).toBeNull()
  })
  it('never blocks a full performer', () => {
    expect(rule.check({ memberId: 'perf', role: 'lead', event: { date: 'd' } }, ctx(0), CONSTRAINT_MODES.IS_PLACED)).toBeNull()
  })
  it('blocks re-understudying once qualified (would-place, generator-only side)', () => {
    const v = rule.check({ memberId: 'trainee', role: 'lead-understudy', event: { date: 'd' } }, ctx(1), CONSTRAINT_MODES.WOULD_PLACE)
    expect(v.code).toBe('understudy-complete')
  })
  it('does not report the understudy-slot side in is-placed mode', () => {
    expect(rule.check({ memberId: 'trainee', role: 'lead-understudy', event: { date: 'd' } }, ctx(1), CONSTRAINT_MODES.IS_PLACED)).toBeNull()
  })
})

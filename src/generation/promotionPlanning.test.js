import { describe, it, expect } from 'vitest'
import { generateRoster } from './index'
import { CONSTRAINT_KEYS } from '../schema/rosterSchema'

/**
 * Tests for the Phase 0.5 promotion-planning (backtracking) pass.
 *
 * Seeding gets a trainee their understudy session, but greedy fills events
 * chronologically and MAX_ASSIGNMENTS_PER_MONTH is a hard cap — so a trainee's
 * monthly budget can be spent on ordinary slots before their real-role
 * opportunity, blocking the promotion. This phase secures promotions up front
 * and maximises how many trainees get promoted.
 */
describe('Promotion planning (Phase 0.5)', () => {
  const constraints = (overrides = {}) => ({
    [CONSTRAINT_KEYS.ENFORCE_MEMBER_ROLES]: true,
    [CONSTRAINT_KEYS.ENFORCE_MEMBER_AVAILABILITY]: true,
    [CONSTRAINT_KEYS.ONLY_ONCE_PER_EVENT]: true,
    [CONSTRAINT_KEYS.ONLY_ONCE_PER_WEEK]: true,
    [CONSTRAINT_KEYS.MAX_ASSIGNMENTS_PER_MONTH]: 2,
    [CONSTRAINT_KEYS.ENFORCE_UNDERSTUDY_BEFORE_ROLE]: true,
    ...overrides,
  })

  const evt = (date, day, roles) => ({
    name: `Service ${date}`,
    date,
    day_of_week: day,
    reporting_time: '09:00',
    roster: roles.map(role => ({ role, member_id: null })),
  })

  it('promotes a trainee even when ordinary slots would exhaust their monthly cap', () => {
    // Trainee `dana` understudies multi-vm in week 1, then has a real multi-vm
    // opportunity in week 4 of the SAME month. There are also two ordinary vm
    // slots (weeks 2 & 3) she is eligible for; with MAX_ASSIGNMENTS_PER_MONTH=2
    // greedy would spend her budget on those and block the promotion. The
    // planner must reserve the week-4 promotion.
    const members = [
      { id: 'dana', name: 'Dana', include: true, roles: ['vm'], understudyFor: ['multi-vm'] },
      { id: 'fillerA', name: 'FillerA', include: true, roles: ['vm'], understudyFor: [] },
      { id: 'fillerB', name: 'FillerB', include: true, roles: ['vm', 'multi-vm'], understudyFor: [] },
    ]
    const events = [
      evt('2026-02-07', 'Saturday', ['multi-vm', 'multi-vm-understudy']),
      evt('2026-02-14', 'Saturday', ['vm']),
      evt('2026-02-21', 'Saturday', ['vm']),
      evt('2026-02-28', 'Saturday', ['multi-vm']),
    ]

    const result = generateRoster(
      events, members, [], [], constraints(), {}, { start_date: '2026-02-01', end_date: '2026-02-28' }
    )

    // Dana understudied in week 1...
    const understudy = result.events[0].roster.find(r => r.role === 'multi-vm-understudy')
    expect(understudy.member_id).toBe('dana')
    // ...and is promoted into the real multi-vm in week 4 despite the monthly cap.
    const promotion = result.events[3].roster.find(r => r.role === 'multi-vm')
    expect(promotion.member_id).toBe('dana')
    // The pin flag is transient and must not leak into the output.
    expect(promotion._pinnedPromotion).toBeUndefined()
  })

  it('maximises the number of promoted trainees across the population', () => {
    // Two trainees, two later real slots. A greedy per-trainee assignment could
    // park both on the same first slot (and promote only one); backtracking must
    // find the assignment that promotes BOTH.
    const members = [
      { id: 'ann', name: 'Ann', include: true, roles: ['vm'], understudyFor: ['multi-vm'] },
      { id: 'bea', name: 'Bea', include: true, roles: ['vm'], understudyFor: ['multi-vm'] },
    ]
    const events = [
      evt('2026-02-07', 'Saturday', ['multi-vm-understudy']),
      evt('2026-03-07', 'Saturday', ['multi-vm-understudy']),
      // Two promotion sites, one per later month.
      evt('2026-04-04', 'Saturday', ['multi-vm']),
      evt('2026-05-02', 'Saturday', ['multi-vm']),
    ]

    const result = generateRoster(
      events, members, [], [], constraints(), {}, { start_date: '2026-02-01', end_date: '2026-05-31' }
    )

    const performers = result.events
      .filter(e => e.date >= '2026-04-01')
      .map(e => e.roster.find(r => r.role === 'multi-vm')?.member_id)
      .filter(Boolean)

    // Both trainees perform the real role (order not important).
    expect(new Set(performers)).toEqual(new Set(['ann', 'bea']))
  })
})

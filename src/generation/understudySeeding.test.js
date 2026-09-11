import { describe, it, expect } from 'vitest'
import { generateRoster } from './index'
import { seedUnderstudySlots } from './understudySeeding'
import { AssignmentTracker } from '../state/assignmentTracker'
import { EligibilityChecker } from '../evaluation/eligibilityChecker'
import { CONSTRAINT_KEYS } from '../schema/rosterSchema'

/**
 * Tests for the Phase 0 understudy-seeding pre-pass: when a trainee has no
 * pre-authored understudy slot, the generator injects "X-understudy" slots into
 * feasible events that already have a real X slot, so the trainee can shadow and
 * later unlock the real role.
 */
describe('Understudy seeding (Phase 0)', () => {
  const rosterPeriod = { start_date: '2026-02-01', end_date: '2026-02-28' }

  const constraints = (overrides = {}) => ({
    [CONSTRAINT_KEYS.ENFORCE_MEMBER_ROLES]: true,
    [CONSTRAINT_KEYS.ENFORCE_MEMBER_AVAILABILITY]: true,
    [CONSTRAINT_KEYS.ONLY_ONCE_PER_EVENT]: true,
    [CONSTRAINT_KEYS.ONLY_ONCE_PER_WEEK]: false,
    [CONSTRAINT_KEYS.MAX_ASSIGNMENTS_PER_MONTH]: 10,
    [CONSTRAINT_KEYS.ENFORCE_UNDERSTUDY_BEFORE_ROLE]: true,
    ...overrides,
  })

  const evt = (date, roles) => ({
    name: `Service ${date}`,
    date,
    day_of_week: 'Sunday',
    reporting_time: '09:00',
    roster: roles.map(role => ({ role, member_id: null })),
  })

  it('seeds an understudy slot on an earlier event and unlocks the real role later', () => {
    // Elijah's scenario: trainee for main-cam, only real main-cam slots exist,
    // plus a full performer so the base role can be learned from. Fred is
    // unavailable on the later date, so if Eli fills the real role there it can
    // only be because seeding unlocked him.
    const members = [
      { id: 'fred', name: 'Fred', include: true, roles: ['main-cam'], understudyFor: [] },
      { id: 'eli', name: 'Eli', include: true, roles: [], understudyFor: ['main-cam'] },
    ]
    const events = [
      evt('2026-02-01', ['main-cam']),
      evt('2026-02-08', ['main-cam']),
    ]
    const memberConstraints = [{ member_id: 'fred', unavailable_dates: ['2026-02-08'] }]

    const result = generateRoster(
      events, members, memberConstraints, [], constraints(), {}, rosterPeriod
    )

    // A main-cam-understudy slot was injected on the first event for Eli.
    const seeded = result.events[0].roster.find(r => r.role === 'main-cam-understudy')
    expect(seeded).toBeTruthy()
    expect(seeded.member_id).toBe('eli')
    expect(seeded.isGenerated).toBe(true)

    // Having understudied on 02-01, Eli can now perform the real role on 02-08.
    const laterReal = result.events[1].roster.find(r => r.role === 'main-cam')
    expect(laterReal.member_id).toBe('eli')
  })

  it('does not seed when there is no real base-role slot to shadow', () => {
    const members = [
      { id: 'eli', name: 'Eli', include: true, roles: [], understudyFor: ['main-cam'] },
    ]
    // Only a roving-cam slot exists; nothing to understudy for main-cam.
    const events = [evt('2026-02-01', ['roving-cam'])]

    const tracker = new AssignmentTracker(members, events, rosterPeriod)
    const checker = new EligibilityChecker(members, [], constraints(), tracker)
    const created = seedUnderstudySlots(events, members, checker, tracker)

    expect(created).toBe(0)
    expect(events[0].roster.some(r => r.role === 'main-cam-understudy')).toBe(false)
  })

  it('does not seed when the trainee is unavailable on the feasible event', () => {
    const members = [
      { id: 'eli', name: 'Eli', include: true, roles: [], understudyFor: ['main-cam'] },
    ]
    const events = [evt('2026-02-01', ['main-cam'])]
    const memberConstraints = [{ member_id: 'eli', unavailable_dates: ['2026-02-01'] }]

    const tracker = new AssignmentTracker(members, events, rosterPeriod)
    const checker = new EligibilityChecker(members, memberConstraints, constraints(), tracker)
    const created = seedUnderstudySlots(events, members, checker, tracker)

    expect(created).toBe(0)
  })

  it('does not seed a second slot when one already exists (idempotent)', () => {
    const members = [
      { id: 'eli', name: 'Eli', include: true, roles: [], understudyFor: ['main-cam'] },
    ]
    // Pre-authored understudy slot already present on the same event.
    const events = [{
      name: 'Service', date: '2026-02-01', day_of_week: 'Sunday', reporting_time: '09:00',
      roster: [
        { role: 'main-cam', member_id: null },
        { role: 'main-cam-understudy', member_id: 'eli' },
      ],
    }]

    const tracker = new AssignmentTracker(members, events, rosterPeriod)
    const checker = new EligibilityChecker(members, [], constraints(), tracker)
    const created = seedUnderstudySlots(events, members, checker, tracker)

    expect(created).toBe(0)
    expect(events[0].roster.filter(r => r.role === 'main-cam-understudy')).toHaveLength(1)
  })

  it('is promotion-aware: seeds the trainee who can actually be promoted next', () => {
    // Two trainees compete for the earliest understudy slot. Both are available
    // to understudy on 02-01, but only "reachable" can perform the real role on
    // 02-08 ("blocked" is unavailable then). Promotion-aware seeding must give
    // the 02-01 understudy session to "reachable" so a promotion happens.
    const rosterPeriodMar = { start_date: '2026-02-01', end_date: '2026-03-31' }
    const members = [
      { id: 'blocked', name: 'Blocked', include: true, roles: ['vm'], understudyFor: ['multi-vm'] },
      { id: 'reachable', name: 'Reachable', include: true, roles: ['vm'], understudyFor: ['multi-vm'] },
    ]
    const events = [
      // Understudy site + real slot on the same monthly-final events.
      { ...evt('2026-02-01', ['multi-vm', 'multi-vm-understudy']) },
      { ...evt('2026-03-01', ['multi-vm', 'multi-vm-understudy']) },
    ]
    // "blocked" cannot make the second (promotion) event.
    const memberConstraints = [{ member_id: 'blocked', unavailable_dates: ['2026-03-01'] }]

    const result = generateRoster(
      events, members, memberConstraints, [], constraints(), {}, rosterPeriodMar
    )

    // 02-01 understudy went to the promotable trainee...
    const firstUnderstudy = result.events[0].roster.find(r => r.role === 'multi-vm-understudy')
    expect(firstUnderstudy.member_id).toBe('reachable')
    // ...who is then promoted into the real role on 03-01.
    const laterReal = result.events[1].roster.find(r => r.role === 'multi-vm')
    expect(laterReal.member_id).toBe('reachable')
  })
})

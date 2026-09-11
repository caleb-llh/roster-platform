import { describe, it, expect } from 'vitest'
import { generateRoster } from './index'
import { CONSTRAINT_KEYS } from '../schema/rosterSchema'

/**
 * End-to-end tests for the understudy-before-role gate.
 *
 * A member flagged as an understudy for role X (understudyFor: ['X']) may only
 * be assigned to the real role X after being assigned to `X-understudy` on a
 * strictly earlier date.
 */
describe('Understudy before role', () => {
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

  it('does not assign a trainee to the real role before understudying it', () => {
    // Only Dana can do multi-vm, and she is merely a trainee. The single event
    // is on the same date as any seeded understudy slot, so the strictly-earlier
    // gate keeps the real multi-vm slot unfilled.
    const members = [
      { id: 'dana', name: 'Dana', include: true, roles: [], understudyFor: ['multi-vm'] },
    ]
    const events = [evt('2026-02-01', ['multi-vm'])]

    const result = generateRoster(
      events, members, [], [], constraints(), {}, rosterPeriod
    )

    const realSlot = result.events[0].roster.find(r => r.role === 'multi-vm')
    expect(realSlot.member_id).toBeNull()
  })

  it('lets a trainee fill an understudy slot, then the real role afterwards', () => {
    const members = [
      { id: 'dana', name: 'Dana', include: true, roles: [], understudyFor: ['multi-vm'] },
    ]
    const events = [
      evt('2026-02-01', ['multi-vm-understudy']),
      evt('2026-02-08', ['multi-vm']),
    ]

    const result = generateRoster(
      events, members, [], [], constraints(), {}, rosterPeriod
    )

    // Understudy slot filled on the earlier date...
    expect(result.events[0].roster[0].member_id).toBe('dana')
    // ...which unlocks the real role on the later date.
    expect(result.events[1].roster[0].member_id).toBe('dana')
  })

  it('does not unlock the real role on the SAME date as the understudy slot', () => {
    const members = [
      { id: 'dana', name: 'Dana', include: true, roles: [], understudyFor: ['multi-vm'] },
    ]
    // Understudy and real slots on the same day: strictly-earlier requires a
    // prior date, so the real-role slot must stay empty.
    const events = [evt('2026-02-01', ['multi-vm-understudy', 'multi-vm'])]

    const result = generateRoster(
      events, members, [], [], constraints(), {}, rosterPeriod
    )

    const understudySlot = result.events[0].roster.find(r => r.role === 'multi-vm-understudy')
    const realSlot = result.events[0].roster.find(r => r.role === 'multi-vm')
    expect(understudySlot.member_id).toBe('dana')
    expect(realSlot.member_id).toBeNull()
  })

  it('does not gate a full performer of the role', () => {
    const members = [
      { id: 'fred', name: 'Fred', include: true, roles: ['multi-vm'], understudyFor: [] },
    ]
    const events = [evt('2026-02-01', ['multi-vm'])]

    const result = generateRoster(
      events, members, [], [], constraints(), {}, rosterPeriod
    )

    expect(result.events[0].roster[0].member_id).toBe('fred')
  })

  it('allows the real role without understudy when the constraint is disabled', () => {
    const members = [
      { id: 'dana', name: 'Dana', include: true, roles: [], understudyFor: ['multi-vm'] },
    ]
    const events = [evt('2026-02-01', ['multi-vm'])]

    const result = generateRoster(
      events, members, [], [],
      constraints({ [CONSTRAINT_KEYS.ENFORCE_UNDERSTUDY_BEFORE_ROLE]: false }),
      {}, rosterPeriod
    )

    // With the gate off, a trainee is treated as a full performer.
    expect(result.events[0].roster[0].member_id).toBe('dana')
  })

  it('caps understudy at one session: a second understudy slot is not re-filled by the same trainee', () => {
    // Dana understudies on the first date; the second understudy slot must NOT
    // go to her again (she is already qualified) — it stays empty since she is
    // the only trainee.
    const members = [
      { id: 'dana', name: 'Dana', include: true, roles: [], understudyFor: ['multi-vm'] },
    ]
    const events = [
      evt('2026-02-01', ['multi-vm-understudy']),
      evt('2026-02-08', ['multi-vm-understudy']),
    ]

    const result = generateRoster(
      events, members, [], [], constraints(), {}, rosterPeriod
    )

    expect(result.events[0].roster[0].member_id).toBe('dana')
    // Already completed her one session -> blocked from understudying again.
    expect(result.events[1].roster[0].member_id).toBeNull()
  })

  it('prefers promoting an unlocked trainee into the real role over a full performer', () => {
    // Dana trains for multi-vm and understudies on the first date. On the later
    // date both Dana (now unlocked) and Fred (full performer) are eligible for
    // the real role; the promote-understudy preference should pick Dana.
    const members = [
      { id: 'dana', name: 'Dana', include: true, roles: [], understudyFor: ['multi-vm'] },
      { id: 'fred', name: 'Fred', include: true, roles: ['multi-vm'], understudyFor: [] },
    ]
    const events = [
      evt('2026-02-01', ['multi-vm-understudy']),
      evt('2026-02-08', ['multi-vm']),
    ]

    const result = generateRoster(
      events, members, [], [], constraints(), {}, rosterPeriod
    )

    expect(result.events[0].roster[0].member_id).toBe('dana')
    expect(result.events[1].roster[0].member_id).toBe('dana')
  })
})

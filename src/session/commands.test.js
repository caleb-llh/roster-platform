import { describe, it, expect } from 'vitest'
import { assign, addSlot, removeSlot, swap, clearGenerated, bulkClear } from './commands'
import { slotKey } from '../utils/bulkClear'

// Minimal derived-state shape the commands consume (a subset of toState's output
// plus externalAssignments). Members are role-capable and available unless a
// memberConstraint says otherwise.
const makeMembers = () => [
  { id: 'alice', name: 'Alice', roles: ['vm', 'cam-1'], included: true },
  { id: 'bob', name: 'Bob', roles: ['vm', 'cam-1', 'cam-2'], included: true },
  { id: 'cara', name: 'Cara', roles: ['vm'], included: true },
]

const makeEvents = () => [
  {
    date: '2026-08-01', name: 'Morning', day_of_week: 'Saturday',
    roster: [
      { role: 'vm', member_id: 'alice' },
      { role: 'cam-1', member_id: 'bob', isGenerated: true },
      { role: 'cam-2', member_id: null },
    ],
  },
  {
    date: '2026-08-02', name: 'Evening', day_of_week: 'Sunday',
    roster: [{ role: 'vm', member_id: 'cara' }],
  },
]

const makeState = (over = {}) => ({
  events: makeEvents(),
  members: makeMembers(),
  memberConstraints: [],
  memberPreferences: [],
  rosterConstraints: {},
  rosterPreferences: {},
  rosterPeriod: null,
  externalAssignments: {},
  ...over,
})

const slotAt = (events, date, idx) =>
  events.find((e) => e.date === date).roster[idx]

describe('session/commands', () => {
  describe('assign', () => {
    it('inserts a member into an empty slot and clears the generated tag', () => {
      const state = makeState()
      const r = assign(state, { eventDate: '2026-08-01', roleIndex: 2, memberId: 'bob' })
      expect(r.ok).toBe(true)
      expect(slotAt(r.nextEvents, '2026-08-01', 2)).toEqual({ role: 'cam-2', member_id: 'bob', isGenerated: false })
      expect(r.logEntry.category).toBe('insert')
      // does not mutate input
      expect(slotAt(state.events, '2026-08-01', 2).member_id).toBeNull()
    })

    it('removes an occupant when memberId is null', () => {
      const r = assign(makeState(), { eventDate: '2026-08-01', roleIndex: 0, memberId: null })
      expect(slotAt(r.nextEvents, '2026-08-01', 0).member_id).toBeNull()
      expect(r.logEntry.category).toBe('delete')
    })

    it('warn-still-applies: an unavailable member produces a warning but still applies', () => {
      const state = makeState({
        memberConstraints: [{ member_id: 'alice', unavailable_dates: ['2026-08-01'] }],
      })
      const r = assign(state, { eventDate: '2026-08-01', roleIndex: 2, memberId: 'alice' })
      expect(r.ok).toBe(true) // NOT rejected
      expect(slotAt(r.nextEvents, '2026-08-01', 2).member_id).toBe('alice') // applied
      expect(r.verdict.warnings.some((w) => /unavailable/i.test(w))).toBe(true)
    })
  })

  describe('addSlot', () => {
    it('adds an unassigned role requirement', () => {
      const r = addSlot(makeState(), { eventDate: '2026-08-02', role: 'cam-1' })
      const roster = r.nextEvents.find((e) => e.date === '2026-08-02').roster
      expect(roster).toContainEqual({ role: 'cam-1', member_id: null })
      expect(r.logEntry.category).toBe('insert')
    })

    it('is a no-op for a duplicate role', () => {
      const r = addSlot(makeState(), { eventDate: '2026-08-01', role: 'vm' })
      expect(r.nextEvents).toBeNull()
      expect(r.logEntry).toBeNull()
    })
  })

  describe('removeSlot', () => {
    it('removes the whole role slot', () => {
      const r = removeSlot(makeState(), { eventDate: '2026-08-01', roleIndex: 1 })
      const roster = r.nextEvents.find((e) => e.date === '2026-08-01').roster
      expect(roster.map((s) => s.role)).toEqual(['vm', 'cam-2'])
      expect(r.logEntry.category).toBe('delete')
    })
  })

  describe('swap', () => {
    it('swaps two valid occupants', () => {
      // alice (vm) <-> bob (cam-1): both role-capable of the other's slot
      const r = swap(makeState(), {
        source: { eventDate: '2026-08-01', roleIndex: 0 },
        target: { eventDate: '2026-08-01', roleIndex: 1 },
      })
      expect(r.ok).toBe(true)
      expect(slotAt(r.nextEvents, '2026-08-01', 0).member_id).toBe('bob')
      expect(slotAt(r.nextEvents, '2026-08-01', 1).member_id).toBe('alice')
      expect(r.preview).toBeDefined()
    })

    it('HARD rejects an infeasible swap (role-incapable)', () => {
      // cara (vm-only) cannot take cam-1
      const r = swap(makeState(), {
        source: { eventDate: '2026-08-02', roleIndex: 0 }, // cara @ vm
        target: { eventDate: '2026-08-01', roleIndex: 1 }, // bob @ cam-1
      })
      expect(r.ok).toBe(false)
      expect(r.reason).toMatch(/can't fill/i)
      expect(r.nextEvents).toBeNull()
    })
  })

  describe('clearGenerated', () => {
    it('clears generated slots, keeps the role, and counts them', () => {
      const r = clearGenerated(makeState())
      expect(r.count).toBe(1)
      expect(slotAt(r.nextEvents, '2026-08-01', 1)).toEqual({ role: 'cam-1', member_id: null })
    })

    it('is a no-op when nothing is generated', () => {
      const state = makeState()
      state.events[0].roster[1] = { role: 'cam-1', member_id: 'bob' } // drop isGenerated
      const r = clearGenerated(state)
      expect(r.nextEvents).toBeNull()
    })
  })

  describe('bulkClear', () => {
    it('empties selected filled slots, keeps role, counts them', () => {
      const r = bulkClear(makeState(), { selectedSlots: [slotKey('2026-08-01', 0)] })
      expect(r.count).toBe(1)
      expect(slotAt(r.nextEvents, '2026-08-01', 0).member_id).toBeNull()
    })
  })
})

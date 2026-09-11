import { describe, it, expect } from 'vitest'
import { buildBulkClear } from './bulkClear'
import { slotKey } from '../lib/slotKey'

const makeEvents = () => [
  {
    date: '2026-08-01',
    name: 'Morning',
    roster: [
      { role: 'vm', member_id: 'alice' },
      { role: 'cam-1', member_id: 'bob', isGenerated: true },
      { role: 'cam-2', member_id: null },
    ],
  },
  {
    date: '2026-08-02',
    name: 'Evening',
    roster: [
      { role: 'vm', member_id: 'cara' },
    ],
  },
]

describe('buildBulkClear', () => {
  it('clears the member but keeps the role slot', () => {
    const events = makeEvents()
    const { nextEvents, count } = buildBulkClear(events, [slotKey('2026-08-01', 0)])
    expect(count).toBe(1)
    expect(nextEvents[0].roster).toHaveLength(3)
    expect(nextEvents[0].roster[0]).toEqual({ role: 'vm', member_id: null })
  })

  it('drops the isGenerated tag when clearing a generated slot', () => {
    const events = makeEvents()
    const { nextEvents, count } = buildBulkClear(events, [slotKey('2026-08-01', 1)])
    expect(count).toBe(1)
    expect(nextEvents[0].roster[1]).toEqual({ role: 'cam-1', member_id: null })
    expect('isGenerated' in nextEvents[0].roster[1]).toBe(false)
  })

  it('ignores already-empty slots (no count, no change)', () => {
    const events = makeEvents()
    const { nextEvents, count } = buildBulkClear(events, [slotKey('2026-08-01', 2)])
    expect(count).toBe(0)
    expect(nextEvents[0]).toBe(events[0]) // untouched reference
  })

  it('ignores unknown keys', () => {
    const events = makeEvents()
    const { nextEvents, count } = buildBulkClear(events, [slotKey('2099-01-01', 0), slotKey('2026-08-01', 99)])
    expect(count).toBe(0)
    expect(nextEvents[0]).toBe(events[0]) // untouched events keep their reference
    expect(nextEvents[1]).toBe(events[1])
  })

  it('clears across multiple events in one pass', () => {
    const events = makeEvents()
    const { nextEvents, count } = buildBulkClear(events, [
      slotKey('2026-08-01', 0),
      slotKey('2026-08-01', 1),
      slotKey('2026-08-02', 0),
    ])
    expect(count).toBe(3)
    expect(nextEvents[0].roster[0].member_id).toBe(null)
    expect(nextEvents[0].roster[1].member_id).toBe(null)
    expect(nextEvents[1].roster[0].member_id).toBe(null)
  })

  it('does not mutate the input events', () => {
    const events = makeEvents()
    const snapshot = JSON.stringify(events)
    buildBulkClear(events, [slotKey('2026-08-01', 0)])
    expect(JSON.stringify(events)).toBe(snapshot)
  })

  it('returns the same array when keys is empty', () => {
    const events = makeEvents()
    const { nextEvents, count } = buildBulkClear(events, [])
    expect(count).toBe(0)
    expect(nextEvents).toBe(events)
  })

  it('accepts a Set of keys', () => {
    const events = makeEvents()
    const { count } = buildBulkClear(events, new Set([slotKey('2026-08-01', 0)]))
    expect(count).toBe(1)
  })
})

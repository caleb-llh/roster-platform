import { describe, it, expect } from 'vitest'
import { slotKey, dateOfSlotKey } from './slotKey'

describe('slotKey', () => {
  it('joins date and role index with the shared "#" delimiter', () => {
    expect(slotKey('2026-08-01', 0)).toBe('2026-08-01#0')
    expect(slotKey('2026-08-01', 12)).toBe('2026-08-01#12')
  })

  it('round-trips the date half via dateOfSlotKey', () => {
    expect(dateOfSlotKey(slotKey('2026-08-01', 3))).toBe('2026-08-01')
  })

  it('dateOfSlotKey coerces non-string keys before splitting', () => {
    // Guards the bulk-clear call site, where set members may not be strings.
    expect(dateOfSlotKey(12345)).toBe('12345')
  })
})

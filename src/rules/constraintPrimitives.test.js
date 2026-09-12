import { describe, it, expect } from 'vitest'
import {
  getMondayOfWeek,
  getWeekKey,
  isMemberAvailable,
  isMemberUnavailable,
  isAssignedToEvent,
  countMonthlyAssignments,
  getWeekAssignments,
  areConsecutiveWeekends,
  getMembersWithMultipleRoles,
  eventInterval,
  intervalsOverlap,
  eventsClash
} from './constraintPrimitives'

describe('interval model', () => {
  describe('eventInterval', () => {
    it('treats a bare date as the whole local day [00:00, next 00:00)', () => {
      const { start, end } = eventInterval({ date: '2026-04-01' })
      expect(new Date(start).getHours()).toBe(0)
      expect(end - start).toBe(24 * 60 * 60 * 1000)
    })
    it('uses explicit start/end datetimes when present', () => {
      const iv = eventInterval({ date: '2026-04-01', start: '2026-04-01T18:00', end: '2026-04-01T20:00' })
      expect(iv.end - iv.start).toBe(2 * 60 * 60 * 1000)
    })
    it('returns null for an unparseable event', () => {
      expect(eventInterval(null)).toBeNull()
      expect(eventInterval({})).toBeNull()
    })
  })

  describe('intervalsOverlap (half-open)', () => {
    const a = { start: 0, end: 10 }
    it('overlaps when ranges intersect', () => {
      expect(intervalsOverlap(a, { start: 5, end: 15 })).toBe(true)
    })
    it('does NOT overlap on a touching boundary (back-to-back)', () => {
      expect(intervalsOverlap(a, { start: 10, end: 20 })).toBe(false)
    })
    it('does not overlap when disjoint', () => {
      expect(intervalsOverlap(a, { start: 20, end: 30 })).toBe(false)
    })
  })

  describe('eventsClash', () => {
    it('two same-day bare-date events clash (subsumes the old model)', () => {
      expect(eventsClash({ date: '2026-04-01' }, { date: '2026-04-01' })).toBe(true)
    })
    it('different bare-date days do not clash', () => {
      expect(eventsClash({ date: '2026-04-01' }, { date: '2026-04-02' })).toBe(false)
    })
    it('same-day non-overlapping timed events do not clash', () => {
      const morning = { date: '2026-04-01', start: '2026-04-01T09:00', end: '2026-04-01T11:00' }
      const evening = { date: '2026-04-01', start: '2026-04-01T18:00', end: '2026-04-01T20:00' }
      expect(eventsClash(morning, evening)).toBe(false)
    })
    it('same-day overlapping timed events clash', () => {
      const a = { date: '2026-04-01', start: '2026-04-01T09:00', end: '2026-04-01T12:00' }
      const b = { date: '2026-04-01', start: '2026-04-01T11:00', end: '2026-04-01T13:00' }
      expect(eventsClash(a, b)).toBe(true)
    })
  })
})

describe('constraintPrimitives', () => {
  describe('getMondayOfWeek', () => {
    it('should return a Monday for any date', () => {
      expect(getMondayOfWeek('2026-02-03').getDay()).toBe(1) // Tuesday -> Monday
      expect(getMondayOfWeek('2026-02-07').getDay()).toBe(1) // Saturday -> Monday
      expect(getMondayOfWeek('2026-02-08').getDay()).toBe(1) // Sunday -> Monday
    })

    it('should return same Monday for dates in same week', () => {
      const mon1 = getMondayOfWeek('2026-02-03')
      const mon2 = getMondayOfWeek('2026-02-07')
      const mon3 = getMondayOfWeek('2026-02-08')
      
      expect(mon1.getTime()).toBe(mon2.getTime())
      expect(mon2.getTime()).toBe(mon3.getTime())
    })
  })

  describe('getWeekKey', () => {
    it('should return same week key for dates in the same week', () => {
      const key1 = getWeekKey('2026-02-03') // Tuesday
      const key2 = getWeekKey('2026-02-07') // Saturday
      const key3 = getWeekKey('2026-02-08') // Sunday
      
      expect(key1).toBe(key2)
      expect(key2).toBe(key3)
    })

    it('should return different week keys for different weeks', () => {
      const key1 = getWeekKey('2026-02-07')
      const key2 = getWeekKey('2026-02-14')
      
      expect(key1).not.toBe(key2)
    })
  })

  describe('isMemberAvailable', () => {
    const constraints = [
      { member_id: 'alice', unavailable_dates: ['2026-02-07'] }
    ]

    it('should return false when member is unavailable', () => {
      expect(isMemberAvailable('alice', '2026-02-07', constraints)).toBe(false)
    })

    it('should return true when member is available', () => {
      expect(isMemberAvailable('alice', '2026-02-08', constraints)).toBe(true)
    })
  })

  describe('isMemberUnavailable', () => {
    const constraints = [
      {
        member_id: 'john',
        unavailable_dates: [
          '2026-02-14',
          '2026-02-15',
          { start: '2026-03-01', end: '2026-03-15' }
        ]
      },
      {
        member_id: 'jane',
        unavailable_dates: ['2026-02-20']
      }
    ]

    it('should return true for single date match', () => {
      expect(isMemberUnavailable('john', '2026-02-14', constraints)).toBe(true)
      expect(isMemberUnavailable('john', '2026-02-15', constraints)).toBe(true)
    })

    it('should return false for dates not in constraint list', () => {
      expect(isMemberUnavailable('john', '2026-02-16', constraints)).toBe(false)
    })

    it('should return true for dates within range', () => {
      expect(isMemberUnavailable('john', '2026-03-01', constraints)).toBe(true)
      expect(isMemberUnavailable('john', '2026-03-08', constraints)).toBe(true)
      expect(isMemberUnavailable('john', '2026-03-15', constraints)).toBe(true)
    })

    it('should return false for dates outside range', () => {
      expect(isMemberUnavailable('john', '2026-02-28', constraints)).toBe(false)
      expect(isMemberUnavailable('john', '2026-03-16', constraints)).toBe(false)
    })

    it('should return false for member with no constraints', () => {
      expect(isMemberUnavailable('alice', '2026-02-14', constraints)).toBe(false)
    })

    it('should handle empty constraints array', () => {
      expect(isMemberUnavailable('john', '2026-02-14', [])).toBe(false)
    })

    it('should handle null/undefined constraints', () => {
      expect(isMemberUnavailable('john', '2026-02-14', null)).toBe(false)
      expect(isMemberUnavailable('john', '2026-02-14', undefined)).toBe(false)
    })
  })

  describe('isAssignedToEvent', () => {
    const roster = [
      { role: 'vm', member_id: 'alice' },
      { role: 'cam-1', member_id: 'bob' }
    ]

    it('should return true when member is assigned', () => {
      expect(isAssignedToEvent('alice', roster)).toBe(true)
    })

    it('should return false when member is not assigned', () => {
      expect(isAssignedToEvent('charlie', roster)).toBe(false)
    })
  })

  describe('countMonthlyAssignments', () => {
    const events = [
      { date: '2026-02-01', roster: [{ member_id: 'alice' }] },
      { date: '2026-02-15', roster: [{ member_id: 'alice' }] },
      { date: '2026-03-01', roster: [{ member_id: 'alice' }] }
    ]

    it('should count assignments in the same month', () => {
      expect(countMonthlyAssignments('alice', '2026-02-01', events)).toBe(2)
    })

    it('should only count the target month', () => {
      expect(countMonthlyAssignments('alice', '2026-03-01', events)).toBe(1)
    })
  })

  describe('getWeekAssignments', () => {
    const events = [
      { date: '2026-02-03', roster: [{ member_id: 'alice' }] }, // Tue
      { date: '2026-02-07', roster: [{ member_id: 'alice' }] }, // Sat (same week)
      { date: '2026-02-10', roster: [{ member_id: 'alice' }] }, // next week
    ]

    it('returns events in the same week as the target date', () => {
      const result = getWeekAssignments('alice', '2026-02-03', events)
      expect(result).toHaveLength(2)
    })

    it('returns empty for an invalid date', () => {
      expect(getWeekAssignments('alice', 'not-a-date', events)).toEqual([])
    })
  })

  describe('areConsecutiveWeekends', () => {
    it('should return true for consecutive Saturdays', () => {
      expect(areConsecutiveWeekends('2026-02-07', '2026-02-14')).toBe(true)
    })

    it('should return true for Saturday to next Sunday', () => {
      expect(areConsecutiveWeekends('2026-02-07', '2026-02-15')).toBe(true)
    })

    it('should return false for non-consecutive weekends', () => {
      expect(areConsecutiveWeekends('2026-02-07', '2026-02-21')).toBe(false)
    })

    it('should return false when dates are not weekends', () => {
      expect(areConsecutiveWeekends('2026-02-02', '2026-02-09')).toBe(false)
    })

    it('should return false for same weekend dates', () => {
      expect(areConsecutiveWeekends('2026-02-07', '2026-02-08')).toBe(false)
    })
  })

  describe('getMembersWithMultipleRoles', () => {
    it('should return members assigned to multiple roles', () => {
      const roster = [
        { role: 'vm', member_id: 'alice' },
        { role: 'cam-1', member_id: 'alice' },
        { role: 'cam-2', member_id: 'bob' }
      ]

      const result = getMembersWithMultipleRoles(roster)
      expect(result).toHaveLength(1)
      expect(result[0].memberId).toBe('alice')
      expect(result[0].roles).toEqual(['vm', 'cam-1'])
    })

    it('should return empty array when no members have multiple roles', () => {
      const roster = [
        { role: 'vm', member_id: 'alice' },
        { role: 'cam-1', member_id: 'bob' }
      ]

      const result = getMembersWithMultipleRoles(roster)
      expect(result).toHaveLength(0)
    })
  })
})

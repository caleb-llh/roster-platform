import { describe, it, expect } from 'vitest'
import {
  getMondayOfWeek,
  getWeekKey,
  isMemberAvailable,
  isMemberUnavailable,
  getAvailableMembersForEvent,
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

  describe('getAvailableMembersForEvent', () => {
    const members = [
      { id: 'john', name: 'John', include: true, roles: ['vm', 'cam-1'] },
      { id: 'jane', name: 'Jane', include: true, roles: ['vm'] },
      { id: 'bob', name: 'Bob', include: false, roles: ['vm'] },
      { id: 'alice', name: 'Alice', include: true, roles: ['cam-1'] }
    ]

    const constraints = [
      {
        member_id: 'john',
        unavailable_dates: ['2026-02-14']
      }
    ]

    const event = {
      date: '2026-02-14',
      roster: [
        { role: 'vm', member_id: 'john' },
        { role: 'cam-1', member_id: null }
      ]
    }

    it('should return availability for all roster roles', () => {
      const result = getAvailableMembersForEvent(event, members, constraints)
      
      expect(result).toHaveProperty('vm')
      expect(result).toHaveProperty('cam-1')
    })

    it('should mark assigned member', () => {
      const result = getAvailableMembersForEvent(event, members, constraints)
      
      const johnEntry = result.vm.find(m => m.id === 'john')
      expect(johnEntry.assigned).toBe(true)
    })

    it('should mark unavailable members correctly', () => {
      const result = getAvailableMembersForEvent(event, members, constraints)
      
      const johnEntry = result.vm.find(m => m.id === 'john')
      expect(johnEntry.available).toBe(false) // John unavailable on 2026-02-14
      
      const janeEntry = result.vm.find(m => m.id === 'jane')
      expect(janeEntry.available).toBe(true) // Jane has no constraints
    })

    it('should exclude members with include:false', () => {
      const result = getAvailableMembersForEvent(event, members, constraints)
      
      const bobEntry = result.vm.find(m => m.id === 'bob')
      expect(bobEntry).toBeUndefined() // Bob should be excluded
    })

    it('should only include qualified members', () => {
      const result = getAvailableMembersForEvent(event, members, constraints)
      
      // Alice doesn't have 'vm' role
      const aliceInVM = result.vm.find(m => m.id === 'alice')
      expect(aliceInVM).toBeUndefined()
      
      // But Alice has 'cam-1' role
      const aliceInCam = result['cam-1'].find(m => m.id === 'alice')
      expect(aliceInCam).toBeDefined()
    })

    it('should handle event with no roster', () => {
      const emptyEvent = { date: '2026-02-14', roster: [] }
      const result = getAvailableMembersForEvent(emptyEvent, members, constraints)
      
      expect(Object.keys(result)).toHaveLength(0)
    })

    it('should handle event with undefined roster', () => {
      const noRosterEvent = { date: '2026-02-14' }
      const result = getAvailableMembersForEvent(noRosterEvent, members, constraints)
      
      expect(result).toEqual({})
    })

    describe('duplicate roles in one event', () => {
      // The roster is a positional array, so the same role can occupy more than
      // one slot (e.g. two 'vm'). Availability is per-role (identical for every
      // slot of that role), but 'assigned' must reflect ANY slot's occupant.
      const dupEvent = {
        date: '2026-03-01',
        roster: [
          { role: 'vm', member_id: 'john' },
          { role: 'vm', member_id: 'jane' },
        ],
      }

      it('lists the duplicated role once (availability is per-role)', () => {
        const result = getAvailableMembersForEvent(dupEvent, members, [])
        expect(Object.keys(result)).toEqual(['vm'])
      })

      it('marks EVERY occupant of the duplicated role as assigned', () => {
        const result = getAvailableMembersForEvent(dupEvent, members, [])
        // Regression: previously the last slot overwrote the first, so only
        // Jane showed assigned. Both must now be marked.
        expect(result.vm.find(m => m.id === 'john').assigned).toBe(true)
        expect(result.vm.find(m => m.id === 'jane').assigned).toBe(true)
      })
    })

    describe('promoted understudies in real-role slots', () => {
      const uMembers = [
        { id: 'perf', name: 'Perf', roles: ['multi-vm'], understudyFor: [] },
        { id: 'trainee', name: 'Trainee', roles: ['vm'], understudyFor: ['multi-vm'] },
      ]
      const allEvents = [
        { date: '2026-02-01', roster: [{ role: 'multi-vm-understudy', member_id: 'trainee' }] },
        { date: '2026-02-08', roster: [{ role: 'multi-vm', member_id: null }] },
      ]

      it('lists a promoted trainee for a real role once they have understudied earlier', () => {
        const result = getAvailableMembersForEvent(allEvents[1], uMembers, [], allEvents)
        const ids = result['multi-vm'].map(m => m.id)
        expect(ids).toContain('trainee')
        const trainee = result['multi-vm'].find(m => m.id === 'trainee')
        expect(trainee.isUnderstudy).toBe(true)
        // Full performers are not marked as understudies.
        expect(result['multi-vm'].find(m => m.id === 'perf').isUnderstudy).toBe(false)
      })

      it('excludes a trainee who has not yet understudied (understudy-before-role)', () => {
        // First event only — the trainee has no earlier understudy session.
        const result = getAvailableMembersForEvent(allEvents[0], uMembers, [], allEvents)
        // The multi-vm-understudy slot lists the trainee (they may fill it)...
        expect(result['multi-vm-understudy'].map(m => m.id)).toContain('trainee')
        // ...but there is no real multi-vm slot in this event to be promoted into.
        const noPriorSessions = getAvailableMembersForEvent(
          { date: '2026-02-08', roster: [{ role: 'multi-vm', member_id: null }] },
          uMembers, [], [allEvents[1]] // only the later event: no earlier understudy
        )
        expect(noPriorSessions['multi-vm'].map(m => m.id)).not.toContain('trainee')
      })

      it('falls back to performers-only when allEvents is omitted', () => {
        const result = getAvailableMembersForEvent(allEvents[1], uMembers, [])
        expect(result['multi-vm'].map(m => m.id)).toEqual(['perf'])
      })
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

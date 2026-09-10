import { describe, it, expect } from 'vitest'
import { validateEventAssignments } from './assignmentValidator'
import { CONSTRAINT_KEYS, PREFERENCE_KEYS } from '../schema/rosterSchema'

describe('assignmentValidator', () => {
  const mockMembers = [
    { id: 'alice', name: 'Alice' },
    { id: 'bob', name: 'Bob' },
    { id: 'charlie', name: 'Charlie' }
  ]

  describe('checkUnavailabilityViolation', () => {
    it('should detect when member is unavailable on single date', () => {
      const events = [{
        date: '2026-02-15',
        day_of_week: 'Sunday',
        roster: [{ role: 'vm', member_id: 'alice' }]
      }]
      const memberConstraints = [{
        member_id: 'alice',
        unavailable_dates: ['2026-02-15']
      }]

      const result = validateEventAssignments(events, mockMembers, memberConstraints, [], {}, {})
      
      expect(result['2026-02-15']).toBeDefined()
      expect(result['2026-02-15'].errors).toContain('Alice is unavailable on this date')
    })

    it('should detect when member is unavailable in date range', () => {
      const events = [{
        date: '2026-02-20',
        day_of_week: 'Friday',
        roster: [{ role: 'cam-1', member_id: 'bob' }]
      }]
      const memberConstraints = [{
        member_id: 'bob',
        unavailable_dates: [
          { start: '2026-02-15', end: '2026-02-28' }
        ]
      }]

      const result = validateEventAssignments(events, mockMembers, memberConstraints, [], {}, {})
      
      expect(result['2026-02-20'].errors).toContain('Bob is unavailable on this date')
    })

    it('should not flag when member is available', () => {
      const events = [{
        date: '2026-03-01',
        day_of_week: 'Sunday',
        roster: [{ role: 'vm', member_id: 'alice' }]
      }]
      const memberConstraints = [{
        member_id: 'alice',
        unavailable_dates: ['2026-02-15']
      }]

      const result = validateEventAssignments(events, mockMembers, memberConstraints, [], {}, {})
      
      expect(result['2026-03-01']).toBeUndefined()
    })
  })

  describe('ONLY_ONCE_PER_EVENT constraint', () => {
    it('should detect when member is assigned to multiple roles on same event', () => {
      const events = [{
        date: '2026-03-08',
        day_of_week: 'Sunday',
        roster: [
          { role: 'vm', member_id: 'alice' },
          { role: 'cam-1', member_id: 'alice' }
        ]  }]
      const rosterConstraints = {
        [CONSTRAINT_KEYS.ONLY_ONCE_PER_EVENT]: true
      }

      const result = validateEventAssignments(events, mockMembers, [], [], rosterConstraints, {})
      
      expect(result['2026-03-08']).toBeDefined()
      expect(result['2026-03-08'].errors).toHaveLength(1)
      expect(result['2026-03-08'].errors[0]).toContain('Alice is assigned to multiple roles: vm, cam-1')
    })

    it('should detect when member is assigned to more than 2 roles', () => {
      const events = [{
        date: '2026-03-08',
        day_of_week: 'Sunday',
        roster: [
          { role: 'vm', member_id: 'bob' },
          { role: 'cam-1', member_id: 'bob' },
          { role: 'cam-2', member_id: 'bob' }
        ]
      }]
      const rosterConstraints = {
        [CONSTRAINT_KEYS.ONLY_ONCE_PER_EVENT]: true
      }

      const result = validateEventAssignments(events, mockMembers, [], [], rosterConstraints, {})
      
      expect(result['2026-03-08'].errors[0]).toContain('Bob is assigned to multiple roles: vm, cam-1, cam-2')
    })

    it('should not flag when different members have different roles', () => {
      const events = [{
        date: '2026-03-08',
        day_of_week: 'Sunday',
        roster: [
          { role: 'vm', member_id: 'alice' },
          { role: 'cam-1', member_id: 'bob' }
        ]
      }]
      const rosterConstraints = {
        [CONSTRAINT_KEYS.ONLY_ONCE_PER_EVENT]: true
      }

      const result = validateEventAssignments(events, mockMembers, [], [], rosterConstraints, {})
      
      expect(result['2026-03-08']).toBeUndefined()
    })

    it('should not check for multiple roles when constraint is false', () => {
      const events = [{
        date: '2026-03-08',
        day_of_week: 'Sunday',
        roster: [
          { role: 'vm', member_id: 'alice' },
          { role: 'cam-1', member_id: 'alice' }
        ]
      }]
      const rosterConstraints = {
        [CONSTRAINT_KEYS.ONLY_ONCE_PER_EVENT]: false
      }

      const result = validateEventAssignments(events, mockMembers, [], [], rosterConstraints, {})
      
      expect(result['2026-03-08']).toBeUndefined()
    })

    it('should not check for multiple roles when constraint is not specified', () => {
      const events = [{
        date: '2026-03-08',
        day_of_week: 'Sunday',
        roster: [
          { role: 'vm', member_id: 'alice' },
          { role: 'cam-1', member_id: 'alice' }
        ]
      }]
      const rosterConstraints = {}

      const result = validateEventAssignments(events, mockMembers, [], [], rosterConstraints, {})
      
      expect(result['2026-03-08']).toBeUndefined()
    })
  })

  describe('ENFORCE_NO_CLASH constraint', () => {
    // Two same-day events overlap (bare dates are whole days), so a member in
    // both is a clash across events (distinct from once-per-event, which is
    // within one event).
    const twoSameDayEvents = () => ([
      { name: 'Morning', date: '2026-05-10', day_of_week: 'Sunday', roster: [{ role: 'vm', member_id: 'alice' }] },
      { name: 'Evening', date: '2026-05-10', day_of_week: 'Sunday', roster: [{ role: 'cam-1', member_id: 'alice' }] },
    ])

    it('flags a member rostered on two overlapping events', () => {
      const rosterConstraints = { [CONSTRAINT_KEYS.ENFORCE_NO_CLASH]: true }
      const result = validateEventAssignments(twoSameDayEvents(), mockMembers, [], [], rosterConstraints, {})
      expect(result['2026-05-10']).toBeDefined()
      expect(result['2026-05-10'].errors.some(e => e.includes('overlaps this event'))).toBe(true)
    })

    it('does not flag non-overlapping timed events on the same day', () => {
      const rosterConstraints = { [CONSTRAINT_KEYS.ENFORCE_NO_CLASH]: true }
      const events = [
        { name: 'AM', date: '2026-05-10', start: '2026-05-10T09:00', end: '2026-05-10T11:00', roster: [{ role: 'vm', member_id: 'alice' }] },
        { name: 'PM', date: '2026-05-10', start: '2026-05-10T18:00', end: '2026-05-10T20:00', roster: [{ role: 'cam-1', member_id: 'alice' }] },
      ]
      const result = validateEventAssignments(events, mockMembers, [], [], rosterConstraints, {})
      expect(result['2026-05-10']).toBeUndefined()
    })

    it('does not check clash when the constraint is disabled', () => {
      const rosterConstraints = { [CONSTRAINT_KEYS.ENFORCE_NO_CLASH]: false }
      const result = validateEventAssignments(twoSameDayEvents(), mockMembers, [], [], rosterConstraints, {})
      expect(result['2026-05-10']).toBeUndefined()
    })
  })

  describe('ONLY_ONCE_PER_WEEK constraint', () => {
    it('should detect when member is rostered twice in same week (Mon-Sun)', () => {
      const events = [
        {
          date: '2026-02-09', // Monday
          day_of_week: 'Monday',
          roster: [{ role: 'vm', member_id: 'alice' }]
        },
        {
          date: '2026-02-14', // Saturday (same week)
          day_of_week: 'Saturday',
          roster: [{ role: 'cam-1', member_id: 'alice' }]
        }
      ]
      const rosterConstraints = {
        ONLY_ONCE_PER_WEEK: true
      }

      const result = validateEventAssignments(events, mockMembers, [], [], rosterConstraints, {})
      
      // Both events should have errors
      expect(result['2026-02-09'].errors.some(e => e.includes('Alice') && e.includes('already rostered'))).toBe(true)
      expect(result['2026-02-14'].errors.some(e => e.includes('Alice') && e.includes('already rostered'))).toBe(true)
    })

    it('should not flag Saturday and Sunday of different weeks', () => {
      const events = [
        {
          date: '2026-03-08', // Sunday (week ending Mar 8)
          day_of_week: 'Sunday',
          roster: [{ role: 'vm', member_id: 'alice' }]
        },
        {
          date: '2026-03-14', // Saturday (week starting Mar 9)
          day_of_week: 'Saturday',
          roster: [{ role: 'cam-1', member_id: 'alice' }]
        }
      ]
      const rosterConstraints = {
        ONLY_ONCE_PER_WEEK: true
      }

      const result = validateEventAssignments(events, mockMembers, [], [], rosterConstraints, {})
      
      expect(result['2026-03-08']).toBeUndefined()
      expect(result['2026-03-14']).toBeUndefined()
    })

    it('should detect Saturday and Sunday of the same week', () => {
      const events = [
        {
          date: '2026-02-07', // Saturday
          day_of_week: 'Saturday',
          roster: [{ role: 'vm', member_id: 'alice' }]
        },
        {
          date: '2026-02-08', // Sunday (same week)
          day_of_week: 'Sunday',
          roster: [{ role: 'cam-1', member_id: 'alice' }]
        }
      ]
      const rosterConstraints = {
        ONLY_ONCE_PER_WEEK: true
      }

      const result = validateEventAssignments(events, mockMembers, [], [], rosterConstraints, {})
      
      // Both events should have errors (same week: Feb 2-8)
      expect(result['2026-02-07'].errors.some(e => e.includes('Alice') && e.includes('already rostered'))).toBe(true)
      expect(result['2026-02-08'].errors.some(e => e.includes('Alice') && e.includes('already rostered'))).toBe(true)
    })

    it('should not flag when member is rostered on different weeks', () => {
      const events = [
        {
          date: '2026-02-07',
          day_of_week: 'Saturday',
          roster: [{ role: 'vm', member_id: 'alice' }]
        },
        {
          date: '2026-02-15',
          day_of_week: 'Sunday',
          roster: [{ role: 'cam-1', member_id: 'alice' }]
        }
      ]
      const rosterConstraints = {
        ONLY_ONCE_PER_WEEK: true
      }

      const result = validateEventAssignments(events, mockMembers, [], [], rosterConstraints, {})
      
      expect(result['2026-02-07']).toBeUndefined()
      expect(result['2026-02-15']).toBeUndefined()
    })
  })

  describe('MAX_ASSIGNMENTS_PER_MONTH constraint', () => {
    it('should not flag when within monthly limit', () => {
      const events = [
        {
          date: '2026-02-07',
          day_of_week: 'Saturday',
          roster: [{ role: 'vm', member_id: 'alice' }]
        },
        {
          date: '2026-02-15',
          day_of_week: 'Sunday',
          roster: [{ role: 'cam-1', member_id: 'alice' }]
        }
      ]
      const rosterConstraints = {
        [CONSTRAINT_KEYS.MAX_ASSIGNMENTS_PER_MONTH]: 2
      }

      const result = validateEventAssignments(events, mockMembers, [], [], rosterConstraints, {})
      
      expect(result['2026-02-07']).toBeUndefined()
      expect(result['2026-02-15']).toBeUndefined()
    })
  })

  describe('AVOID_CONSECUTIVE_WEEKS preference', () => {
    it('should warn when member is rostered on consecutive weekends', () => {
      const events = [
        {
          date: '2026-02-07',
          day_of_week: 'Saturday',
          roster: [{ role: 'vm', member_id: 'alice' }]
        },
        {
          date: '2026-02-14',
          day_of_week: 'Saturday',
          roster: [{ role: 'cam-1', member_id: 'alice' }]
        }
      ]
      const rosterPreferences = {
        [PREFERENCE_KEYS.AVOID_CONSECUTIVE_WEEKS]: true
      }

      const result = validateEventAssignments(events, mockMembers, [], [], {}, rosterPreferences)
      
      expect(result['2026-02-07'].warnings.some(w => w.includes('Alice') && w.includes('consecutive weekend'))).toBe(true)
      expect(result['2026-02-14'].warnings.some(w => w.includes('Alice') && w.includes('consecutive weekend'))).toBe(true)
    })

    it('should not warn when weekends are not consecutive', () => {
      const events = [
        {
          date: '2026-02-07',
          day_of_week: 'Saturday',
          roster: [{ role: 'vm', member_id: 'alice' }]
        },
        {
          date: '2026-02-21',
          day_of_week: 'Saturday',
          roster: [{ role: 'cam-1', member_id: 'alice' }]
        }
      ]
      const rosterPreferences = {
        [PREFERENCE_KEYS.AVOID_CONSECUTIVE_WEEKS]: true
      }

      const result = validateEventAssignments(events, mockMembers, [], [], {}, rosterPreferences)
      
      expect(result['2026-02-07']).toBeUndefined()
      expect(result['2026-02-21']).toBeUndefined()
    })
  })

  describe('member day preferences', () => {
    it('should warn when member is assigned on non-preferred day', () => {
      const events = [{
        date: '2026-02-07',
        day_of_week: 'Saturday',
        roster: [{ role: 'vm', member_id: 'alice' }]
      }]
      const memberPreferences = [{
        member_id: 'alice',
        days: ['Sunday']
      }]

      const result = validateEventAssignments(events, mockMembers, [], memberPreferences, {}, {})
      
      expect(result['2026-02-07'].warnings).toContain('Alice prefers Sunday (not Saturday)')
    })

    it('should not warn when member is assigned on preferred day', () => {
      const events = [{
        date: '2026-02-08',
        day_of_week: 'Sunday',
        roster: [{ role: 'vm', member_id: 'alice' }]
      }]
      const memberPreferences = [{
        member_id: 'alice',
        days: ['Sunday']
      }]

      const result = validateEventAssignments(events, mockMembers, [], memberPreferences, {}, {})
      
      expect(result['2026-02-08']).toBeUndefined()
    })
  })

  describe('combined validations', () => {
    it('should detect multiple types of violations on same event', () => {
      const events = [{
        date: '2026-02-15',
        day_of_week: 'Sunday',
        roster: [
          { role: 'vm', member_id: 'alice' },
          { role: 'cam-1', member_id: 'alice' }
        ]
      }]
      const memberConstraints = [{
        member_id: 'alice',
        unavailable_dates: ['2026-02-15']
      }]
      const rosterConstraints = {
        [CONSTRAINT_KEYS.ONLY_ONCE_PER_EVENT]: true
      }

      const result = validateEventAssignments(events, mockMembers, memberConstraints, [], rosterConstraints, {})
      
      expect(result['2026-02-15'].errors).toHaveLength(2)
      expect(result['2026-02-15'].errors).toContain('Alice is unavailable on this date')
      expect(result['2026-02-15'].errors.some(e => e.includes('Alice is assigned to multiple roles'))).toBe(true)
    })

    it('should separate errors from warnings', () => {
      const events = [{
        date: '2026-02-08',
        day_of_week: 'Sunday',
        roster: [
          { role: 'vm', member_id: 'alice' },
          { role: 'cam-1', member_id: 'alice' }
        ]
      }]
      const memberPreferences = [{
        member_id: 'alice',
        days: ['Saturday']
      }]
      const rosterConstraints = {
        [CONSTRAINT_KEYS.ONLY_ONCE_PER_EVENT]: true
      }

      const result = validateEventAssignments(events, mockMembers, [], memberPreferences, rosterConstraints, {})
      
      expect(result['2026-02-08'].errors).toHaveLength(1)
      expect(result['2026-02-08'].warnings).toHaveLength(1)
      expect(result['2026-02-08'].errors[0]).toContain('Alice is assigned to multiple roles')
      expect(result['2026-02-08'].warnings[0]).toContain('Alice prefers Saturday')
    })
  })

  describe('edge cases', () => {
    it('should handle empty roster', () => {
      const events = [{
        date: '2026-02-15',
        day_of_week: 'Sunday',
        roster: []
      }]

      const result = validateEventAssignments(events, mockMembers, [], [], { [CONSTRAINT_KEYS.ONLY_ONCE_PER_EVENT]: true }, {})
      
      expect(result['2026-02-15']).toBeUndefined()
    })

    it('should handle unassigned roster slots', () => {
      const events = [{
        date: '2026-02-15',
        day_of_week: 'Sunday',
        roster: [
          { role: 'vm', member_id: null },
          { role: 'cam-1', member_id: '' }
        ]
      }]

      const result = validateEventAssignments(events, mockMembers, [], [], { [CONSTRAINT_KEYS.ONLY_ONCE_PER_EVENT]: true }, {})
      
      expect(result['2026-02-15']).toBeUndefined()
    })

    it('should handle multiple events on same date', () => {
      const events = [
        {
          date: '2026-02-15',
          day_of_week: 'Sunday',
          roster: [{ role: 'vm', member_id: 'alice' }]
        },
        {
          date: '2026-02-15',
          day_of_week: 'Sunday',
          roster: [
            { role: 'vm', member_id: 'bob' },
            { role: 'cam-1', member_id: 'bob' }
          ]
        }
      ]
      const rosterConstraints = {
        [CONSTRAINT_KEYS.ONLY_ONCE_PER_EVENT]: true
      }

      const result = validateEventAssignments(events, mockMembers, [], [], rosterConstraints, {})
      
      expect(result['2026-02-15']).toBeDefined()
      expect(result['2026-02-15'].errors).toHaveLength(1)
      expect(result['2026-02-15'].errors[0]).toContain('Bob is assigned to multiple roles')
    })

    it('should remove duplicate error messages', () => {
      const events = [{
        date: '2026-02-15',
        day_of_week: 'Sunday',
        roster: [
          { role: 'vm', member_id: 'alice' },
          { role: 'cam-1', member_id: 'alice' },
          { role: 'cam-2', member_id: 'alice' }
        ]
      }]
      const rosterConstraints = {
        [CONSTRAINT_KEYS.ONLY_ONCE_PER_EVENT]: true
      }

      const result = validateEventAssignments(events, mockMembers, [], [], rosterConstraints, {})
      
      // Should only have one error message, not multiple duplicates
      expect(result['2026-02-15'].errors).toHaveLength(1)
      expect(result['2026-02-15'].errors[0]).toContain('Alice is assigned to multiple roles: vm, cam-1, cam-2')
    })
  })

  describe('ENFORCE_UNDERSTUDY_BEFORE_ROLE constraint', () => {
    const understudyMembers = [
      // Trainee for multi-vm (understudyFor), performs vm.
      { id: 'dana', name: 'Dana', roles: ['vm'], understudyFor: ['multi-vm'] },
      // Full performer of multi-vm.
      { id: 'fred', name: 'Fred', roles: ['multi-vm'], understudyFor: [] }
    ]
    const rosterConstraints = { [CONSTRAINT_KEYS.ENFORCE_UNDERSTUDY_BEFORE_ROLE]: true }

    it('flags a trainee rostered for the real role before any understudy session', () => {
      const events = [{
        date: '2026-02-15',
        day_of_week: 'Sunday',
        roster: [{ role: 'multi-vm', member_id: 'dana' }]
      }]

      const result = validateEventAssignments(events, understudyMembers, [], [], rosterConstraints, {})

      expect(result['2026-02-15']).toBeDefined()
      expect(result['2026-02-15'].errors.some(e => e.includes('Dana') && e.includes('understudy for multi-vm'))).toBe(true)
    })

    it('allows a trainee once they have completed an earlier understudy session (promoted)', () => {
      const events = [
        {
          date: '2026-02-08',
          day_of_week: 'Sunday',
          roster: [{ role: 'multi-vm-understudy', member_id: 'dana' }]
        },
        {
          date: '2026-02-15',
          day_of_week: 'Sunday',
          roster: [{ role: 'multi-vm', member_id: 'dana' }]
        }
      ]

      const result = validateEventAssignments(events, understudyMembers, [], [], rosterConstraints, {})

      expect(result['2026-02-15']).toBeUndefined()
    })

    it('never flags a full performer of the real role', () => {
      const events = [{
        date: '2026-02-15',
        day_of_week: 'Sunday',
        roster: [{ role: 'multi-vm', member_id: 'fred' }]
      }]

      const result = validateEventAssignments(events, understudyMembers, [], [], rosterConstraints, {})

      expect(result['2026-02-15']).toBeUndefined()
    })

    it('does nothing when the constraint is disabled', () => {
      const events = [{
        date: '2026-02-15',
        day_of_week: 'Sunday',
        roster: [{ role: 'multi-vm', member_id: 'dana' }]
      }]

      const result = validateEventAssignments(events, understudyMembers, [], [], {}, {})

      expect(result['2026-02-15']).toBeUndefined()
    })
  })
})

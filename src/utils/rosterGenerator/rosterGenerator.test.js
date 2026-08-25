import { describe, it, expect } from 'vitest'
import { generateRoster } from './index'
import { CONSTRAINT_KEYS, PREFERENCE_KEYS } from '../../schema/rosterSchema'

describe('Roster Generator', () => {
  const createTestMembers = () => [
    { id: 'alice', name: 'Alice', telegram: '@alice', include: true, roles: ['vm', 'cam-1'] },
    { id: 'bob', name: 'Bob', telegram: '@bob', include: true, roles: ['vm', 'cam-1', 'cam-2'] },
    { id: 'charlie', name: 'Charlie', telegram: '@charlie', include: true, roles: ['cam-1', 'cam-2'] },
  ]

  const createTestEvents = () => [
    {
      name: 'Service 1',
      date: '2026-02-01',
      day_of_week: 'Sunday',
      reporting_time: '09:00',
      roster: [
        { role: 'vm', member_id: null },
        { role: 'cam-1', member_id: null }
      ]
    },
    {
      name: 'Service 2',
      date: '2026-02-08',
      day_of_week: 'Sunday',
      reporting_time: '09:00',
      roster: [
        { role: 'vm', member_id: null },
        { role: 'cam-1', member_id: null }
      ]
    }
  ]

  const rosterConstraints = {
    [CONSTRAINT_KEYS.ENFORCE_MEMBER_ROLES]: true,
    [CONSTRAINT_KEYS.ENFORCE_MEMBER_AVAILABILITY]: true,
    [CONSTRAINT_KEYS.ONLY_ONCE_PER_EVENT]: true,
    [CONSTRAINT_KEYS.ONLY_ONCE_PER_WEEK]: true,
    [CONSTRAINT_KEYS.MAX_ASSIGNMENTS_PER_MONTH]: 2
  }

  const rosterPreferences = {
    [PREFERENCE_KEYS.AVOID_CONSECUTIVE_WEEKS]: true,
    [PREFERENCE_KEYS.BALANCED_DAY_DISTRIBUTION]: true,
    [PREFERENCE_KEYS.SPREAD_ASSIGNMENTS]: true
  }

  const rosterPeriod = {
    start_date: '2026-02-01',
    end_date: '2026-02-28'
  }

  describe('Basic Generation', () => {
    it('should assign members to unassigned roles', () => {
      const members = createTestMembers()
      const events = createTestEvents()
      
      const result = generateRoster(
        events,
        members,
        [],
        [],
        rosterConstraints,
        rosterPreferences,
        rosterPeriod
      )

      expect(result.events[0].roster[0].member_id).toBeTruthy()
      expect(result.events[0].roster[1].member_id).toBeTruthy()
      expect(result.stats.generatedAssignments).toBeGreaterThan(0)
    })

    it('should not overwrite existing assignments', () => {
      const members = createTestMembers()
      const events = createTestEvents()
      events[0].roster[0].member_id = 'alice'
      
      const result = generateRoster(
        events,
        members,
        [],
        [],
        rosterConstraints,
        rosterPreferences,
        rosterPeriod
      )

      expect(result.events[0].roster[0].member_id).toBe('alice')
      expect(result.stats.assignedRoles).toBeGreaterThanOrEqual(1)
    })

    it('should never move a pre-assigned member during local-search swaps', () => {
      // A pre-assigned (manual) slot has no isGenerated flag. Even when a swap
      // would look attractive to the optimizer, the locked member must stay put.
      const members = createTestMembers()
      const events = createTestEvents()
      // Manually place charlie on cam-1 in both events (would violate spread /
      // once-per-week balance the optimizer normally tries to fix by swapping).
      events[0].roster[1].member_id = 'charlie'
      events[1].roster[1].member_id = 'charlie'

      const result = generateRoster(
        events,
        members,
        [],
        [],
        rosterConstraints,
        rosterPreferences,
        rosterPeriod
      )

      // Both manual assignments survive untouched and stay unflagged.
      expect(result.events[0].roster[1].member_id).toBe('charlie')
      expect(result.events[1].roster[1].member_id).toBe('charlie')
      expect(result.events[0].roster[1].isGenerated).toBeFalsy()
      expect(result.events[1].roster[1].isGenerated).toBeFalsy()
    })

    it('by default only fills empty slots and does not reshuffle prior generated assignments', () => {
      // Charlie was placed on cam-1 in BOTH weeks by an earlier run (isGenerated).
      // This is exactly the kind of spread/once-per-week imbalance the optimizer
      // would normally fix by swapping — but the default (optimizeExisting: false)
      // must treat prior assignments as fixed and only fill the still-empty slots.
      const members = createTestMembers()
      const events = createTestEvents()
      events[0].roster[1].member_id = 'charlie'
      events[0].roster[1].isGenerated = true
      events[1].roster[1].member_id = 'charlie'
      events[1].roster[1].isGenerated = true

      const result = generateRoster(
        events,
        members,
        [],
        [],
        rosterConstraints,
        rosterPreferences,
        rosterPeriod
      )

      // Prior generated assignments are untouched; only the empty vm slots got filled.
      expect(result.events[0].roster[1].member_id).toBe('charlie')
      expect(result.events[1].roster[1].member_id).toBe('charlie')
      expect(result.events[0].roster[0].member_id).toBeTruthy()
      expect(result.events[1].roster[0].member_id).toBeTruthy()
      // The transient lock marker never leaks into the returned data.
      expect(result.events[0].roster[1]._preExisting).toBeUndefined()
    })

    it('by default leaves a beneficial swap between prior generated slots untaken', () => {
      // Same day-preference swap the `optimizeExisting:true` test proves IS taken;
      // here (default) both slots were filled by an earlier run (isGenerated) and
      // must stay locked, so the sub-optimal placement is preserved.
      const members = [
        { id: 'alice', name: 'Alice', include: true, roles: ['cam-1'] },
        { id: 'bob', name: 'Bob', include: true, roles: ['cam-1'] },
      ]
      const memberPreferences = [
        { member_id: 'alice', days: ['Saturday'] },
        { member_id: 'bob', days: ['Sunday'] },
      ]
      const events = [
        { name: 'Sat', date: '2026-02-07', day_of_week: 'Saturday', roster: [{ role: 'cam-1', member_id: 'bob', isGenerated: true }] },
        { name: 'Sun', date: '2026-02-15', day_of_week: 'Sunday', roster: [{ role: 'cam-1', member_id: 'alice', isGenerated: true }] },
      ]

      const result = generateRoster(
        events,
        members,
        [],
        memberPreferences,
        { [CONSTRAINT_KEYS.ENFORCE_MEMBER_ROLES]: true },
        {},
        { start_date: '2026-02-01', end_date: '2026-02-28' }
      )

      const byDate = Object.fromEntries(result.events.map(e => [e.date, e.roster[0].member_id]))
      expect(byDate['2026-02-07']).toBe('bob')
      expect(byDate['2026-02-15']).toBe('alice')
    })

    it('optimizeExisting:true re-opens a beneficial swap between prior generated slots', () => {
      // Two members are each rostered on a weekend they do NOT prefer; swapping
      // them fixes both day-preference violations. Both slots were filled by an
      // earlier run (isGenerated), so ONLY re-optimization (optimizeExisting)
      // may touch them — the default would leave the swap on the table.
      const members = [
        { id: 'alice', name: 'Alice', include: true, roles: ['cam-1'] },
        { id: 'bob', name: 'Bob', include: true, roles: ['cam-1'] },
      ]
      const memberPreferences = [
        { member_id: 'alice', days: ['Saturday'] },
        { member_id: 'bob', days: ['Sunday'] },
      ]
      const events = [
        { name: 'Sat', date: '2026-02-07', day_of_week: 'Saturday', roster: [{ role: 'cam-1', member_id: 'bob', isGenerated: true }] },
        { name: 'Sun', date: '2026-02-15', day_of_week: 'Sunday', roster: [{ role: 'cam-1', member_id: 'alice', isGenerated: true }] },
      ]
      const constraints = { [CONSTRAINT_KEYS.ENFORCE_MEMBER_ROLES]: true }

      const result = generateRoster(
        events,
        members,
        [],
        memberPreferences,
        constraints,
        {},
        { start_date: '2026-02-01', end_date: '2026-02-28' },
        { optimizeExisting: true }
      )

      const byDate = Object.fromEntries(result.events.map(e => [e.date, e.roster[0].member_id]))
      // The swap happened: each member now works their preferred day.
      expect(byDate['2026-02-07']).toBe('alice')
      expect(byDate['2026-02-15']).toBe('bob')
    })

    it('should provide generation statistics', () => {
      const members = createTestMembers()
      const events = createTestEvents()

      const result = generateRoster(
        events,
        members,
        [],
        [],
        rosterConstraints,
        rosterPreferences,
        rosterPeriod
      )

      expect(result.stats).toHaveProperty('totalRoles')
      expect(result.stats).toHaveProperty('assignedRoles')
      expect(result.stats).toHaveProperty('generatedAssignments')
      expect(result.stats.totalRoles).toBe(4)
    })
  })

  describe('Hard Constraints', () => {
    it('should respect member role compatibility', () => {
      const members = [
        { id: 'alice', name: 'Alice', include: true, roles: ['cam-1'] } // Cannot do VM
      ]
      const events = [{
        name: 'Service',
        date: '2026-02-01',
        day_of_week: 'Sunday',
        roster: [{ role: 'vm', member_id: null }]
      }]
      
      const result = generateRoster(
        events,
        members,
        [],
        [],
        rosterConstraints,
        rosterPreferences,
        rosterPeriod
      )

      expect(result.events[0].roster[0].member_id).toBeFalsy()
      expect(result.stats.unassignableRoles).toHaveLength(1)
    })

    it('should respect member unavailability', () => {
      const members = [{ id: 'alice', name: 'Alice', include: true, roles: ['vm'] }]
      const events = [{
        name: 'Service',
        date: '2026-02-01',
        day_of_week: 'Sunday',
        roster: [{ role: 'vm', member_id: null }]
      }]
      const constraints = [{
        member_id: 'alice',
        unavailable_dates: ['2026-02-01']
      }]
      
      const result = generateRoster(
        events,
        members,
        constraints,
        [],
        rosterConstraints,
        rosterPreferences,
        rosterPeriod
      )

      expect(result.events[0].roster[0].member_id).toBeFalsy()
    })

    it('should enforce ONLY_ONCE_PER_EVENT', () => {
      const members = [{ id: 'alice', name: 'Alice', include: true, roles: ['vm', 'cam-1'] }]
      const events = [{
        name: 'Service',
        date: '2026-02-01',
        day_of_week: 'Sunday',
        roster: [
          { role: 'vm', member_id: null },
          { role: 'cam-1', member_id: null }
        ]
      }]
      
      const result = generateRoster(
        events,
        members,
        [],
        [],
        rosterConstraints,
        rosterPreferences,
        rosterPeriod
      )

      const assignedMembers = result.events[0].roster
        .filter(r => r.member_id)
        .map(r => r.member_id)
      
      const uniqueMembers = new Set(assignedMembers)
      expect(uniqueMembers.size).toBe(assignedMembers.length)
    })

    it('should enforce ONLY_ONCE_PER_WEEK', () => {
      const members = createTestMembers()
      const events = [
        {
          name: 'Saturday Service',
          date: '2026-02-07',
          day_of_week: 'Saturday',
          roster: [{ role: 'vm', member_id: null }]
        },
        {
          name: 'Sunday Service',
          date: '2026-02-08',
          day_of_week: 'Sunday',
          roster: [{ role: 'vm', member_id: null }]
        }
      ]
      
      const result = generateRoster(
        events,
        members,
        [],
        [],
        rosterConstraints,
        rosterPreferences,
        rosterPeriod
      )

      const saturdayVm = result.events[0].roster[0].member_id
      const sundayVm = result.events[1].roster[0].member_id
      
      if (saturdayVm && sundayVm) {
        expect(saturdayVm).not.toBe(sundayVm)
      }
    })
  })

  describe('Fairness', () => {
    it('should distribute assignments fairly among members', () => {
      const members = createTestMembers()
      const events = Array.from({ length: 4 }, (_, i) => ({
        name: `Service ${i + 1}`,
        date: `2026-02-${String((i + 1) * 7).padStart(2, '0')}`,
        day_of_week: 'Sunday',
        roster: [{ role: 'cam-1', member_id: null }]
      }))
      
      const result = generateRoster(
        events,
        members,
        [],
        [],
        { ...rosterConstraints, ONLY_ONCE_PER_WEEK: false },
        rosterPreferences,
        rosterPeriod
      )

      const assignmentCounts = {}
      result.events.forEach(event => {
        event.roster.forEach(r => {
          if (r.member_id) {
            assignmentCounts[r.member_id] = (assignmentCounts[r.member_id] || 0) + 1
          }
        })
      })

      const counts = Object.values(assignmentCounts)
      const max = Math.max(...counts)
      const min = Math.min(...counts)
      
      // Distribution should be relatively balanced
      expect(max - min).toBeLessThanOrEqual(2)
    })
  })

  describe('Preview Mode', () => {
    it('should not modify the input events', () => {
      const members = createTestMembers()
      const events = createTestEvents()
      const originalEvents = JSON.parse(JSON.stringify(events))
      
      generateRoster(
        events,
        members,
        [],
        [],
        rosterConstraints,
        rosterPreferences,
        rosterPeriod
      )

      expect(events).toEqual(originalEvents)
    })

    it('should indicate when generation is possible', () => {
      const members = createTestMembers()
      const events = createTestEvents()
      
      const result = generateRoster(
        events,
        members,
        [],
        [],
        rosterConstraints,
        rosterPreferences,
        rosterPeriod
      )

      expect(result.stats.unassignableRoles).toHaveLength(0)
    })

    it('should warn about unassignable roles', () => {
      const members = [{ id: 'alice', name: 'Alice', include: true, roles: ['cam-1'] }]
      const events = [{
        name: 'Service',
        date: '2026-02-01',
        day_of_week: 'Sunday',
        roster: [{ role: 'vm', member_id: null }]
      }]
      
      const result = generateRoster(
        events,
        members,
        [],
        [],
        rosterConstraints,
        rosterPreferences,
        rosterPeriod
      )

      expect(result.stats.unassignableRoles.length).toBeGreaterThan(0)
    })
  })

  describe('Member Preferences', () => {
    it('should consider member day preferences in scoring', () => {
      const members = [
        { id: 'alice', name: 'Alice', include: true, roles: ['vm'] },
        { id: 'bob', name: 'Bob', include: true, roles: ['vm'] }
      ]
      const events = [{
        name: 'Sunday Service',
        date: '2026-02-01',
        day_of_week: 'Sunday',
        roster: [{ role: 'vm', member_id: null }]
      }]
      const preferences = [
        { member_id: 'alice', days: ['Sunday'] }
      ]
      
      const result = generateRoster(
        events,
        members,
        [],
        preferences,
        rosterConstraints,
        rosterPreferences,
        rosterPeriod
      )

      // Alice prefers Sunday, should likely be assigned
      expect(result.events[0].roster[0].member_id).toBe('alice')
    })

    it('should consider member role preferences in scoring', () => {
      const members = [
        { id: 'alice', name: 'Alice', include: true, roles: ['vm', 'cam-1'] },
        { id: 'bob', name: 'Bob', include: true, roles: ['vm', 'cam-1'] }
      ]
      const events = [{
        name: 'Sunday Service',
        date: '2026-02-01',
        day_of_week: 'Sunday',
        roster: [
          { role: 'vm', member_id: null },
          { role: 'cam-1', member_id: null }
        ]
      }]
      const preferences = [
        { member_id: 'alice', roles: ['cam-1'] }
      ]
      
      const result = generateRoster(
        events,
        members,
        [],
        preferences,
        rosterConstraints,
        rosterPreferences,
        rosterPeriod
      )

      // Alice prefers cam-1, should be assigned to cam-1 role
      const aliceAssignment = result.events[0].roster.find(r => r.member_id === 'alice')
      expect(aliceAssignment).toBeTruthy()
      expect(aliceAssignment.role).toBe('cam-1')
    })

    it('should prioritize role preferences when multiple members are eligible', () => {
      const members = [
        { id: 'alice', name: 'Alice', include: true, roles: ['support'] },
        { id: 'bob', name: 'Bob', include: true, roles: ['support'] },
        { id: 'charlie', name: 'Charlie', include: true, roles: ['support'] }
      ]
      const events = [{
        name: 'Service',
        date: '2026-02-01',
        day_of_week: 'Sunday',
        roster: [{ role: 'support', member_id: null }]
      }]
      const preferences = [
        { member_id: 'bob', roles: ['support'] }
      ]
      
      const result = generateRoster(
        events,
        members,
        [],
        preferences,
        rosterConstraints,
        rosterPreferences,
        rosterPeriod
      )

      // Bob has role preference for support, should be preferred
      expect(result.events[0].roster[0].member_id).toBe('bob')
    })

    it('should handle combined day and role preferences', () => {
      const members = [
        { id: 'alice', name: 'Alice', include: true, roles: ['lead', 'support'] },
        { id: 'bob', name: 'Bob', include: true, roles: ['lead', 'support'] },
        { id: 'charlie', name: 'Charlie', include: true, roles: ['lead', 'support'] }
      ]
      const events = [
        {
          name: 'Saturday Service',
          date: '2026-02-01',
          day_of_week: 'Saturday',
          roster: [
            { role: 'support', member_id: null }
          ]
        }
      ]
      const preferences = [
        { member_id: 'alice', days: ['Saturday'], roles: ['support'] }
      ]
      
      const result = generateRoster(
        events,
        members,
        [],
        preferences,
        { ...rosterConstraints, MAX_ASSIGNMENTS_PER_MONTH: 5 },
        rosterPreferences,
        rosterPeriod
      )

      // Alice has both day (Saturday) and role (support) preferences
      // She should be strongly preferred with combined preference bonus
      expect(result.events[0].roster[0].member_id).toBe('alice')
    })
  })

  describe('Quality & Determinism', () => {
    it('should assign roles and report a quality score', () => {
      const members = createTestMembers()
      const events = createTestEvents()
      
      const result = generateRoster(
        events,
        members,
        [],
        [],
        rosterConstraints,
        rosterPreferences,
        rosterPeriod
      )

      expect(typeof result.quality).toBe('number')
      expect(result.events[0].roster[0].member_id).toBeTruthy()
    })

    it('should produce deterministic results with same input', () => {
      const members = createTestMembers()
      const events = createTestEvents()
      
      const result1 = generateRoster(
        events,
        members,
        [],
        [],
        rosterConstraints,
        rosterPreferences,
        rosterPeriod
      )

      const result2 = generateRoster(
        events,
        members,
        [],
        [],
        rosterConstraints,
        rosterPreferences,
        rosterPeriod
      )

      // Same input should produce same output
      expect(result1.quality).toBe(result2.quality)
      expect(JSON.stringify(result1.events)).toBe(JSON.stringify(result2.events))
    })

    it('should attach a verbose algorithm log to the result', () => {
      const members = createTestMembers()
      const events = createTestEvents()
      
      const result = generateRoster(
        events,
        members,
        [],
        [],
        rosterConstraints,
        rosterPreferences,
        rosterPeriod
      )

      expect(Array.isArray(result.log)).toBe(true)
      expect(result.log.length).toBeGreaterThan(0)
      expect(Array.isArray(result.logEntries)).toBe(true)
    })

    it('should omit the log when logging is disabled', () => {
      const members = createTestMembers()
      const events = createTestEvents()
      
      const result = generateRoster(
        events,
        members,
        [],
        [],
        rosterConstraints,
        rosterPreferences,
        rosterPeriod,
        { logging: false }
      )

      expect(result.log).toHaveLength(0)
    })

    it('should maintain chronological order in final result', () => {
      const members = createTestMembers()
      const events = [
        { ...createTestEvents()[0], date: '2026-02-15' },
        { ...createTestEvents()[1], date: '2026-02-01' },
        { ...createTestEvents()[0], date: '2026-02-22' }
      ]
      
      const result = generateRoster(
        events,
        members,
        [],
        [],
        rosterConstraints,
        rosterPreferences,
        rosterPeriod
      )

      // Events should be returned in chronological order
      expect(new Date(result.events[0].date) <= new Date(result.events[1].date)).toBe(true)
      expect(new Date(result.events[1].date) <= new Date(result.events[2].date)).toBe(true)
    })
  })

  describe('Local Search', () => {
    it('should never violate ONLY_ONCE_PER_WEEK after optimization', () => {
      const members = createTestMembers()
      const events = createTestEvents()

      const result = generateRoster(
        events, members, [], [],
        rosterConstraints, rosterPreferences, rosterPeriod
      )

      // Group assignments by ISO week; no member should appear twice in a week.
      const perWeek = {}
      result.events.forEach(event => {
        const d = new Date(event.date)
        const weekKey = `${d.getFullYear()}-W${Math.floor(d.getTime() / (7 * 864e5))}`
        perWeek[weekKey] = perWeek[weekKey] || []
        event.roster.forEach(r => { if (r.member_id) perWeek[weekKey].push(r.member_id) })
      })
      Object.values(perWeek).forEach(ids => {
        expect(new Set(ids).size).toBe(ids.length)
      })
    })

    it('should respect member role compatibility after optimization', () => {
      const members = createTestMembers()
      const events = createTestEvents()
      const byId = Object.fromEntries(members.map(m => [m.id, m]))

      const result = generateRoster(
        events, members, [], [],
        rosterConstraints, rosterPreferences, rosterPeriod
      )

      result.events.forEach(event => {
        event.roster.forEach(r => {
          if (r.member_id) {
            expect(byId[r.member_id].roles).toContain(r.role)
          }
        })
      })
    })

    it('should remain deterministic with local search enabled', () => {
      const members = createTestMembers()
      const events = createTestEvents()

      const run = () => generateRoster(
        events, members, [], [],
        rosterConstraints, rosterPreferences, rosterPeriod
      )

      const a = run()
      const b = run()
      expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events))
    })

    it('avoids consecutive-weekend rostering in the whole-roster objective', () => {
      // Two consecutive Sundays, one vm slot each, two interchangeable vm
      // members. ONLY_ONCE_PER_WEEK is off, so a single member COULD legally
      // take both weekends — but AVOID_CONSECUTIVE_WEEKS is a Phase-2 objective
      // term now, so the optimizer must split them across the two members.
      const members = [
        { id: 'ann', name: 'Ann', include: true, roles: ['vm'] },
        { id: 'ben', name: 'Ben', include: true, roles: ['vm'] },
      ]
      const events = [
        { name: 'S1', date: '2026-02-01', day_of_week: 'Sunday', reporting_time: '09:00', roster: [{ role: 'vm', member_id: null }] },
        { name: 'S2', date: '2026-02-08', day_of_week: 'Sunday', reporting_time: '09:00', roster: [{ role: 'vm', member_id: null }] },
      ]
      const constraints = {
        [CONSTRAINT_KEYS.ENFORCE_MEMBER_ROLES]: true,
        [CONSTRAINT_KEYS.ENFORCE_MEMBER_AVAILABILITY]: true,
        [CONSTRAINT_KEYS.ONLY_ONCE_PER_EVENT]: true,
        // ONLY_ONCE_PER_WEEK deliberately OFF so the split must come from the
        // consecutive-weekend objective, not the weekly hard constraint.
        [CONSTRAINT_KEYS.MAX_ASSIGNMENTS_PER_MONTH]: 5,
      }
      const preferences = { [PREFERENCE_KEYS.AVOID_CONSECUTIVE_WEEKS]: true }

      const result = generateRoster(
        events, members, [], [],
        constraints, preferences, rosterPeriod
      )

      const first = result.events[0].roster[0].member_id
      const second = result.events[1].roster[0].member_id
      expect(first).toBeTruthy()
      expect(second).toBeTruthy()
      expect(first).not.toBe(second)
    })
  })

  // Cross-team primitive (multi-tenant): the engine accepts an optional
  // cross-team snapshot (externalAssignments) that defaults to no-op. Passing an
  // empty one must produce byte-for-byte identical output to omitting it
  // entirely, so single-team generation is provably unchanged.
  describe('cross-team seam (empty externalAssignments is a no-op)', () => {
    it('empty externalAssignments matches the default output', () => {
      const baseline = generateRoster(
        createTestEvents(),
        createTestMembers(),
        [],
        [],
        rosterConstraints,
        rosterPreferences,
        rosterPeriod
      )
      const withEmpty = generateRoster(
        createTestEvents(),
        createTestMembers(),
        [],
        [],
        rosterConstraints,
        rosterPreferences,
        rosterPeriod,
        { externalAssignments: {} }
      )
      // The seeded generator is deterministic, so the resolved rosters match.
      expect(withEmpty.events).toEqual(baseline.events)
      expect(withEmpty.quality).toBe(baseline.quality)
    })
  })
})

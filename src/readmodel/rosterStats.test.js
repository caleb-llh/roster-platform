import { describe, it, expect } from 'vitest'
import { calculateRosterStats } from './rosterStats'
import { CONSTRAINT_KEYS } from '../schema/rosterSchema'

describe('rosterStats', () => {
  describe('calculateRosterStats', () => {
    const members = [
      { id: 'john', name: 'John', include: true, roles: ['vm'] },
      { id: 'jane', name: 'Jane', include: true, roles: ['vm'] },
      { id: 'bob', name: 'Bob', include: false, roles: ['vm'] }
    ]

    const events = [
      {
        date: '2026-02-07',
        roster: [
          { role: 'vm', member_id: 'john' },
          { role: 'cam-1', member_id: 'jane' }
        ]
      },
      {
        date: '2026-02-14',
        roster: [
          { role: 'vm', member_id: 'john' },
          { role: 'cam-1', member_id: null }
        ]
      },
      {
        date: '2026-03-07',
        roster: [
          { role: 'vm', member_id: 'jane' }
        ]
      }
    ]

    const rosterPeriod = {
      start_date: '2026-02-01',
      end_date: '2026-04-30'
    }

    it('should calculate total slots correctly', () => {
      const stats = calculateRosterStats(events, members, rosterPeriod)
      
      expect(stats.totalSlots).toBe(5) // 2 + 2 + 1
    })

    it('should count total events', () => {
      const stats = calculateRosterStats(events, members, rosterPeriod)
      
      expect(stats.totalEvents).toBe(3)
    })

    it('should calculate month count correctly', () => {
      const stats = calculateRosterStats(events, members, rosterPeriod)
      
      expect(stats.monthCount).toBe(3) // Feb, Mar, Apr
    })

    it('should calculate average slots per event', () => {
      const stats = calculateRosterStats(events, members, rosterPeriod)
      
      expect(stats.avgSlotsPerEvent).toBe(1.7) // 5/3 rounded to 1 decimal
    })

    it('should calculate average slots per month', () => {
      const stats = calculateRosterStats(events, members, rosterPeriod)
      
      expect(stats.avgSlotsPerMonth).toBe(1.7) // 5/3 rounded to 1 decimal
    })

    it('should calculate average slots per member', () => {
      const stats = calculateRosterStats(events, members, rosterPeriod)
      
      expect(stats.avgSlotsPerMember).toBe(2.5) // 5 slots / 2 active members
    })

    it('should exclude members with include:false from average calculation', () => {
      const stats = calculateRosterStats(events, members, rosterPeriod)
      
      // Should calculate based on 2 active members (John and Jane), not 3
      expect(stats.memberStats).toHaveLength(2)
    })

    it('should calculate per-member statistics', () => {
      const stats = calculateRosterStats(events, members, rosterPeriod)
      
      const johnStats = stats.memberStats.find(m => m.id === 'john')
      expect(johnStats.totalAssignments).toBe(2)
      expect(johnStats.avgPerMonth).toBeCloseTo(0.67, 1) // 2/3 months
      
      const janeStats = stats.memberStats.find(m => m.id === 'jane')
      expect(janeStats.totalAssignments).toBe(2) // 1 cam-1 + 1 vm
      expect(janeStats.avgPerMonth).toBeCloseTo(0.67, 1)
    })

    it('should calculate percentage of total for each member', () => {
      const stats = calculateRosterStats(events, members, rosterPeriod)
      
      const johnStats = stats.memberStats.find(m => m.id === 'john')
      expect(johnStats.percentageOfTotal).toBe(40) // 2/5 = 40%
      
      const janeStats = stats.memberStats.find(m => m.id === 'jane')
      expect(janeStats.percentageOfTotal).toBe(40) // 2/5 = 40%
    })

    it('should sort members by total assignments descending', () => {
      const moreEvents = [
        {
          date: '2026-02-07',
          roster: [
            { role: 'vm', member_id: 'john' },
            { role: 'cam-1', member_id: 'john' },
            { role: 'cam-2', member_id: 'john' }
          ]
        },
        {
          date: '2026-02-14',
          roster: [
            { role: 'vm', member_id: 'jane' }
          ]
        }
      ]
      
      const stats = calculateRosterStats(moreEvents, members, rosterPeriod)
      
      expect(stats.memberStats[0].id).toBe('john') // John has 3
      expect(stats.memberStats[1].id).toBe('jane') // Jane has 1
    })

    it('should handle members with no assignments', () => {
      const stats = calculateRosterStats(events, members, rosterPeriod)
      
      // All active members should appear even with 0 assignments
      expect(stats.memberStats).toHaveLength(2)
      stats.memberStats.forEach(memberStat => {
        expect(memberStat).toHaveProperty('totalAssignments')
        expect(memberStat).toHaveProperty('avgPerMonth')
        expect(memberStat).toHaveProperty('percentageOfTotal')
      })
    })

    it('should handle empty events array', () => {
      const stats = calculateRosterStats([], members, rosterPeriod)
      
      expect(stats.totalSlots).toBe(0)
      expect(stats.totalEvents).toBe(0)
      expect(stats.avgSlotsPerMember).toBe(0)
    })

    it('should handle null/undefined inputs gracefully', () => {
      const stats = calculateRosterStats(null, null, null)
      
      expect(stats.totalSlots).toBe(0)
      expect(stats.totalEvents).toBe(0)
      expect(stats.memberStats).toEqual([])
    })

    it('should handle events without roster field', () => {
      const eventsNoRoster = [
        { date: '2026-02-07' },
        { date: '2026-02-14', roster: null }
      ]
      
      const stats = calculateRosterStats(eventsNoRoster, members, rosterPeriod)
      
      expect(stats.totalSlots).toBe(0)
    })

    it('should handle single month period', () => {
      const singleMonthPeriod = {
        start_date: '2026-02-01',
        end_date: '2026-02-28'
      }
      
      const stats = calculateRosterStats(events, members, singleMonthPeriod)
      
      expect(stats.monthCount).toBe(1)
    })

    it('should handle multi-year period', () => {
      const multiYearPeriod = {
        start_date: '2026-02-01',
        end_date: '2027-04-30'
      }
      
      const stats = calculateRosterStats(events, members, multiYearPeriod)
      
      expect(stats.monthCount).toBe(15) // Feb 2026 to Apr 2027
    })

    it('computes live fairness metrics from the current roster state', () => {
      const stats = calculateRosterStats(events, members, rosterPeriod)

      // john: 2 assignments, jane: 2 assignments, bob excluded (include:false).
      expect(stats.fairnessMetrics).toBeDefined()
      expect(stats.fairnessMetrics.assignmentsByMember.john.total).toBe(2)
      expect(stats.fairnessMetrics.assignmentsByMember.jane.total).toBe(2)
      expect(stats.fairnessMetrics.assignmentsByMember.bob).toBeUndefined()
      // Equal counts => perfectly fair => std dev 0.
      expect(stats.fairnessMetrics.assignmentStdDev).toBe(0)
      // assignedRoles counts only active members' filled slots (4, not the
      // empty cam-1 slot).
      expect(stats.assignedRoles).toBe(4)
    })

    it('fairness metrics update when the roster changes (real-time)', () => {
      const unbalanced = [
        { date: '2026-02-07', roster: [{ role: 'vm', member_id: 'john' }] },
        { date: '2026-02-14', roster: [{ role: 'vm', member_id: 'john' }] },
        { date: '2026-02-21', roster: [{ role: 'vm', member_id: 'john' }] }
      ]
      const stats = calculateRosterStats(unbalanced, members, rosterPeriod)

      // john has 3, jane has 0 => non-zero std dev, reflecting current state.
      expect(stats.fairnessMetrics.assignmentsByMember.john.total).toBe(3)
      expect(stats.fairnessMetrics.assignmentStdDev).toBeGreaterThan(0)
    })

    it('computes per-role rotation ratio (distinct members / assignments)', () => {
      const stats = calculateRosterStats(events, members, rosterPeriod)
      const byRole = Object.fromEntries(
        stats.roleDiversity.roleStats.map(r => [r.role, r])
      )
      // vm: john(x2) + jane(x1) => 2 distinct members over 3 assignments.
      expect(byRole.vm.uniqueMembers).toBe(2)
      expect(byRole.vm.totalAssignments).toBe(3)
      expect(byRole.vm.rotationRatio).toBeCloseTo(2 / 3, 5)
      // cam-1: only jane is assigned (the null slot is not counted) => ratio 1.
      expect(byRole['cam-1'].uniqueMembers).toBe(1)
      expect(byRole['cam-1'].totalAssignments).toBe(1)
      expect(byRole['cam-1'].rotationRatio).toBe(1)
    })

    it('computes per-member average gap in days between consecutive shifts', () => {
      const stats = calculateRosterStats(events, members, rosterPeriod)
      const john = stats.memberStats.find(m => m.id === 'john')
      // john: 2026-02-07 and 2026-02-14 => single 7-day gap.
      expect(john.avgGapDays).toBe(7)
      const jane = stats.memberStats.find(m => m.id === 'jane')
      // jane: 2026-02-07 and 2026-03-07 => single 28-day gap.
      expect(jane.avgGapDays).toBe(28)
    })

    it('reports null avgGapDays for members with fewer than two shifts', () => {
      const single = [
        { date: '2026-02-07', roster: [{ role: 'vm', member_id: 'john' }] }
      ]
      const stats = calculateRosterStats(single, members, rosterPeriod)
      const john = stats.memberStats.find(m => m.id === 'john')
      expect(john.avgGapDays).toBeNull()
    })

    it('exposes sorted assignment dates and roster period bounds for the timeline', () => {
      const stats = calculateRosterStats(events, members, rosterPeriod)
      const john = stats.memberStats.find(m => m.id === 'john')
      expect(john.assignmentDates).toEqual([
        { date: '2026-02-07', role: 'vm' },
        { date: '2026-02-14', role: 'vm' }
      ])
      expect(stats.periodStart).toBe(rosterPeriod.start_date)
      expect(stats.periodEnd).toBe(rosterPeriod.end_date)
    })
  })

  describe('live unassignableRoles', () => {
    const rosterPeriod = { start_date: '2026-08-01', end_date: '2026-08-31' }
    // Only Charlie can do main-cam; everyone else is vm-only. With member-role
    // enforcement on, an empty main-cam slot is unassignable unless Charlie is
    // available and not already taken by the once-per-event rule.
    const members = [
      { id: 'alice', name: 'Alice', include: true, roles: ['vm'] },
      { id: 'charlie', name: 'Charlie', include: true, roles: ['main-cam'] },
    ]
    const enforceRoles = { [CONSTRAINT_KEYS.ENFORCE_MEMBER_ROLES]: true }

    it('flags a currently-empty slot that has no eligible member', () => {
      const events = [{
        name: 'Sunday Service', date: '2026-08-16',
        roster: [
          { role: 'vm', member_id: 'alice' },
          { role: 'main-cam', member_id: null },
        ],
      }]
      // Charlie is unavailable on that date → main-cam has no eligible member.
      const memberConstraints = [{ member_id: 'charlie', unavailable_dates: ['2026-08-16'] }]
      const stats = calculateRosterStats(events, members, rosterPeriod, memberConstraints, {
        ...enforceRoles,
        [CONSTRAINT_KEYS.ENFORCE_MEMBER_AVAILABILITY]: true,
      })
      expect(stats.unassignableRoles).toHaveLength(1)
      expect(stats.unassignableRoles[0]).toMatchObject({
        event: 'Sunday Service', date: '2026-08-16', role: 'main-cam',
      })
    })

    it('drops the slot from the list once it is filled (real-time)', () => {
      const events = [{
        name: 'Sunday Service', date: '2026-08-16',
        roster: [
          { role: 'vm', member_id: 'alice' },
          { role: 'main-cam', member_id: 'charlie' }, // now filled
        ],
      }]
      const stats = calculateRosterStats(events, members, rosterPeriod, {}, enforceRoles)
      expect(stats.unassignableRoles).toHaveLength(0)
    })

    it('does not flag an empty slot that still has an eligible member', () => {
      const events = [{
        name: 'Sunday Service', date: '2026-08-16',
        roster: [{ role: 'main-cam', member_id: null }],
      }]
      const stats = calculateRosterStats(events, members, rosterPeriod, {}, enforceRoles)
      expect(stats.unassignableRoles).toHaveLength(0)
    })
  })
})

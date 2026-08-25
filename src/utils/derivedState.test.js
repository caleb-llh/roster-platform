import { describe, it, expect } from 'vitest'
import { getDerivedState, resolveDerivedState, isTenantShape, tenantSelection, resolveTenant, memberTeams, writeBackEvents } from './derivedState'
import { CONSTRAINT_KEYS, PREFERENCE_KEYS } from '../schema/rosterSchema'
import { DEFAULT_ROSTER_CONSTRAINTS, DEFAULT_ROSTER_PREFERENCES } from '../config/rosterDefaults'

describe('derivedState', () => {
  describe('getDerivedState', () => {
    it('should return default state for null data', () => {
      const state = getDerivedState(null)
      
      expect(state.members).toEqual([])
      expect(state.events).toEqual([])
      expect(state.roles).toEqual([])
      expect(state.roleColorMap).toEqual({})
      expect(state.activeMembers).toEqual([])
      expect(state.memberConstraints).toEqual([])
      expect(state.memberPreferences).toEqual([])
      expect(state.rosterConstraints).toEqual(DEFAULT_ROSTER_CONSTRAINTS)
      expect(state.rosterPreferences).toEqual(DEFAULT_ROSTER_PREFERENCES)
      expect(state.rosterPeriod).toBeNull()
    })

    it('should return default state for undefined data', () => {
      const state = getDerivedState(undefined)
      
      expect(state.members).toEqual([])
      expect(state.events).toEqual([])
    })

    it('should extract members from data', () => {
      const data = {
        members: [
          { id: 'alice', name: 'Alice' },
          { id: 'bob', name: 'Bob' }
        ]
      }
      
      const state = getDerivedState(data)
      expect(state.members).toHaveLength(2)
      expect(state.members[0].id).toBe('alice')
    })

    it('should extract events from data', () => {
      const data = {
        events: [
          { date: '2026-02-01', name: 'Event 1' },
          { date: '2026-02-08', name: 'Event 2' }
        ]
      }
      
      const state = getDerivedState(data)
      expect(state.events).toHaveLength(2)
      expect(state.events[0].date).toBe('2026-02-01')
    })

    it('should extract roles from object format', () => {
      const data = {
        roles: [
          { name: 'vm' },
          { name: 'cam-1' },
          { name: 'cam-2' }
        ]
      }
      
      const state = getDerivedState(data)
      expect(state.roles).toEqual(['vm', 'cam-1', 'cam-2'])
    })

    it('should extract roles from declared_roles array', () => {
      const data = {
        declared_roles: ['vm', 'cam-1', 'cam-2']
      }
      
      const state = getDerivedState(data)
      expect(state.roles).toEqual(['vm', 'cam-1', 'cam-2'])
    })

    it('should handle string roles in roles array', () => {
      const data = {
        roles: ['vm', 'cam-1', 'cam-2']
      }
      
      const state = getDerivedState(data)
      expect(state.roles).toEqual(['vm', 'cam-1', 'cam-2'])
    })

    it('should filter out falsy role values', () => {
      const data = {
        roles: ['vm', null, 'cam-1', undefined, '', 'cam-2']
      }
      
      const state = getDerivedState(data)
      expect(state.roles).toEqual(['vm', 'cam-1', 'cam-2'])
    })

    it('should generate role color map for all roles', () => {
      const data = {
        roles: ['vm', 'cam-1', 'cam-2']
      }
      
      const state = getDerivedState(data)
      expect(state.roleColorMap).toHaveProperty('vm')
      expect(state.roleColorMap).toHaveProperty('cam-1')
      expect(state.roleColorMap).toHaveProperty('cam-2')
    })

    it('should assign different colors to different roles', () => {
      const data = {
        roles: ['vm', 'cam-1', 'cam-2']
      }
      
      const state = getDerivedState(data)
      expect(state.roleColorMap.vm).not.toBe(state.roleColorMap['cam-1'])
      expect(state.roleColorMap['cam-1']).not.toBe(state.roleColorMap['cam-2'])
    })

    it('should cycle through colors for many roles', () => {
      const data = {
        roles: Array.from({ length: 20 }, (_, i) => `role-${i}`)
      }
      
      const state = getDerivedState(data)
      expect(Object.keys(state.roleColorMap)).toHaveLength(20)
      
      // All roles should have color assigned (text-colour only — role tags
      // render as coloured font, not a coloured pill; see colorUtils).
      state.roles.forEach(role => {
        expect(state.roleColorMap[role]).toBeTruthy()
        expect(state.roleColorMap[role]).toContain('text-')
      })
    })

    it('should filter active members correctly', () => {
      const data = {
        members: [
          { id: 'alice', name: 'Alice', active: true },
          { id: 'bob', name: 'Bob', active: false },
          { id: 'charlie', name: 'Charlie' } // No active field = default true
        ]
      }
      
      const state = getDerivedState(data)
      expect(state.activeMembers).toHaveLength(2)
      expect(state.activeMembers.map(m => m.id)).toEqual(['alice', 'charlie'])
    })

    it('should treat members without active field as active', () => {
      const data = {
        members: [
          { id: 'alice', name: 'Alice' },
          { id: 'bob', name: 'Bob' }
        ]
      }
      
      const state = getDerivedState(data)
      expect(state.activeMembers).toHaveLength(2)
    })

    it('should extract constraints from data', () => {
      const data = {
        member_constraints: [
          { member_id: 'alice', unavailable_dates: ['2026-02-15'] }
        ]
      }
      
      const state = getDerivedState(data)
      expect(state.memberConstraints).toHaveLength(1)
      expect(state.memberConstraints[0].member_id).toBe('alice')
    })

    it('should extract member preferences from data', () => {
      const data = {
        member_preferences: [
          { member_id: 'alice', days: ['Sunday'] }
        ]
      }
      
      const state = getDerivedState(data)
      expect(state.memberPreferences).toHaveLength(1)
      expect(state.memberPreferences[0].days).toEqual(['Sunday'])
    })

    it('should extract roster constraints from data', () => {
      const data = {
        roster_constraints: {
          [CONSTRAINT_KEYS.ONLY_ONCE_PER_EVENT]: true,
          ONLY_ONCE_PER_WEEK: true
        }
      }
      
      const state = getDerivedState(data)
      expect(state.rosterConstraints.ONLY_ONCE_PER_EVENT).toBe(true)
      expect(state.rosterConstraints.ONLY_ONCE_PER_WEEK).toBe(true)
    })

    it('should extract roster preferences from data', () => {
      const data = {
        roster_preferences: {
          [PREFERENCE_KEYS.AVOID_CONSECUTIVE_WEEKS]: true,
          [PREFERENCE_KEYS.SPREAD_ASSIGNMENTS]: true,
          [PREFERENCE_KEYS.DIVERSIFY_ROLE_ASSIGNMENTS]: true
        }
      }
      
      const state = getDerivedState(data)
      expect(state.rosterPreferences[PREFERENCE_KEYS.AVOID_CONSECUTIVE_WEEKS]).toBe(true)
      expect(state.rosterPreferences[PREFERENCE_KEYS.SPREAD_ASSIGNMENTS]).toBe(true)
      expect(state.rosterPreferences[PREFERENCE_KEYS.DIVERSIFY_ROLE_ASSIGNMENTS]).toBe(true)
    })

    it('should extract roster period from data', () => {
      const data = {
        roster: {
          start_date: '2026-02-01',
          end_date: '2026-04-30'
        }
      }
      
      const state = getDerivedState(data)
      expect(state.rosterPeriod.start_date).toBe('2026-02-01')
      expect(state.rosterPeriod.end_date).toBe('2026-04-30')
    })

    it('should handle complete roster data structure', () => {
      const data = {
        roster: {
          start_date: '2026-02-01',
          end_date: '2026-04-30'
        },
        members: [
          { id: 'alice', name: 'Alice', active: true },
          { id: 'bob', name: 'Bob', active: false }
        ],
        declared_roles: ['vm', 'cam-1', 'cam-2'],
        events: [
          { date: '2026-02-07', name: 'Service 1' }
        ],
        member_constraints: [
          { member_id: 'alice', unavailable_dates: ['2026-02-15'] }
        ],
        member_preferences: [
          { member_id: 'alice', days: ['Sunday'] }
        ],
        roster_constraints: {
          [CONSTRAINT_KEYS.ONLY_ONCE_PER_EVENT]: true
        },
        roster_preferences: {
          [PREFERENCE_KEYS.AVOID_CONSECUTIVE_WEEKS]: true
        }
      }
      
      const state = getDerivedState(data)
      
      expect(state.members).toHaveLength(2)
      expect(state.activeMembers).toHaveLength(1)
      expect(state.roles).toHaveLength(3)
      expect(state.events).toHaveLength(1)
      expect(state.memberConstraints).toHaveLength(1)
      expect(state.memberPreferences).toHaveLength(1)
      expect(state.rosterConstraints[CONSTRAINT_KEYS.ONLY_ONCE_PER_EVENT]).toBe(true)
      expect(state.rosterPreferences[PREFERENCE_KEYS.AVOID_CONSECUTIVE_WEEKS]).toBe(true)
      expect(state.rosterPeriod).toBeTruthy()
    })

    it('should handle empty data object', () => {
      const state = getDerivedState({})
      
      expect(state.members).toEqual([])
      expect(state.events).toEqual([])
      expect(state.roles).toEqual([])
      expect(state.memberConstraints).toEqual([])
    })

    it('should handle missing optional fields gracefully', () => {
      const data = {
        members: [{ id: 'alice', name: 'Alice' }]
      }
      
      const state = getDerivedState(data)
      
      expect(state.members).toHaveLength(1)
      expect(state.events).toEqual([])
      expect(state.roles).toEqual([])
      expect(state.memberConstraints).toEqual([])
      expect(state.memberPreferences).toEqual([])
      expect(state.rosterConstraints).toEqual(DEFAULT_ROSTER_CONSTRAINTS)
      expect(state.rosterPreferences).toEqual(DEFAULT_ROSTER_PREFERENCES)
      expect(state.rosterPeriod).toBeNull()
    })

    it('should preserve original data structure', () => {
      const originalData = {
        members: [{ id: 'alice', name: 'Alice' }],
        events: [{ date: '2026-02-01' }]
      }
      
      const state = getDerivedState(originalData)
      
      // Should not mutate original
      expect(originalData.members).toHaveLength(1)
      expect(originalData.members[0]).toEqual({ id: 'alice', name: 'Alice' })
      // Members are normalized (roles/understudyFor derived) into a new array
      expect(state.members[0]).toMatchObject({ id: 'alice', name: 'Alice' })
    })

    it('should handle legacy include field vs active field', () => {
      const data = {
        members: [
          { id: 'alice', name: 'Alice', include: true, active: false },
          { id: 'bob', name: 'Bob', include: false, active: true },
          { id: 'charlie', name: 'Charlie', include: true },
          { id: 'dave', name: 'Dave', active: true }
        ]
      }
      
      const state = getDerivedState(data)
      
      // Should respect active field when present
      const activeIds = state.activeMembers.map(m => m.id)
      expect(activeIds).toContain('bob')
      expect(activeIds).toContain('charlie')
      expect(activeIds).toContain('dave')
      expect(activeIds).not.toContain('alice') // active: false
    })

    it('should handle Tailwind color classes correctly', () => {
      const data = {
        roles: ['vm', 'cam-1']
      }
      
      const state = getDerivedState(data)
      
      // Color classes should be a valid Tailwind text-colour (role tags are
      // coloured font on a neutral surface, not a coloured pill).
      expect(state.roleColorMap.vm).toMatch(/^text-\w+-\d+$/)
      expect(state.roleColorMap['cam-1']).toMatch(/^text-\w+-\d+$/)
    })
  })

  describe('Edge Cases', () => {
    it('should handle roles with special characters', () => {
      const data = {
        roles: ['multi-vm', 'cam-1', 'backup/alternate']
      }
      
      const state = getDerivedState(data)
      expect(state.roles).toEqual(['multi-vm', 'cam-1', 'backup/alternate'])
      expect(state.roleColorMap['multi-vm']).toBeTruthy()
      expect(state.roleColorMap['backup/alternate']).toBeTruthy()
    })

    it('should handle mixed role format (objects and strings)', () => {
      const data = {
        roles: [
          'vm',
          { name: 'cam-1' },
          'cam-2',
          { name: 'cam-3' }
        ]
      }
      
      const state = getDerivedState(data)
      expect(state.roles).toEqual(['vm', 'cam-1', 'cam-2', 'cam-3'])
    })

    it('should handle members with complex structures', () => {
      const data = {
        members: [
          {
            id: 'alice',
            name: 'Alice O\'Brien',
            telegram: '@alice123',
            roles: ['vm', 'cam-1'],
            active: true
          }
        ]
      }
      
      const state = getDerivedState(data)
      expect(state.members[0].name).toBe('Alice O\'Brien')
      expect(state.activeMembers).toHaveLength(1)
    })

    it('should handle very large datasets', () => {
      const data = {
        members: Array.from({ length: 1000 }, (_, i) => ({
          id: `member-${i}`,
          name: `Member ${i}`,
          active: i % 2 === 0
        })),
        roles: Array.from({ length: 50 }, (_, i) => `role-${i}`),
        events: Array.from({ length: 500 }, (_, i) => ({
          date: `2026-${String(Math.floor(i/30) + 1).padStart(2, '0')}-${String((i % 30) + 1).padStart(2, '0')}`
        }))
      }
      
      const state = getDerivedState(data)
      expect(state.members).toHaveLength(1000)
      expect(state.activeMembers).toHaveLength(500) // Half are active
      expect(state.roles).toHaveLength(50)
      expect(state.events).toHaveLength(500)
    })

    it('should handle null values in arrays', () => {
      const data = {
        members: [null, { id: 'alice', name: 'Alice' }, undefined],
        events: [{ date: '2026-02-01' }, null],
        roles: [null, 'vm', undefined, 'cam-1', '']
      }
      
      const state = getDerivedState(data)
      
      // Should filter out nulls and handle gracefully
      expect(state.roles).toEqual(['vm', 'cam-1'])
      // members and events arrays are passed through but activeMembers filters nulls
      expect(state.members).toBeTruthy()
      expect(state.events).toBeTruthy()
      expect(state.activeMembers).toHaveLength(1) // Only alice
    })
  })

  // Multi-tenant Phase 0 compatibility seam. resolveDerivedState is the single
  // contract the engine consumes; for a single team it must be identical to
  // getDerivedState plus empty/no-op cross-team inputs.
  describe('resolveDerivedState (seam)', () => {
    const data = {
      roster: { start_date: '2026-02-01', end_date: '2026-04-30' },
      members: [
        { id: 'alice', name: 'Alice', roles: ['vm', 'cam-1'] },
        { id: 'bob', name: 'Bob', roles: ['vm', { name: 'cam-1', understudy: true }], active: false },
      ],
      declared_roles: ['vm', 'cam-1'],
      events: [{ date: '2026-02-07', roster: [{ role: 'vm', member_id: 'alice' }] }],
      member_constraints: [{ member_id: 'alice', unavailable_dates: ['2026-02-15'] }],
      member_preferences: [{ member_id: 'alice', days: ['Sunday'] }],
      roster_constraints: { [CONSTRAINT_KEYS.ONLY_ONCE_PER_EVENT]: true },
      roster_preferences: { [PREFERENCE_KEYS.AVOID_CONSECUTIVE_WEEKS]: true },
    }

    it('is identity over getDerivedState for the shared keys (single team)', () => {
      const base = getDerivedState(data)
      const resolved = resolveDerivedState(data)
      // Every key getDerivedState produces is byte-for-byte identical.
      for (const key of Object.keys(base)) {
        expect(resolved[key]).toEqual(base[key])
      }
      // Understudy normalization survives the seam unchanged.
      expect(resolved.members[1].roles).toEqual(['vm'])
      expect(resolved.members[1].understudyFor).toEqual(['cam-1'])
    })

    it('adds an empty no-op externalAssignments by default', () => {
      const resolved = resolveDerivedState(data)
      expect(resolved.externalAssignments).toEqual({})
      // Load is derived, never a separate stored input.
      expect(resolved.externalLoad).toBeUndefined()
    })

    it('passes through the provided externalAssignments verbatim', () => {
      const externalAssignments = { alice: ['2026-02-07', '2026-02-14'] }
      const resolved = resolveDerivedState(data, { externalAssignments })
      expect(resolved.externalAssignments).toBe(externalAssignments)
    })

    it('handles null data like getDerivedState + empty inputs', () => {
      const resolved = resolveDerivedState(null)
      expect(resolved.members).toEqual([])
      expect(resolved.events).toEqual([])
      expect(resolved.externalAssignments).toEqual({})
    })
  })

  // Multi-tenant Phase 1: nested tenant shape resolves to today's FLAT document
  // (see specs/multi-tenant.md "Phase 1 contract"). The acceptance test is that
  // flat input is untouched and the resolved flat doc feeds getDerivedState to
  // the SAME normalized shape.
  describe('nested tenant resolver (Phase 1)', () => {
    const tenant = {
      tenant: { name: 'Grace' },
      members: [
        {
          id: 'm-alice', name: 'Alice', telegram: '@alice',
          unavailable_dates: ['2026-02-14', { start: '2026-03-05', end: '2026-03-10' }],
          note: 'No Sundays',
        },
        { id: 'm-bob', name: 'Bob', telegram: '@bob' },
      ],
      teams: [
        {
          name: 'Worship',
          roles: [{ name: 'lead' }, { name: 'support' }],
          team_members: [
            { member_id: 'm-alice', include: true, roles: [{ name: 'lead' }, { name: 'support' }] },
            { member_id: 'm-bob', include: true, roles: [{ name: 'support' }, { name: 'lead', understudy: true }] },
          ],
          rosters: [
            {
              roster: { start_date: '2026-02-01', end_date: '2026-03-31' },
              events: [{ date: '2026-02-07', roster: [{ role: 'lead', member_id: '' }] }],
              roster_constraints: { MAX_ASSIGNMENTS_PER_MONTH: 3 },
            },
            {
              roster: { start_date: '2026-04-01', end_date: '2026-05-31' },
              events: [{ date: '2026-04-04', roster: [{ role: 'lead', member_id: '' }] }],
              // This period, Bob is not active (e.g. on sabbatical).
              member_overrides: [{ member_id: 'm-bob', include: false }],
            },
          ],
        },
        {
          name: 'Hospitality',
          roles: [{ name: 'host' }],
          team_members: [
            { member_id: 'm-alice', include: true, roles: [{ name: 'host' }] },
          ],
          rosters: [{ roster: { start_date: '2026-02-01', end_date: '2026-03-31' }, events: [] }],
        },
      ],
    }

    it('detects nested vs. flat shape', () => {
      expect(isTenantShape(tenant)).toBe(true)
      expect(isTenantShape({ members: [], events: [] })).toBe(false)
      expect(isTenantShape(null)).toBe(false)
    })

    it('enumerates teams and their rosters with stable ids', () => {
      const sel = tenantSelection(tenant)
      expect(sel.teams.map(t => t.name)).toEqual(['Worship', 'Hospitality'])
      expect(sel.teams[0].id).toBe('team-0')
      expect(sel.teams[0].rosters.map(r => r.id)).toEqual(['roster-0', 'roster-1'])
      expect(sel.teams[1].id).toBe('team-1')
    })

    it('flat documents resolve to one default team + roster', () => {
      const flat = { members: [{ id: 'a', name: 'A' }], events: [] }
      // isTenantShape false → resolveTenant returns input untouched.
      expect(resolveTenant(flat, {})).toBe(flat)
      const sel = tenantSelection(flat)
      expect(sel.teams).toHaveLength(1)
      expect(sel.teams[0].rosters).toHaveLength(1)
    })

    it('joins registry + team_members into the flat member shape', () => {
      const flat = resolveTenant(tenant, { teamId: 'team-0', rosterId: 'roster-0' })
      const state = getDerivedState(flat)
      expect(state.members.map(m => m.id)).toEqual(['m-alice', 'm-bob'])
      // Per-team roles; understudy normalization applies downstream.
      expect(state.members.find(m => m.id === 'm-alice').roles).toEqual(['lead', 'support'])
      const bob = state.members.find(m => m.id === 'm-bob')
      expect(bob.roles).toEqual(['support'])
      expect(bob.understudyFor).toEqual(['lead'])
      expect(state.roles).toEqual(['lead', 'support'])
      expect(state.events).toHaveLength(1)
      expect(state.rosterConstraints.MAX_ASSIGNMENTS_PER_MONTH).toBe(3)
    })

    it('resolves the SAME member to different per-team roles', () => {
      const worship = getDerivedState(resolveTenant(tenant, { teamId: 'team-0', rosterId: 'roster-0' }))
      const hospitality = getDerivedState(resolveTenant(tenant, { teamId: 'team-1', rosterId: 'roster-0' }))
      expect(worship.members.find(m => m.id === 'm-alice').roles).toEqual(['lead', 'support'])
      expect(hospitality.members.find(m => m.id === 'm-alice').roles).toEqual(['host'])
      // Bob is not on Hospitality.
      expect(hospitality.members.map(m => m.id)).toEqual(['m-alice'])
    })

    it('surfaces global unavailability as member_constraints for the team', () => {
      const state = getDerivedState(resolveTenant(tenant, { teamId: 'team-0', rosterId: 'roster-0' }))
      const alice = state.memberConstraints.find(c => c.member_id === 'm-alice')
      expect(alice.unavailable_dates).toEqual(['2026-02-14', { start: '2026-03-05', end: '2026-03-10' }])
      // The registry member's free-text note travels with the constraint.
      expect(alice.note).toBe('No Sundays')
      // Bob has none → no constraint row.
      expect(state.memberConstraints.find(c => c.member_id === 'm-bob')).toBeUndefined()
      // Global unavailability follows the member across teams.
      const hosp = getDerivedState(resolveTenant(tenant, { teamId: 'team-1', rosterId: 'roster-0' }))
      expect(hosp.memberConstraints.find(c => c.member_id === 'm-alice').unavailable_dates).toHaveLength(2)
    })

    it('selects a specific roster within a team', () => {
      const r1 = getDerivedState(resolveTenant(tenant, { teamId: 'team-0', rosterId: 'roster-1' }))
      expect(r1.rosterPeriod.start_date).toBe('2026-04-01')
      expect(r1.events[0].date).toBe('2026-04-04')
    })

    it('applies a roster member_override for include over the team default', () => {
      // Team default: Bob is include:true. roster-0 has no override → active.
      const r0 = getDerivedState(resolveTenant(tenant, { teamId: 'team-0', rosterId: 'roster-0' }))
      expect(r0.members.find(m => m.id === 'm-bob').include).toBe(true)
      // roster-1 overrides Bob to include:false → still on the team, but inactive
      // (eligibility/generator treat include:false as opted out).
      const r1 = getDerivedState(resolveTenant(tenant, { teamId: 'team-0', rosterId: 'roster-1' }))
      expect(r1.members.find(m => m.id === 'm-bob').include).toBe(false)
      // Alice has no override → unaffected in both rosters.
      expect(r0.members.find(m => m.id === 'm-alice').include).toBe(true)
      expect(r1.members.find(m => m.id === 'm-alice').include).toBe(true)
    })

    it('defaults to the first team + roster when selection omitted', () => {
      const state = getDerivedState(resolveTenant(tenant, {}))
      expect(state.rosterPeriod.start_date).toBe('2026-02-01')
      expect(state.members.map(m => m.id)).toEqual(['m-alice', 'm-bob'])
    })

    it('memberTeams maps each member to every team they are on', () => {
      const map = memberTeams(tenant)
      expect(map['m-alice']).toEqual(['Worship', 'Hospitality'])
      expect(map['m-bob']).toEqual(['Worship'])
      // Flat documents have no teams → empty map (no "Also on" line).
      expect(memberTeams({ members: [{ id: 'a' }], events: [] })).toEqual({})
      expect(memberTeams(null)).toEqual({})
    })

    describe('writeBackEvents (Phase 1 write-back)', () => {
      const edited = [{ date: '2026-02-07', roster: [{ role: 'lead', member_id: 'm-alice' }] }]

      it('writes events back into the addressed roster without mutating the input', () => {
        const next = writeBackEvents(tenant, { teamId: 'team-0', rosterId: 'roster-0' }, edited)
        // Input untouched (still an empty member_id).
        expect(tenant.teams[0].rosters[0].events[0].roster[0].member_id).toBe('')
        // New doc has the edit.
        expect(next.teams[0].rosters[0].events).toEqual(edited)
        // Resolving the new doc surfaces the edited events.
        expect(getDerivedState(resolveTenant(next, { teamId: 'team-0', rosterId: 'roster-0' })).events)
          .toEqual(edited)
      })

      it('only touches the addressed roster; siblings + other teams are intact', () => {
        const next = writeBackEvents(tenant, { teamId: 'team-0', rosterId: 'roster-0' }, edited)
        // Sibling roster within the same team is unchanged.
        expect(next.teams[0].rosters[1].events).toEqual(tenant.teams[0].rosters[1].events)
        // Other team is unchanged.
        expect(next.teams[1]).toEqual(tenant.teams[1])
        // Registry + team_members untouched.
        expect(next.members).toEqual(tenant.members)
        expect(next.teams[0].team_members).toEqual(tenant.teams[0].team_members)
      })

      it('round-trips: edit team-0/roster-0, switch away, come back preserves it', () => {
        const next = writeBackEvents(tenant, { teamId: 'team-0', rosterId: 'roster-1' }, edited)
        // roster-1 now has the edit; roster-0 still original.
        const r1 = getDerivedState(resolveTenant(next, { teamId: 'team-0', rosterId: 'roster-1' }))
        expect(r1.events).toEqual(edited)
        const r0 = getDerivedState(resolveTenant(next, { teamId: 'team-0', rosterId: 'roster-0' }))
        expect(r0.events).toEqual(tenant.teams[0].rosters[0].events)
      })

      it('is identity for flat documents', () => {
        const flat = { members: [{ id: 'a', name: 'A' }], events: [{ date: '2026-01-01' }] }
        expect(writeBackEvents(flat, { teamId: 'team-0', rosterId: 'roster-0' }, edited)).toBe(flat)
      })
    })
  })
})

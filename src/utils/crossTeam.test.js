import { describe, it, expect } from 'vitest'
import { EligibilityChecker } from './rosterGenerator/eligibilityChecker'
import { AssignmentTracker } from '../state/assignmentTracker'
import { validateEventAssignments } from './assignmentValidator'
import { explainSwap } from './swapPolicy'
import { CONSTRAINT_KEYS } from '../schema/rosterSchema'

/**
 * Multi-tenant Phase 2 — cross-team enforcement core.
 *
 * `externalAssignments` (`{ memberId: [entry, ...] }`) is a read-only snapshot
 * of a member's assignments in OTHER teams. Two new constraint keys fold it into
 * the SHARED counting/clash seam every consumer already uses:
 *   - ENFORCE_CROSS_TEAM_CAPS  → external week/month load counts toward the
 *     LOCAL once-per-week / max-per-month caps (only when those local caps are
 *     themselves on — the fold adds to the count, it does not force the rule).
 *   - ENFORCE_CROSS_TEAM_CLASH → external overlapping events count as clashes.
 * Both default OFF, and the snapshot is empty in single-team mode, so single
 * team behaviour is byte-for-byte unchanged (asserted below).
 */
describe('Cross-team enforcement (Phase 2)', () => {
  const rosterPeriod = { start_date: '2026-02-01', end_date: '2026-02-28' }
  const members = [{ id: 'ann', name: 'Ann', include: true, roles: ['cam'], understudyFor: [] }]

  const constraints = (overrides = {}) => ({
    [CONSTRAINT_KEYS.ENFORCE_MEMBER_ROLES]: true,
    [CONSTRAINT_KEYS.ENFORCE_MEMBER_AVAILABILITY]: true,
    [CONSTRAINT_KEYS.ONLY_ONCE_PER_EVENT]: true,
    [CONSTRAINT_KEYS.ENFORCE_NO_CLASH]: false,
    [CONSTRAINT_KEYS.ONLY_ONCE_PER_WEEK]: false,
    // Integer cap: a high value is effectively "off" (0/false would enable a
    // cap-of-zero, since any non-null integer counts as enabled).
    [CONSTRAINT_KEYS.MAX_ASSIGNMENTS_PER_MONTH]: 99,
    [CONSTRAINT_KEYS.ENFORCE_CROSS_TEAM_CAPS]: false,
    [CONSTRAINT_KEYS.ENFORCE_CROSS_TEAM_CLASH]: false,
    ...overrides,
  })

  const evt = (date, roles = ['cam']) => ({
    name: `Service ${date}`, date, day_of_week: 'Sunday', reporting_time: '09:00',
    roster: roles.map(role => ({ role, member_id: null })),
  })

  const checkerFor = (rosterConstraints, events, externalAssignments) => {
    const tracker = new AssignmentTracker(members, events, rosterPeriod)
    return new EligibilityChecker(members, [], rosterConstraints, tracker, { events, externalAssignments })
  }

  // --- Generator (EligibilityChecker) ---
  describe('generator eligibility', () => {
    it('is byte-for-byte unaffected by externalAssignments when the flags are OFF', () => {
      const events = [evt('2026-02-08')]
      const withExternal = checkerFor(constraints(), events, { ann: ['2026-02-08', '2026-02-09'] })
      const withoutExternal = checkerFor(constraints(), events, {})
      const target = events[0]
      expect(withExternal.isEligible('ann', 'cam', target).eligible).toBe(true)
      expect(withoutExternal.isEligible('ann', 'cam', target).eligible).toBe(true)
    })

    it('cross-team clash BLOCKS placement onto an overlapping other-team event', () => {
      const events = [evt('2026-02-08')]
      const checker = checkerFor(
        constraints({ [CONSTRAINT_KEYS.ENFORCE_CROSS_TEAM_CLASH]: true }),
        events,
        { ann: ['2026-02-08'] } // same day on another team → overlap
      )
      const result = checker.isEligible('ann', 'cam', events[0])
      expect(result.eligible).toBe(false)
      expect(result.reason).toMatch(/another team/i)
    })

    it('cross-team clash does not fire when the other-team event does not overlap', () => {
      const events = [evt('2026-02-08')]
      const checker = checkerFor(
        constraints({ [CONSTRAINT_KEYS.ENFORCE_CROSS_TEAM_CLASH]: true }),
        events,
        { ann: ['2026-02-15'] }
      )
      expect(checker.isEligible('ann', 'cam', events[0]).eligible).toBe(true)
    })

    it('cross-team caps fold external weekly load into the local once-per-week cap', () => {
      // Local: no assignments yet this week. External: one on the same week.
      // With ONLY_ONCE_PER_WEEK on AND cross-team caps on, the one external
      // assignment already fills the weekly cap → placement blocked.
      // Weeks run Mon–Sun: Sat 02-07 and Sun 02-08 share the Mon-02-02 week.
      const events = [evt('2026-02-08')]
      const checker = checkerFor(
        constraints({
          [CONSTRAINT_KEYS.ONLY_ONCE_PER_WEEK]: true,
          [CONSTRAINT_KEYS.ENFORCE_CROSS_TEAM_CAPS]: true,
        }),
        events,
        { ann: ['2026-02-07'] } // same ISO week as 02-08
      )
      const result = checker.isEligible('ann', 'cam', events[0])
      expect(result.eligible).toBe(false)
      expect(result.reason).toMatch(/this week/i)
    })

    it('cross-team caps require the local cap to be on (fold is inert otherwise)', () => {
      // ONLY_ONCE_PER_WEEK OFF, so even with cross-team caps ON and external
      // in-week load, the weekly cap is not consulted → placement allowed.
      const events = [evt('2026-02-08')]
      const checker = checkerFor(
        constraints({ [CONSTRAINT_KEYS.ENFORCE_CROSS_TEAM_CAPS]: true }),
        events,
        { ann: ['2026-02-09', '2026-02-10', '2026-02-11'] }
      )
      expect(checker.isEligible('ann', 'cam', events[0]).eligible).toBe(true)
    })

    it('cross-team caps fold external monthly load into max-per-month', () => {
      const events = [evt('2026-02-22')]
      const checker = checkerFor(
        constraints({
          [CONSTRAINT_KEYS.MAX_ASSIGNMENTS_PER_MONTH]: 2,
          [CONSTRAINT_KEYS.ENFORCE_CROSS_TEAM_CAPS]: true,
        }),
        events,
        { ann: ['2026-02-01', '2026-02-08'] } // two in the same month on another team
      )
      const result = checker.isEligible('ann', 'cam', events[0])
      expect(result.eligible).toBe(false)
      expect(result.reason).toMatch(/max assignments this month/i)
    })
  })

  // --- Validator ---
  describe('validator', () => {
    const placed = (date) => ({
      name: `Service ${date}`, date, day_of_week: 'Sunday', reporting_time: '09:00',
      roster: [{ role: 'cam', member_id: 'ann' }],
    })

    it('is unaffected by externalAssignments when the flags are OFF', () => {
      const events = [placed('2026-02-08')]
      const result = validateEventAssignments(
        events, members, [], [], constraints(), {}, rosterPeriod, { ann: ['2026-02-08'] }
      )
      expect(result['2026-02-08']).toBeUndefined()
    })

    it('flags a cross-team clash as a rostered-on-another-team error', () => {
      const events = [placed('2026-02-08')]
      const result = validateEventAssignments(
        events, members, [], [],
        constraints({ [CONSTRAINT_KEYS.ENFORCE_CROSS_TEAM_CLASH]: true }),
        {}, rosterPeriod, { ann: ['2026-02-08'] }
      )
      const errors = result['2026-02-08'].errors
      expect(errors.some(e => /another team/i.test(e))).toBe(true)
    })

    it('folds external weekly load into the once-per-week error when caps are on', () => {
      const events = [placed('2026-02-08')]
      const result = validateEventAssignments(
        events, members, [], [],
        constraints({
          [CONSTRAINT_KEYS.ONLY_ONCE_PER_WEEK]: true,
          [CONSTRAINT_KEYS.ENFORCE_CROSS_TEAM_CAPS]: true,
        }),
        {}, rosterPeriod, { ann: ['2026-02-07'] }
      )
      expect(result['2026-02-08'].errors.length).toBeGreaterThan(0)
    })
  })

  // --- Swap ---
  describe('swap', () => {
    const swapMembers = [
      { id: 'ann', name: 'Ann', include: true, roles: ['cam'] },
      { id: 'bea', name: 'Bea', include: true, roles: ['cam'] },
    ]
    const eventA = { date: '2026-02-08', roster: [{ role: 'cam', member_id: 'ann' }] }

    it('rejects moving a member onto a slot that clashes with another team', () => {
      const { ok, reason } = explainSwap({
        memberA: 'ann', memberB: null,
        eventA, eventB: eventA,
        sourceIndex: 0, targetIndex: 0,
        slotA: eventA.roster[0], slotB: eventA.roster[0],
        members: swapMembers, memberConstraints: [], allEvents: [eventA],
        externalAssignments: { ann: ['2026-02-08'] },
      })
      // Clash is always-on for swaps (feasibility); the message names the team.
      expect(ok).toBe(false)
      expect(reason).toMatch(/another team/i)
    })

    it('allows the swap when the member has no clashing other-team assignment', () => {
      const { ok, reason } = explainSwap({
        memberA: 'ann', memberB: null,
        eventA, eventB: eventA,
        sourceIndex: 0, targetIndex: 0,
        slotA: eventA.roster[0], slotB: eventA.roster[0],
        members: swapMembers, memberConstraints: [], allEvents: [eventA],
        externalAssignments: { ann: ['2026-02-15'] },
      })
      expect(ok).toBe(true)
      expect(reason).toBeNull()
    })
  })
})

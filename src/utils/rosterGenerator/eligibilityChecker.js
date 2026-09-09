/**
 * Check if a member is eligible for a role assignment based on hard constraints
 */

import { 
  isAssignedToEvent,
  eventsClash,
  externalEventsFor,
  externalWeeklyCount,
  externalMonthlyCount
} from '../../rules/constraintPrimitives'
import { CONSTRAINT_KEYS, isConstraintEnabled, isMemberIncluded } from '../../schema/rosterSchema'
import { understudySlotRole, isRoleCapable } from '../understudy'
import { getConstraintRule, CONSTRAINT_MODES } from '../../rules/constraints'

export class EligibilityChecker {
  constructor(members, constraints, rosterConstraints, tracker, options = {}) {
    this.members = members
    this.memberConstraints = constraints
    this.rosterConstraints = rosterConstraints
    this.tracker = tracker
    // The live (chronologically-sorted) events array being filled. Kept as a
    // reference so the clash constraint can scan for OTHER events overlapping a
    // placement's event; RosterState mutates these in place, so the scan always
    // reflects the current assignments. Empty by default (some call sites build
    // a checker without events, e.g. stats — the clash rule then finds nothing).
    this.events = options.events || []
    // Cross-team primitive (multi-tenant): a read-only snapshot of the
    // member's assignments in OTHER teams (`{ memberId: [dateOrDatetime, ...] }`).
    // Any load/cap count is derived from it, the same way the tracker derives
    // counters from local assignments. Folded into the ctx counting methods when
    // ENFORCE_CROSS_TEAM_CAPS / ENFORCE_CROSS_TEAM_CLASH are on; empty by default
    // so single-team eligibility is unchanged. See specs/multi-tenant.md.
    this.externalAssignments = options.externalAssignments || {}
  }
  
  /**
   * Check if member is eligible for a role on a specific event
   * @returns {Object} { eligible: boolean, reason: string }
   */
  isEligible(memberId, role, event, currentRoster = []) {
    const member = this.members.find(m => m.id === memberId)
    
    if (!member) {
      return { eligible: false, reason: 'Member not found' }
    }
    
    if (!isMemberIncluded(member)) {
      return { eligible: false, reason: 'Member not included in roster' }
    }
    
    // Check ENFORCE_MEMBER_ROLES
    if (isConstraintEnabled(this.rosterConstraints, CONSTRAINT_KEYS.ENFORCE_MEMBER_ROLES)) {
      if (!isRoleCapable(member, role)) {
        return { eligible: false, reason: `Member cannot perform role: ${role}` }
      }
    }

    // Hard constraints via the shared registry (one authority, three consumers).
    // The generator enforces BOTH feasibility and load-cadence kinds, and reads
    // counts from its stateful tracker through the ctx counting interface below.
    // currentRoster is passed via a per-call override so once-per-event sees the
    // slots placed so far in this event.
    this._currentRoster = currentRoster
    for (const constraint of [
      getConstraintRule('understudy-before-role'),
      getConstraintRule('availability'),
      getConstraintRule('once-per-event'),
      getConstraintRule('no-clash'),
      getConstraintRule('once-per-week'),
      getConstraintRule('max-per-month'),
    ]) {
      // no-clash runs when EITHER the local rule OR cross-team clash is on;
      // its own `enabled` reads only ENFORCE_NO_CLASH, so OR in the cross-team
      // flag here. overlappingEvents() folds local/external per which is on.
      const forceRun =
        constraint.key === 'no-clash' &&
        isConstraintEnabled(this.rosterConstraints, CONSTRAINT_KEYS.ENFORCE_CROSS_TEAM_CLASH)
      if (!forceRun && !constraint.enabled(this)) continue
      const violation = constraint.check({ memberId, role, event }, this, CONSTRAINT_MODES.WOULD_PLACE)
      if (violation) {
        return { eligible: false, reason: this._reasonFor(violation) }
      }
    }

    return { eligible: true, reason: null }
  }

  // --- ctx counting interface consumed by the registry descriptors ---
  currentRoster() {
    return (this._currentRoster || []).filter(s => s.member_id)
  }
  weeklyCount(memberId, date) {
    const local = this.tracker.getWeeklyAssignmentCount(memberId, date)
    if (!isConstraintEnabled(this.rosterConstraints, CONSTRAINT_KEYS.ENFORCE_CROSS_TEAM_CAPS)) return local
    // Cross-team caps: load is person-global — add the member's external
    // in-week assignments (derived from the snapshot, never a stored count).
    return local + externalWeeklyCount(memberId, date, this.externalAssignments)
  }
  monthlyCount(memberId, date) {
    const local = this.tracker.getMonthlyAssignmentCount(memberId, date)
    if (!isConstraintEnabled(this.rosterConstraints, CONSTRAINT_KEYS.ENFORCE_CROSS_TEAM_CAPS)) return local
    return local + externalMonthlyCount(memberId, date, this.externalAssignments)
  }
  priorUnderstudySessions(memberId, baseRole, date) {
    return this.tracker.getRoleCountBefore(memberId, understudySlotRole(baseRole), date)
  }
  // OTHER events whose time span overlaps the placement's event. Local events
  // are scanned when ENFORCE_NO_CLASH is on; the member's external (other-team)
  // assignments are folded in when ENFORCE_CROSS_TEAM_CLASH is on. Either source
  // may be active independently. Same-event duplicates are once-per-event's job.
  overlappingEvents(placement) {
    const out = []
    if (isConstraintEnabled(this.rosterConstraints, CONSTRAINT_KEYS.ENFORCE_NO_CLASH)) {
      for (const e of this.events) {
        if (e !== placement.event && eventsClash(e, placement.event)) out.push(e)
      }
    }
    if (isConstraintEnabled(this.rosterConstraints, CONSTRAINT_KEYS.ENFORCE_CROSS_TEAM_CLASH)) {
      for (const e of externalEventsFor(placement.memberId, this.externalAssignments)) {
        if (eventsClash(e, placement.event)) out.push(e)
      }
    }
    return out
  }

  // Generator-specific wording for each violation code (kept close to prior
  // messages so existing behaviour/tests are preserved).
  _reasonFor(violation) {
    const { code, params } = violation
    switch (code) {
      case 'unavailable': return 'Member unavailable on this date'
      case 'once-per-event': return 'Member already assigned to another role on this event'
      case 'clash': return params.external
        ? `Member rostered on another team on an overlapping event (${params.otherDate})`
        : `Member already assigned to an overlapping event (${params.otherDate})`
      case 'once-per-week': return 'Member already assigned this week'
      case 'max-per-month': return `Member has reached max assignments this month (${params.cap})`
      case 'understudy-before-role':
        return `Member must understudy ${params.role} at least ${params.minSessions} time(s) before performing it`
      case 'understudy-complete':
        return `Member has already completed ${params.minSessions} understudy session(s) for ${params.role} and no longer needs to understudy`
      default: return 'Assignment violates a roster constraint'
    }
  }

  /**
   * Lightweight look-ahead used by understudy seeding: could this trainee
   * plausibly PERFORM the real `role` on `event`, assuming they will have
   * completed their understudy session by then? Checks availability, role
   * capability and once-per-event — but deliberately ignores the
   * understudy-before-role gate (seeding is what will satisfy it) so we can
   * tell whether seeding this trainee here would actually pay off later.
   */
  canBePromotedTo(memberId, role, event) {
    const member = this.members.find(m => m.id === memberId)
    if (!isMemberIncluded(member)) return false
    if (!isRoleCapable(member, role)) return false
    if (getConstraintRule('availability').check({ memberId, role, event }, this, CONSTRAINT_MODES.WOULD_PLACE)) return false
    if (isAssignedToEvent(memberId, (event.roster || []).filter(s => s.member_id))) return false
    return true
  }
  
  /**
   * Get all eligible members for a role on an event
   */
  getEligibleMembers(role, event, currentRoster = []) {
    const eligibleMembers = []
    
    this.members.forEach(member => {
      if (!isMemberIncluded(member)) return
      
      const result = this.isEligible(member.id, role, event, currentRoster)
      if (result.eligible) {
        eligibleMembers.push(member.id)
      }
    })
    
    return eligibleMembers
  }
}

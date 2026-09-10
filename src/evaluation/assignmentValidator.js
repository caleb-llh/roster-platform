/**
 * Validate event assignments against constraints and preferences
 * @param {Array} events - All events with roster assignments
 * @param {Array} members - All members
 * @param {Array} memberConstraints - Member-level hard constraints
 * @param {Array} memberPreferences - Member-level preferences
 * @param {Object} rosterConstraints - Roster-level hard constraints
 * @param {Object} rosterPreferences - Roster-level preferences
 * @param {Object} rosterPeriod - Roster period with start_date and end_date
 * @returns {Object} - Validation results by event with errors and warnings
 */

import { 
  getMembersWithMultipleRoles,
  getWeekAssignments,
  countMonthlyAssignments,
  areConsecutiveWeekends,
  eventsClash,
  externalEventsFor,
  externalWeeklyCount,
  externalMonthlyCount
} from '../rules/constraintPrimitives'
import { PREFERENCE_KEYS, isPreferenceEnabled, MEMBER_PREF_FIELDS, CONSTRAINT_KEYS, isConstraintEnabled } from '../schema/rosterSchema'
import { countUnderstudySessionsBefore } from '../utils/understudy'
import { getConstraintRule, CONSTRAINT_MODES } from '../rules/constraints'

/**
 * Check if member is assigned on unavailable date
 */
const checkUnavailabilityViolation = (event, memberConstraints, members) => {
  const errors = []
  
  if (!event.roster || !Array.isArray(event.roster)) return errors
  
  // Availability is always reported here (NOT gated by the roster flag, unlike
  // the generator), so call the descriptor's `check` directly rather than
  // through `enabled`. Wording stays validator-specific.
  const availability = getConstraintRule('availability')
  event.roster.forEach(assignment => {
    if (assignment.member_id) {
      const violation = availability.check(
        { memberId: assignment.member_id, role: assignment.role, event },
        { memberConstraints },
        CONSTRAINT_MODES.IS_PLACED
      )
      if (violation) {
        const member = members.find(m => m.id === assignment.member_id)
        errors.push(`${member?.name || assignment.member_id} is unavailable on this date`)
      }
    }
  })
  
  return errors
}

/**
 * Check that a member assigned to a REAL role X is allowed to take it: either
 * they fully perform X, or (if they are only a TRAINEE for X) they have
 * completed at least UNDERSTUDY_MIN_SESSIONS understudy sessions for X on
 * strictly-earlier dates (i.e. they have been "promoted"). Flags any trainee
 * placed in the real role before promotion. Gated by
 * ENFORCE_UNDERSTUDY_BEFORE_ROLE.
 */
const checkUnderstudyBeforeRole = (event, allEvents, rosterConstraints, members) => {
  const errors = []

  if (!event.roster || !Array.isArray(event.roster)) return errors

  const understudyGate = getConstraintRule('understudy-before-role')
  const ctx = {
    rosterConstraints,
    members,
    priorUnderstudySessions: (memberId, role, date) =>
      countUnderstudySessionsBefore(memberId, role, allEvents, date),
  }
  if (!understudyGate.enabled(ctx)) return errors

  event.roster.forEach(assignment => {
    if (!assignment.member_id) return
    const violation = understudyGate.check(
      { memberId: assignment.member_id, role: assignment.role, event },
      ctx,
      CONSTRAINT_MODES.IS_PLACED
    )
    // The validator only diagnoses the real-role-too-early side; the descriptor
    // returns null for the understudy-slot side in IS_PLACED mode.
    if (violation && violation.code === 'understudy-before-role') {
      const member = members.find(m => m.id === assignment.member_id)
      errors.push(`${member?.name || assignment.member_id} is an understudy for ${violation.params.role} and must complete at least ${violation.params.minSessions} understudy session before being rostered for the actual role`)
    }
  })

  return errors
}

/**
 * Check if event is outside roster period
 */
const checkRosterPeriodViolation = (event, rosterPeriod) => {
  const errors = []
  
  if (!rosterPeriod || !rosterPeriod.start_date || !rosterPeriod.end_date) return errors
  
  const eventDate = new Date(event.date)
  const startDate = new Date(rosterPeriod.start_date)
  const endDate = new Date(rosterPeriod.end_date)
  
  if (eventDate < startDate || eventDate > endDate) {
    errors.push(`Event date ${event.date} is outside roster period (${rosterPeriod.start_date} to ${rosterPeriod.end_date})`)
  }
  
  return errors
}

/**
 * Check roster constraints violations.
 *
 * The DECISION for each rule comes from the shared CONSTRAINTS registry (same
 * predicate/cap/flag as the generator, in IS_PLACED mode), so there is one
 * authority. The validator only owns the WORDING: where the registry answers a
 * yes/no per assignment, the validator additionally enumerates the specific
 * offending events (clashing dates, month totals) for a richer message. See the
 * "one authority, three consumers" decision in specs/generation.md.
 */
const checkRosterConstraints = (event, allEvents, rosterConstraints, members, externalAssignments = {}) => {
  const errors = []
  
  if (!event.roster || !rosterConstraints) return errors

  const crossCaps = isConstraintEnabled(rosterConstraints, CONSTRAINT_KEYS.ENFORCE_CROSS_TEAM_CAPS)
  const crossClash = isConstraintEnabled(rosterConstraints, CONSTRAINT_KEYS.ENFORCE_CROSS_TEAM_CLASH)
  const localClash = isConstraintEnabled(rosterConstraints, CONSTRAINT_KEYS.ENFORCE_NO_CLASH)

  // ctx for registry decisions: counts come from whole-roster scans of allEvents
  // (the validator has no stateful tracker). currentRoster excludes the
  // assignment under test so once-per-event asks "is this member in ANOTHER
  // slot?" — matching the generator's would-place semantics. When the cross-team
  // flags are on, counts/overlaps fold in the person-global externalAssignments,
  // exactly as the generator's ctx does — same rule, different plumbing.
  const makeCtx = (excludeRole) => ({
    rosterConstraints,
    members,
    currentRoster: () => event.roster.filter(r => r.member_id && r.role !== excludeRole),
    weeklyCount: (memberId, date) =>
      getWeekAssignments(memberId, date, allEvents).length +
      (crossCaps ? externalWeeklyCount(memberId, date, externalAssignments) : 0),
    monthlyCount: (memberId, date) =>
      countMonthlyAssignments(memberId, date, allEvents) +
      (crossCaps ? externalMonthlyCount(memberId, date, externalAssignments) : 0),
    // OTHER events whose time span overlaps this one. Local events (excluding
    // this one by identity) count when ENFORCE_NO_CLASH is on; the member's
    // external assignments count when ENFORCE_CROSS_TEAM_CLASH is on.
    overlappingEvents: (placement) => {
      const out = []
      if (localClash) {
        for (const e of allEvents) if (e !== placement.event && eventsClash(e, placement.event)) out.push(e)
      }
      if (crossClash) {
        for (const e of externalEventsFor(placement.memberId, externalAssignments)) {
          if (eventsClash(e, placement.event)) out.push(e)
        }
      }
      return out
    },
  })

  const oncePerEvent = getConstraintRule('once-per-event')
  const noClash = getConstraintRule('no-clash')
  const oncePerWeek = getConstraintRule('once-per-week')
  const maxPerMonth = getConstraintRule('max-per-month')
  
  // ONLY_ONCE_PER_EVENT — decision from the registry, per member; wording lists
  // the specific roles so the message stays actionable.
  if (oncePerEvent.enabled(makeCtx())) {
    const multipleRoles = getMembersWithMultipleRoles(event.roster)
    multipleRoles.forEach(({ memberId, roles }) => {
      const member = members.find(m => m.id === memberId)
      errors.push(`${member?.name || memberId} is assigned to multiple roles: ${roles.join(', ')}`)
    })
  }
  
  const assignedMemberIds = event.roster
    .filter(r => r.member_id)
    .map(r => r.member_id)

  // ENFORCE_NO_CLASH / ENFORCE_CROSS_TEAM_CLASH — registry decides (member in an
  // overlapping OTHER event); the validator names the clashing event's date, and
  // labels a cross-team clash so the message distinguishes the two.
  if (localClash || crossClash) {
    const ctx = makeCtx()
    assignedMemberIds.forEach(memberId => {
      const violation = noClash.check({ memberId, role: null, event }, ctx, CONSTRAINT_MODES.IS_PLACED)
      if (!violation) return
      const member = members.find(m => m.id === memberId)
      const isExternal = violation.params.external
      errors.push(
        isExternal
          ? `${member?.name || memberId} is rostered on another team on ${violation.params.otherDate}, which overlaps this event`
          : `${member?.name || memberId} is also rostered on ${violation.params.otherDate}, which overlaps this event`
      )
    })
  }
  
  // ONLY_ONCE_PER_WEEK — registry decides (IS_PLACED: count-in-week > 1); the
  // validator enumerates the other in-week events for the message. When the
  // overage is entirely cross-team (no OTHER local in-week event), the registry
  // still flags it (weeklyCount folds external load); surface that as a
  // cross-team message rather than dropping the error silently.
  if (oncePerWeek.enabled(makeCtx())) {
    const ctx = makeCtx()
    assignedMemberIds.forEach(memberId => {
      const violation = oncePerWeek.check({ memberId, role: null, event }, ctx, CONSTRAINT_MODES.IS_PLACED)
      if (!violation) return
      const weekAssignments = getWeekAssignments(memberId, event.date, allEvents)
      const otherWeekEvents = weekAssignments.filter(e => e.date !== event.date)
      const member = members.find(m => m.id === memberId)
      if (otherWeekEvents.length) {
        otherWeekEvents.forEach(weekEvent => {
          errors.push(`${member?.name || memberId} is already rostered on ${weekEvent.date} (${weekEvent.day_of_week}) this week`)
        })
      } else if (crossCaps) {
        errors.push(`${member?.name || memberId} is already rostered on another team this week`)
      }
    })
  }
  
  // MAX_ASSIGNMENTS_PER_MONTH — registry decides (IS_PLACED: count > cap); the
  // validator reports the exact count and month name.
  if (maxPerMonth.enabled(makeCtx())) {
    const ctx = makeCtx()
    assignedMemberIds.forEach(memberId => {
      const violation = maxPerMonth.check({ memberId, role: null, event }, ctx, CONSTRAINT_MODES.IS_PLACED)
      if (!violation) return
      const member = members.find(m => m.id === memberId)
      const eventDate = new Date(event.date)
      const monthName = eventDate.toLocaleString('default', { month: 'long' })
      errors.push(`${member?.name || memberId} has ${violation.params.count} assignments in ${monthName} (max: ${violation.params.cap})`)
    })
  }
  
  return errors
}

/**
 * Check roster preferences violations
 */
const checkRosterPreferences = (event, allEvents, rosterPreferences, members) => {
  const warnings = []
  
  if (!event.roster || !rosterPreferences) return warnings
  
  const assignedMemberIds = event.roster
    .filter(r => r.member_id)
    .map(r => r.member_id)
  
  // Check AVOID_CONSECUTIVE_WEEKS
  if (isPreferenceEnabled(rosterPreferences, PREFERENCE_KEYS.AVOID_CONSECUTIVE_WEEKS)) {
    assignedMemberIds.forEach(memberId => {
      // Find other events where member is assigned
      const otherAssignments = allEvents.filter(e => 
        e.date !== event.date && e.roster?.some(r => r.member_id === memberId)
      )
      const member = members.find(m => m.id === memberId)
      
      otherAssignments.forEach(otherEvent => {
        // Check both directions since areConsecutiveWeekends checks if date2 follows date1
        if (areConsecutiveWeekends(event.date, otherEvent.date) || 
            areConsecutiveWeekends(otherEvent.date, event.date)) {
          warnings.push(`${member?.name || memberId} is rostered on consecutive weekend (${otherEvent.date})`)
        }
      })
    })
  }
  
  return warnings
}

/**
 * Check member preferences violations
 */
const checkMemberPreferences = (event, memberPreferences, members) => {
  const warnings = []
  
  if (!event.roster || !memberPreferences) return warnings
  
  event.roster.forEach(assignment => {
    if (assignment.member_id) {
      const memberPref = memberPreferences.find(p => p.member_id === assignment.member_id)
      if (memberPref && memberPref.days) {
        const eventDayOfWeek = event.day_of_week
        
        // Check if event day matches preferred days
        if (!memberPref.days.includes(eventDayOfWeek)) {
          const member = members.find(m => m.id === assignment.member_id)
          const preferredDays = memberPref.days.join(', ')
          warnings.push(`${member?.name || assignment.member_id} prefers ${preferredDays} (not ${eventDayOfWeek})`)
        }
      }
    }
  })
  
  return warnings
}

/**
 * Validate all events
 */
export const validateEventAssignments = (events, members, memberConstraints, memberPreferences, rosterConstraints, rosterPreferences, rosterPeriod, externalAssignments = {}) => {
  const validationResults = {}
  
  events.forEach((event, index) => {
    const eventKey = event.date // Use just date as key to match EventsView lookup
    
    const errors = [
      ...checkRosterPeriodViolation(event, rosterPeriod),
      ...checkUnavailabilityViolation(event, memberConstraints, members),
      ...checkRosterConstraints(event, events, rosterConstraints, members, externalAssignments),
      ...checkUnderstudyBeforeRole(event, events, rosterConstraints, members)
    ]
    
    const warnings = [
      ...checkRosterPreferences(event, events, rosterPreferences, members),
      ...checkMemberPreferences(event, memberPreferences, members)
    ]
    
    // Remove duplicates
    const uniqueErrors = [...new Set(errors)]
    const uniqueWarnings = [...new Set(warnings)]
    
    // Store or append to existing results (in case multiple events on same date)
    if (uniqueErrors.length > 0 || uniqueWarnings.length > 0) {
      if (validationResults[eventKey]) {
        // Append to existing
        validationResults[eventKey].errors.push(...uniqueErrors)
        validationResults[eventKey].warnings.push(...uniqueWarnings)
        // Remove duplicates after appending
        validationResults[eventKey].errors = [...new Set(validationResults[eventKey].errors)]
        validationResults[eventKey].warnings = [...new Set(validationResults[eventKey].warnings)]
      } else {
        validationResults[eventKey] = {
          errors: uniqueErrors,
          warnings: uniqueWarnings
        }
      }
    }
  })
  
  return validationResults
}

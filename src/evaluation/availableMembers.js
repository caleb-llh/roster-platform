/**
 * "Who can fill each slot of this event?" — the availability judge behind the
 * roster picker dropdown.
 *
 * This is an **evaluation** concern, not a leaf primitive: it composes the
 * shared role-capability rules (`canFillSlotRole`/`isPromotedForRole`) and the
 * `availability` constraint descriptor (the one authority — the same rule the
 * generator/validator/swap use) to judge each qualified member. It lives in
 * `evaluation/` (beside `eligibilityChecker`/`assignmentValidator`) so that
 * `rules/constraintPrimitives.js` can stay a true dependency-light leaf.
 */
import { isUnderstudyRole } from '../schema/understudyRoles'
import { canFillSlotRole, isPromotedForRole } from '../rules/understudyPolicy'
import { getConstraintRule, CONSTRAINT_MODES } from '../rules/constraints'
import { isMemberIncluded } from '../schema/rosterSchema'

/**
 * Get all available members for an event based on roles and constraints
 * @param {Object} event - Event object with date and slots
 * @param {Array} members - All members
 * @param {Array} constraints - Constraint objects
 * @param {Array} [allEvents] - All events; enables listing promoted trainees
 *   (understudies who completed their session earlier) for real-role slots
 * @returns {Object} - Object with role -> available members mapping
 */
export const getAvailableMembersForEvent = (event, members, constraints, allEvents = null) => {
  if (!event.slots || !Array.isArray(event.slots)) return {}

  const events = allEvents || [event]
  const availabilityByRole = {}

  // A role may appear in more than one slot of the same event (the slots are a
  // positional array, so duplicate roles are legal — e.g. two `roving-cam`).
  // Availability for a role is the SAME regardless of how many slots it has, so
  // we key by role name and compute it once. But "assigned" must reflect ANY
  // slot of that role: pre-index the member_ids assigned to each role so a
  // member covering the first of two duplicate slots is still marked assigned
  // (previously the last slot's assignment overwrote the earlier one).
  const assignedIdsByRole = {}
  event.slots.forEach(assignment => {
    if (!assignment.member_id) return
    ;(assignedIdsByRole[assignment.role] ||= new Set()).add(assignment.member_id)
  })

  event.slots.forEach(assignment => {
    const role = assignment.role
    if (availabilityByRole[role]) return // already computed for this role

    // Who can fill this slot?
    //  - Full performers / trainees for understudy slots: canFillSlotRole.
    //  - For a REAL role X, also include trainees who have been "promoted" —
    //    i.e. completed an understudy session for X on an earlier date — so the
    //    picker can reproduce the generator's promotions. Trainees who haven't
    //    understudied yet stay out, honouring the understudy-before-role rule.
    const qualifiedMembers = members.filter(m => {
      if (!isMemberIncluded(m)) return false
      if (canFillSlotRole(m, role)) return true
      if (!isUnderstudyRole(role)) return isPromotedForRole(m, role, events, event.date)
      return false
    })

    const assignedIds = assignedIdsByRole[role] || new Set()

    // Availability decision comes from the shared `availability` constraint
    // descriptor (one authority — same rule the generator/validator/swap use),
    // NOT a private re-check. Called directly (bypassing `enabled`) because the
    // dropdown always SHOWS unavailability as a cue regardless of whether the
    // ENFORCE_MEMBER_AVAILABILITY flag gates generation — matching the validator.
    const availability = getConstraintRule('availability')
    const ctx = { memberConstraints: constraints }

    // Check availability for each qualified member
    const memberAvailability = qualifiedMembers.map(member => ({
      id: member.id,
      name: member.name,
      available: !availability.check(
        { memberId: member.id, role, event },
        ctx,
        CONSTRAINT_MODES.WOULD_PLACE
      ),
      assigned: assignedIds.has(member.id),
      // Mark trainees being promoted into a real role so the UI can label them.
      isUnderstudy: !isUnderstudyRole(role) && !(member.roles || []).includes(role),
    }))

    availabilityByRole[role] = memberAvailability
  })

  return availabilityByRole
}

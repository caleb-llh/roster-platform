/**
 * Understudy *policy* — the judgement half of the understudy feature.
 *
 * These are togglable judgements and thresholds about who *may* fill a slot and
 * when a trainee has trained *enough* — i.e. the promotion gate. They belong in
 * the Rules layer (applied by Evaluation), not in Schema. The pure vocabulary
 * they build on (role naming, member-role normalization) lives in
 * `schema/understudyRoles.js`; importing it here is the correct Rules -> Schema
 * direction.
 *
 * The rule enforced by the generator: a trainee for `X` may only be assigned to
 * the real role `X` after they have been assigned to `X-understudy` at least
 * UNDERSTUDY_MIN_SESSIONS times on strictly earlier dates.
 *
 * See specs/understudy.md for the authoritative feature rules.
 */

import {
  understudySlotRole,
  isUnderstudyRole,
  baseRoleOf,
} from '../schema/understudyRoles'

/**
 * How many prior understudy sessions (on strictly earlier dates) a trainee needs
 * before becoming eligible for the real role. Configured in code; defaults to 1.
 */
export const UNDERSTUDY_MIN_SESSIONS = 1

/**
 * Single source of truth for "can this member occupy this slot role?" — the
 * role-compatibility rule shared by the generator's eligibility checker, the
 * assignment dropdown, and drag-and-drop. Availability and count-based limits
 * are enforced separately; this only answers role capability.
 *
 * - Real role X: the member fully performs X (X in `roles`).
 * - Understudy slot "X-understudy": the member is TRAINING for X
 *   (X in `understudyFor`). Full performers are not understudies.
 *
 * @param {{ roles?: string[], understudyFor?: string[] }} member  normalized member
 * @param {string} slotRole  the slot's role (may be an understudy slot)
 */
export function canFillSlotRole(member, slotRole) {
  if (!member) return false
  if (isUnderstudyRole(slotRole)) {
    return (member.understudyFor || []).includes(baseRoleOf(slotRole))
  }
  return (member.roles || []).includes(slotRole)
}

/**
 * Generator-side role capability (for ENFORCE_MEMBER_ROLES). Broader than
 * {@link canFillSlotRole}: for a real role X a TRAINEE (understudyFor X) is
 * considered capable so this hard constraint passes — the separate
 * ENFORCE_UNDERSTUDY_BEFORE_ROLE gate then decides whether they have
 * understudied enough to actually take it. Understudy slots use the same strict
 * rule as the UI (trainees only).
 *
 * @param {{ roles?: string[], understudyFor?: string[] }} member  normalized member
 * @param {string} slotRole  the slot's role (may be an understudy slot)
 */
export function isRoleCapable(member, slotRole) {
  if (!member) return false
  if (isUnderstudyRole(slotRole)) {
    return (member.understudyFor || []).includes(baseRoleOf(slotRole))
  }
  return (member.roles || []).includes(slotRole) || (member.understudyFor || []).includes(slotRole)
}

/**
 * Count how many understudy sessions a member has completed for base role `X`
 * on dates STRICTLY EARLIER than `beforeDate`, by scanning the roster of every
 * event. Used by the UI to decide whether a trainee has been "promoted" (become
 * eligible to fill the real role X) — the same understudy-before-role rule the
 * generator enforces, but computed from the events themselves rather than a
 * live tracker.
 *
 * @param {string} memberId
 * @param {string} baseRole            the real role (e.g. "multi-vm")
 * @param {Array}  events              all events (each with `date` + `roster[]`)
 * @param {string} beforeDate          YYYY-MM-DD; only earlier sessions count
 * @returns {number} completed understudy sessions before `beforeDate`
 */
export function countUnderstudySessionsBefore(memberId, baseRole, events, beforeDate) {
  if (!Array.isArray(events)) return 0
  const slotRole = understudySlotRole(baseRole)
  let count = 0
  for (const event of events) {
    if (!event?.date || event.date >= beforeDate) continue
    for (const slot of event.roster || []) {
      if (slot.role === slotRole && slot.member_id === memberId) count++
    }
  }
  return count
}

/**
 * True if a trainee for base role `X` has completed enough understudy sessions
 * (>= UNDERSTUDY_MIN_SESSIONS, on strictly earlier dates) to be promoted into
 * the real role `X` on `beforeDate`.
 */
export function isPromotedForRole(member, baseRole, events, beforeDate) {
  if (!member || !(member.understudyFor || []).includes(baseRole)) return false
  return countUnderstudySessionsBefore(member.id, baseRole, events, beforeDate) >= UNDERSTUDY_MIN_SESSIONS
}

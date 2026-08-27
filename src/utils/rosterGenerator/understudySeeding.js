/**
 * Understudy seeding pre-pass.
 *
 * Members can declare a role with `understudy: true`, meaning they must shadow
 * that role (be assigned to an "X-understudy" slot) at least
 * UNDERSTUDY_MIN_SESSIONS times before the ENFORCE_UNDERSTUDY_BEFORE_ROLE gate
 * lets them perform the real role X.
 *
 * If the input events contain no "X-understudy" slots, such a trainee can never
 * unlock X and is effectively unrosterable. This pre-pass (Phase 0) fixes that
 * by proactively creating shadowing opportunities: for each trainee/role, it
 * finds feasible events that already have a real X slot and injects an
 * "X-understudy" slot assigned to the trainee — up to the required session
 * count.
 *
 * Design notes (kept deliberately narrow to stay clean):
 *  - Only APPENDS slots; it never removes or reassigns existing ones.
 *  - Injected slots are tagged `isGenerated: true`, so the existing
 *    "Remove generated" action and re-generation treat them like any other
 *    generated assignment (idempotent across regeneration).
 *  - Feasibility reuses EligibilityChecker.isEligible — no duplicated constraint
 *    logic. The trainee must satisfy availability, once-per-event/week, and
 *    monthly-cap for the understudy slot's date.
 *  - Runs before greedy construction so the tracker already reflects these
 *    sessions when the gate is evaluated for the real role.
 *  - Promotion-aware: when several trainees could take the same understudy
 *    session, it prefers the one who can actually be PROMOTED into the real
 *    role at a strictly-later event (available there). This builds a promotion
 *    chain (understudy month N -> perform month N+1) and maximises the number
 *    of trainees who go on to perform the real role, instead of parking a
 *    trainee who is unavailable at every subsequent real-role event.
 */

import { understudySlotRole, UNDERSTUDY_MIN_SESSIONS } from '../understudy'
import { NULL_LOGGER } from './actionLog'
import { isMemberIncluded } from '../../schema/rosterSchema'

/**
 * Inject understudy shadowing slots into feasible events.
 *
 * @param {Array} events    cloned, chronologically-sorted events (mutated in place)
 * @param {Array} members   normalized members ({ id, roles, understudyFor, ... })
 * @param {EligibilityChecker} eligibilityChecker
 * @param {AssignmentTracker} tracker  tracker seeded from these events (mutated)
 * @param {Object} [options]
 * @param {ActionLogger} [options.logger]
 * @returns {number} number of understudy slots created
 */
export function seedUnderstudySlots(events, members, eligibilityChecker, tracker, options = {}) {
  const { logger = NULL_LOGGER } = options
  let created = 0

  // Group trainees by the base role they are training for.
  const traineesByBaseRole = new Map()
  members.forEach(member => {
    if (!isMemberIncluded(member)) return
    ;(member.understudyFor || []).forEach(baseRole => {
      if (!traineesByBaseRole.has(baseRole)) traineesByBaseRole.set(baseRole, [])
      traineesByBaseRole.get(baseRole).push(member)
    })
  })

  traineesByBaseRole.forEach((trainees, baseRole) => {
    const slotRole = understudySlotRole(baseRole)

    // Trainees who still need an understudy session (skip those already at target
    // via pre-authored / previously-seeded slots).
    const needed = trainees.filter(
      m => tracker.getRoleDates(m.id, slotRole).length < UNDERSTUDY_MIN_SESSIONS
    )
    if (needed.length === 0) return
    const stillNeeds = new Set(needed.map(m => m.id))

    // Walk events chronologically. Each event that has (or can host) an
    // understudy slot for this role is a shadowing opportunity.
    events.forEach((event, eventIndex) => {
      if (stillNeeds.size === 0) return
      if (!Array.isArray(event.roster)) return

      const currentRoster = event.roster.filter(s => s.member_id)
      const existing = event.roster.find(s => s.role === slotRole && !s.member_id)
      const hasBaseRole = event.roster.some(s => s.role === baseRole)
      const alreadyHasUnderstudy = event.roster.some(s => s.role === slotRole)

      // Can this event host a new understudy session at all?
      const canFill = Boolean(existing)
      const canInject = !existing && hasBaseRole && !alreadyHasUnderstudy
      if (!canFill && !canInject) return

      // Candidate trainees: still need a session AND are eligible for the
      // understudy session on this event.
      const candidates = needed.filter(m =>
        stillNeeds.has(m.id) &&
        eligibilityChecker.isEligible(m.id, slotRole, event, currentRoster).eligible
      )
      if (candidates.length === 0) return

      // Later events that host a REAL base-role slot are promotion sites.
      const laterRealEvents = events
        .slice(eventIndex + 1)
        .filter(e => Array.isArray(e.roster) && e.roster.some(s => s.role === baseRole))

      // Score each candidate by how soon they could be promoted after this
      // session (index into laterRealEvents). Promotable candidates sort first;
      // among them the one reachable soonest wins so the chain stays tight.
      const rankOf = (m) => {
        const idx = laterRealEvents.findIndex(e => eligibilityChecker.canBePromotedTo(m.id, baseRole, e))
        return idx === -1 ? Number.POSITIVE_INFINITY : idx
      }
      candidates.sort((a, b) => rankOf(a) - rankOf(b))
      const chosen = candidates[0]

      if (existing) {
        existing.member_id = chosen.id
        existing.isGenerated = true
      } else {
        event.roster.push({ role: slotRole, member_id: chosen.id, isGenerated: true })
        created++
      }
      tracker.recordAssignment(chosen.id, event.date, event.day_of_week, slotRole)
      stillNeeds.delete(chosen.id)
      logger.debug(
        `${event.date} ${event.name} / ${slotRole}: ${existing ? 'filled' : 'seeded'} understudy ${chosen.id}`,
        { remaining: stillNeeds.size, promotable: rankOf(chosen) !== Number.POSITIVE_INFINITY }
      )
    })

    if (stillNeeds.size > 0) {
      logger.warn(
        `Could not provide understudy sessions for ${[...stillNeeds].join(', ')} on ${baseRole} ` +
        `(no feasible events with a ${baseRole} slot)`
      )
    }
  })

  return created
}

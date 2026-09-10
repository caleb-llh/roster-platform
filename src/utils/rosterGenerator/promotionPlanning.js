/**
 * Promotion planning (a phase of its own, run after understudy seeding).
 *
 * WHY THIS EXISTS
 * Seeding guarantees every trainee gets an understudy session so the
 * ENFORCE_UNDERSTUDY_BEFORE_ROLE gate can later unlock the real role. But merely
 * being *eligible* to perform the real role is not enough: greedy construction
 * fills events chronologically and MAX_ASSIGNMENTS_PER_MONTH is a hard cap, so a
 * trainee's monthly budget can be spent on ordinary slots BEFORE their real-role
 * (promotion) opportunity arrives — leaving them capped out and unable to be
 * promoted. Greedy scoring cannot recover from this once the trainee is
 * hard-blocked, so promotions must be secured here, before greedy runs.
 *
 * This phase is the SOLE promotion mechanism. Across the whole population of
 * unlocked trainees it searches (by backtracking) for the assignment of
 * trainees to later real base-role slots that PROMOTES THE MAXIMUM NUMBER of
 * distinct trainees, honouring all hard constraints. The chosen promotions are
 * committed as generated assignments and pinned so later phases don't undo them.
 *
 * DESIGN NOTES
 *  - Runs after seedUnderstudySlots, so the tracker already reflects each
 *    trainee's understudy session(s).
 *  - Feasibility reuses EligibilityChecker.isEligible — no duplicated constraint
 *    logic. Because assigning one promotion mutates monthly/weekly counters that
 *    affect other trainees, we can't use a static bipartite matching; we do a
 *    real DFS that records each tentative assignment in the tracker and reverts
 *    it on backtrack, so every feasibility check sees the true running state.
 *  - Only fills EMPTY real slots; never displaces an existing occupant.
 *  - Pinned via `slot._pinnedPromotion = true` so local search leaves it alone
 *    (see rosterState.isLocked). The flag is stripped before returning results.
 */

import { understudySlotRole } from '../../schema/understudyRoles'
import { UNDERSTUDY_MIN_SESSIONS } from '../../rules/understudyPolicy'
import { NULL_LOGGER } from './actionLog'
import { isMemberIncluded } from '../../schema/rosterSchema'

/**
 * @param {Array} events    cloned, chronologically-sorted events (mutated)
 * @param {Array} members   normalized members
 * @param {EligibilityChecker} eligibilityChecker
 * @param {AssignmentTracker} tracker  already reflects seeded understudy sessions
 * @param {Object} [options]
 * @param {ActionLogger} [options.logger]
 * @returns {number} number of promotions committed
 */
export function planPromotions(events, members, eligibilityChecker, tracker, options = {}) {
  const { logger = NULL_LOGGER } = options

  // Base roles that have trainees.
  const baseRoles = new Set()
  members.forEach(m => {
    if (!isMemberIncluded(m)) return
    ;(m.understudyFor || []).forEach(r => baseRoles.add(r))
  })
  if (baseRoles.size === 0) return 0

  let committed = 0

  baseRoles.forEach(baseRole => {
    const slotRole = understudySlotRole(baseRole)

    // Unlocked trainees: completed their understudy session(s) and have not yet
    // performed the real role. Capture the latest understudy date so promotions
    // are strictly later.
    const trainees = members
      .filter(m => isMemberIncluded(m) && (m.understudyFor || []).includes(baseRole))
      .map(m => {
        const understudyDates = tracker.getRoleDates(m.id, slotRole)
        const performed = tracker.getRoleAssignmentCount(m.id, baseRole)
        return {
          id: m.id,
          unlocked: understudyDates.length >= UNDERSTUDY_MIN_SESSIONS && performed === 0,
          lastUnderstudyDate: understudyDates[understudyDates.length - 1] || null,
        }
      })
      .filter(t => t.unlocked)
    if (trainees.length === 0) return

    // Open real base-role slots (empty), chronologically.
    const openSlots = []
    events.forEach((event, eventIndex) => {
      if (!Array.isArray(event.roster)) return
      event.roster.forEach((slot, roleIndex) => {
        if (slot.role === baseRole && !slot.member_id) {
          openSlots.push({ eventIndex, roleIndex, event })
        }
      })
    })
    if (openSlots.length === 0) return

    // Per-trainee feasible slot indices (into openSlots): strictly-later date and
    // currently eligible (baseline, before any tentative promotions). This prunes
    // the DFS; final feasibility is re-checked live during the search.
    const feasibleBase = new Map()
    trainees.forEach(t => {
      const idxs = openSlots
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => !t.lastUnderstudyDate || s.event.date > t.lastUnderstudyDate)
        .map(({ i }) => i)
      feasibleBase.set(t.id, idxs)
    })

    // Backtracking search over trainees, maximising promoted count. Each
    // tentative promotion is recorded in the tracker so subsequent eligibility
    // checks (monthly cap, once-per-week/event) reflect it, then reverted.
    const usedSlots = new Set()
    let best = []
    const current = []

    const recordTentative = (traineeId, slotIdx) => {
      const { event, roleIndex } = openSlots[slotIdx]
      event.roster[roleIndex].member_id = traineeId
      tracker.recordAssignment(traineeId, event.date, event.day_of_week, baseRole)
    }
    const undoTentative = (traineeId, slotIdx) => {
      const { event, roleIndex } = openSlots[slotIdx]
      tracker.removeAssignment(traineeId, event.date, event.day_of_week, baseRole)
      event.roster[roleIndex].member_id = null
    }

    const dfs = (ti) => {
      if (current.length > best.length) best = current.slice()
      if (best.length === trainees.length) return // can't do better
      if (ti >= trainees.length) return

      const t = trainees[ti]
      // Try promoting this trainee into each still-free feasible slot.
      for (const slotIdx of feasibleBase.get(t.id)) {
        if (usedSlots.has(slotIdx)) continue
        const { event, roleIndex } = openSlots[slotIdx]
        const currentRoster = event.roster.filter(s => s.member_id)
        if (!eligibilityChecker.isEligible(t.id, baseRole, event, currentRoster).eligible) continue

        usedSlots.add(slotIdx)
        current.push({ traineeId: t.id, slotIdx })
        recordTentative(t.id, slotIdx)

        dfs(ti + 1)

        undoTentative(t.id, slotIdx)
        current.pop()
        usedSlots.delete(slotIdx)
        if (best.length === trainees.length) return
      }
      // Also consider NOT promoting this trainee (they may be unpromotable, or
      // skipping them may free a slot that promotes two others).
      dfs(ti + 1)
    }
    dfs(0)

    // Commit the best assignment: pin each promotion so later phases keep it.
    best.forEach(({ traineeId, slotIdx }) => {
      const { event, roleIndex } = openSlots[slotIdx]
      const slot = event.roster[roleIndex]
      slot.member_id = traineeId
      slot.isGenerated = true
      slot._pinnedPromotion = true
      tracker.recordAssignment(traineeId, event.date, event.day_of_week, baseRole)
      committed++
      logger.debug(
        `${event.date} ${event.name} / ${baseRole}: promote understudy ${traineeId}`
      )
    })

    const promotable = best.length
    const notPromoted = trainees.length - promotable
    if (notPromoted > 0) {
      logger.debug(
        `${baseRole}: promoted ${promotable}/${trainees.length} unlocked trainee(s); ` +
        `${notPromoted} had no feasible later slot`
      )
    }
  })

  return committed
}

/** Strip the transient pin flag from all slots (call once planning + search done). */
export function clearPromotionPins(events) {
  events.forEach(event => {
    event.roster?.forEach(slot => {
      if (slot._pinnedPromotion) delete slot._pinnedPromotion
    })
  })
}

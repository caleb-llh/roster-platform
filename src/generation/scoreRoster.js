import { areConsecutiveWeekends } from '../rules/constraintPrimitives'
import { PREFERENCE_KEYS, isPreferenceEnabled } from '../schema/rosterSchema'
import { SCORING_WEIGHTS } from './scoringEngine'

/**
 * Roster quality objective (higher is better), computed directly from a
 * WorkingRoster-like object ({ events, tracker }). Shared by the final quality
 * report (calculateRosterQuality) and the local-search loop so both optimize
 * the same objective.
 *
 * Extracted from generation/index.js (audit B4) once it earned a second reader
 * (the Phase-2 local search + the final quality report): it is the whole-roster
 * OBJECTIVE, distinct from the per-candidate greedy scorer (rules/scorers.js)
 * and from orchestration. It deliberately reuses the same SCORING_WEIGHTS as the
 * greedy scorer so quality selection stays aligned with construction.
 */
export function scoreRoster(state, memberPreferences, rosterPreferences) {
  const { events, tracker } = state

  // Count preference violations and unfilled slots.
  let dayPrefViolations = 0
  let rolePrefViolations = 0
  let emptySlots = 0

  events.forEach(event => {
    event.roster?.forEach(assignment => {
      if (!assignment.member_id) {
        emptySlots++
        return
      }
      const memberPref = memberPreferences?.find(p => p.member_id === assignment.member_id)

      if (memberPref?.days && !memberPref.days.includes(event.day_of_week)) {
        dayPrefViolations++
      }
      if (memberPref?.roles && !memberPref.roles.includes(assignment.role)) {
        rolePrefViolations++
      }
    })
  })

  // Consecutive-weekend violations across the WHOLE roster (gated by the
  // AVOID_CONSECUTIVE_WEEKS preference). Phase 1's per-candidate scorer only
  // biases greedy construction; counting it here makes Phase 2 local search
  // also minimise it (otherwise a swap could re-introduce a consecutive-weekend
  // pairing the objective was blind to — the same "heuristic that never entered
  // the Phase-2 objective" trap as the removed availability scorer).
  const consecutiveWeekendViolations =
    isPreferenceEnabled(rosterPreferences, PREFERENCE_KEYS.AVOID_CONSECUTIVE_WEEKS)
      ? countConsecutiveWeekendViolations(events)
      : 0

  // Weight-based penalty (lower cost = better quality). Reuses the shared
  // SCORING_WEIGHTS so quality selection stays aligned with the per-candidate
  // scoring engine.
  const cost =
    tracker.getFairnessScore() * SCORING_WEIGHTS.fairness +
    tracker.getSpreadScore() * SCORING_WEIGHTS.spread +
    dayPrefViolations * SCORING_WEIGHTS.dayPreference +
    rolePrefViolations * SCORING_WEIGHTS.rolePreference +
    consecutiveWeekendViolations * SCORING_WEIGHTS.consecutiveWeekends +
    emptySlots * 1000        // Heavily penalize unfilled roles

  // Return negative cost (so higher = better)
  return -cost
}

/**
 * Count, across all events, how many times a member is rostered on two
 * consecutive weekends. Each such pair contributes one violation. Computed by
 * scanning per-member assignment dates so it reflects the whole roster (not a
 * "last assignment" pointer), making it safe for local-search re-evaluation.
 */
function countConsecutiveWeekendViolations(events) {
  const datesByMember = {}
  events.forEach(event => {
    event.roster?.forEach(assignment => {
      if (!assignment.member_id) return
      ;(datesByMember[assignment.member_id] ||= []).push(event.date)
    })
  })

  let violations = 0
  Object.values(datesByMember).forEach(dates => {
    const sorted = [...new Set(dates)].sort()
    for (let i = 1; i < sorted.length; i++) {
      if (areConsecutiveWeekends(sorted[i - 1], sorted[i])) violations++
    }
  })
  return violations
}

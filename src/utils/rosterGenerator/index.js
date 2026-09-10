/**
 * Roster Generation Algorithm
 *
 * Generates assignments for unassigned roles in ordered phases:
 *
 * Phase 0 — Understudy seeding (`understudySeeding.js`, gated by
 *   ENFORCE_UNDERSTUDY_BEFORE_ROLE):
 *   - Pre-fill understudy slots so trainees shadow early, choosing whoever can
 *     be promoted soonest afterwards.
 *
 * Phase 0.5 — Promotion planning (`promotionPlanning.js`, gated by
 *   ENFORCE_UNDERSTUDY_BEFORE_ROLE):
 *   - Backtrack over unlocked trainees to reserve later real-role slots that
 *     maximise the number of promotions; pin them so Phase 2 won't swap them.
 *
 * Phase 1 — Greedy construction (initial solution):
 *   - Initialize tracking of existing assignments
 *   - Process events chronologically (understudy slots before real roles)
 *   - For each unassigned role: find eligible members (hard constraints),
 *     score them (soft preferences, seeded tie-break), assign the best via the
 *     reversible move layer
 *
 * Phase 2 — Local search (optimization):
 *   - Hill-climb by applying the best improving move (member↔member swap or
 *     filling an empty slot) until no improving move exists, against the
 *     whole-roster objective in `evaluateState` (fairness, spread, day/role
 *     preferences, consecutive-weekend avoidance, empty slots). Every soft goal
 *     that biases Phase 1 must also appear here, or local search can undo it.
 *   - By DEFAULT (`optimizeExisting: false`) slots already filled when the run
 *     started are locked, so this phase can only rearrange the slots THIS run
 *     filled — generation is additive and never reshuffles prior assignments.
 *     Pass `optimizeExisting: true` (future algorithm-settings toggle) to let it
 *     re-optimize the whole roster.
 *
 * A fixed seed keeps output deterministic. Every meaningful decision is captured
 * by a verbose ActionLogger and returned as result.log / result.logEntries.
 *
 * Returns: { events, stats, fairnessMetrics, quality, log, logEntries }
 */

import { AssignmentTracker } from '../../state/assignmentTracker'
import { EligibilityChecker } from '../../evaluation/eligibilityChecker'
import { ScoringEngine, SCORING_WEIGHTS } from './scoringEngine'
import { RosterState } from '../../state/rosterState'
import { optimizeRoster } from './localSearch'
import { createRng } from './rng'
import { ActionLogger, NULL_LOGGER } from './actionLog'
import { seedUnderstudySlots } from './understudySeeding'
import { planPromotions, clearPromotionPins } from './promotionPlanning'
import { isUnderstudyRole } from '../understudy'
import { areConsecutiveWeekends } from '../../rules/constraintPrimitives'
import { CONSTRAINT_KEYS, PREFERENCE_KEYS, isConstraintEnabled, isPreferenceEnabled, isMemberIncluded } from '../../schema/rosterSchema'

/**
 * Main entry point.
 *
 * Single seeded greedy construction (Phase 1) followed by local-search
 * optimization (Phase 2). The seed keeps output deterministic; local search
 * does the quality optimization, so no multi-restart loop is needed.
 */
export function generateRoster(
  events,
  members,
  memberConstraints,
  memberPreferences,
  rosterConstraints,
  rosterPreferences,
  rosterPeriod,
  options = {}
) {
  const {
    logging = true,
    optimizeExisting = false,
    // Cross-team primitive (multi-tenant): a read-only snapshot of the
    // member's assignments in OTHER teams' rosters, consulted when the
    // cross-team constraints are enabled. Any "load" count is derived from this
    // (the same rollup the tracker uses locally), so it is the single primitive.
    // Default empty → single-team behaviour is byte-for-byte identical.
    // See specs/multi-tenant.md.
    externalAssignments = {},
  } = options
  const logger = new ActionLogger(logging)

  logger.info('Roster generation started', {
    events: events.length,
    members: members.filter(isMemberIncluded).length,
  })

  const result = runGeneration(
    events,
    members,
    memberConstraints,
    memberPreferences,
    rosterConstraints,
    rosterPreferences,
    rosterPeriod,
    { logger, optimizeExisting, externalAssignments }
  )

  // Restore chronological event order
  result.events.sort((a, b) => new Date(a.date) - new Date(b.date))

  const quality = calculateRosterQuality(result, memberPreferences, rosterPreferences)
  logger.success(`Generation complete (quality ${quality.toFixed(2)})`)

  result.quality = quality
  result.log = logger.toLines()
  result.logEntries = logger.entries
  return result
}

/**
 * The core generation algorithm: seeded greedy construction + local search.
 */
function runGeneration(
  events,
  members,
  memberConstraints,
  memberPreferences,
  rosterConstraints,
  rosterPreferences,
  rosterPeriod,
  options = {}
) {
  const {
    seed = 1,
    localSearch = true,
    optimizeExisting = false,
    logger = NULL_LOGGER,
    externalAssignments = {},
  } = options
  const rng = createRng(seed)

  // Initialize components
  const tracker = new AssignmentTracker(members, events, rosterPeriod)
  const eligibilityChecker = new EligibilityChecker(members, memberConstraints, rosterConstraints, tracker, { externalAssignments })
  const scoringEngine = new ScoringEngine(rosterPreferences, memberPreferences, tracker)
  
  // Clone events to avoid mutating original
  const newEvents = JSON.parse(JSON.stringify(events))
  
  // Sort events chronologically
  const sortedEvents = newEvents.sort((a, b) => new Date(a.date) - new Date(b.date))
  
  // The eligibility checker's clash constraint scans OTHER events for time
  // overlap; give it the live sorted array (mutated in place by RosterState) so
  // the scan reflects current assignments.
  eligibilityChecker.events = sortedEvents
  
  // Reversible state layer: all assignments go through applyMove so the tracker
  // and events stay in lock-step (and so the same primitives power local search).
  const state = new RosterState(sortedEvents, tracker)

  // Default behaviour: generation only FILLS EMPTY SLOTS — it must not reshuffle
  // assignments that already exist (including ones an earlier, still-uncommitted
  // generation produced). We tag every slot occupied at the start of this run as
  // `_preExisting` so `RosterState.isLocked` treats it as fixed and Phase 2 local
  // search leaves it alone. `optimizeExisting` (future algorithm-settings toggle)
  // opts back into whole-roster re-optimization. The tag is stripped before
  // returning so it never leaks into the roster data.
  if (!optimizeExisting) {
    sortedEvents.forEach(event => {
      event.roster?.forEach(roleAssignment => {
        if (roleAssignment.member_id) roleAssignment._preExisting = true
      })
    })
  }
  
  // Statistics tracking
  const stats = {
    totalRoles: 0,
    assignedRoles: 0,
    generatedAssignments: 0,
    unassignableRoles: []
  }

  // --- Phase 0: seed understudy shadowing slots ---
  // Proactively create "X-understudy" opportunities for trainees so the
  // ENFORCE_UNDERSTUDY_BEFORE_ROLE gate can later unlock the real role.
  if (isConstraintEnabled(rosterConstraints, CONSTRAINT_KEYS.ENFORCE_UNDERSTUDY_BEFORE_ROLE)) {
    const seeded = seedUnderstudySlots(sortedEvents, members, eligibilityChecker, tracker, { logger })
    if (seeded > 0) logger.info(`Phase 0 done: seeded ${seeded} understudy slot(s)`)

    // --- Phase 0.5: plan promotions (backtracking) ---
    // Secure real-role slots for as many unlocked trainees as possible up front,
    // before greedy spends their limited monthly budget on ordinary slots.
    const promoted = planPromotions(sortedEvents, members, eligibilityChecker, tracker, { logger })
    if (promoted > 0) logger.info(`Phase 0.5 done: planned ${promoted} promotion(s)`)
  }
  
  // --- Phase 1: greedy construction (initial solution) ---
  logger.debug('Phase 1: greedy construction')
  sortedEvents.forEach((event, eventIndex) => {
    if (!event.roster) return
    
    // Get current roster (what's already assigned in this event)
    const currentRoster = event.roster.filter(r => r.member_id)
    
    // Process each role in the event. Understudy ("X-understudy") slots are
    // processed BEFORE real slots so trainees get their shadow session locked
    // in first; their promotion into the real role is handled up front by the
    // Phase 0.5 promotion planner. Original slot indices are preserved so moves
    // target the correct roster entry.
    const orderedSlots = event.roster
      .map((roleAssignment, roleIndex) => ({ roleAssignment, roleIndex }))
      .sort((a, b) => {
        const au = isUnderstudyRole(a.roleAssignment.role) ? 0 : 1
        const bu = isUnderstudyRole(b.roleAssignment.role) ? 0 : 1
        return au - bu
      })

    orderedSlots.forEach(({ roleAssignment, roleIndex }) => {
      stats.totalRoles++
      
      // Skip if already assigned
      if (roleAssignment.member_id) {
        stats.assignedRoles++
        logger.debug(`${event.date} ${event.name} / ${roleAssignment.role}: pre-assigned`, { member: roleAssignment.member_id })
        return
      }
      
      const role = roleAssignment.role
      
      // Find eligible members for this role
      const eligibleMembers = eligibilityChecker.getEligibleMembers(role, event, currentRoster)
      
      if (eligibleMembers.length === 0) {
        // No eligible members found
        stats.unassignableRoles.push({
          event: event.name,
          date: event.date,
          role: role,
          reason: 'No eligible members available'
        })
        logger.warn(`${event.date} ${event.name} / ${role}: no eligible members`)
        return
      }
      
      // Score and rank eligible members (seeded shuffle breaks ties randomly
      // but reproducibly, so equally-ranked members aren't order-biased).
      const rankedMembers = scoringEngine.scoreAndRankMembers(rng.shuffle(eligibleMembers), role, event)
      
      // Assign the best-scored member via the reversible move layer
      const bestMember = rankedMembers[0]
      state.applyMove({ slot: { eventIndex, roleIndex }, memberId: bestMember.memberId })
      currentRoster.push(roleAssignment)
      
      logger.debug(
        `${event.date} ${event.name} / ${role}: assign ${bestMember.memberId}`,
        {
          score: Number(bestMember.totalScore.toFixed(1)),
          eligible: eligibleMembers.length,
          runnerUp: rankedMembers[1]
            ? { member: rankedMembers[1].memberId, score: Number(rankedMembers[1].totalScore.toFixed(1)) }
            : null,
        }
      )
      
      stats.assignedRoles++
      stats.generatedAssignments++
    })
  })
  logger.info(`Phase 1 done: ${stats.generatedAssignments} assigned, ${stats.unassignableRoles.length} unfilled`)
  
  // --- Phase 2: local search (swaps + fill-empty) over reversible moves ---
  // Hill-climb until no improving move exists (with a safety iteration cap).
  if (localSearch) {
    logger.debug('Phase 2: local search')
    const before = evaluateState(state, memberPreferences, rosterPreferences)
    const { iterations } = optimizeRoster(
      state,
      eligibilityChecker,
      (s) => evaluateState(s, memberPreferences, rosterPreferences),
      { logger }
    )
    const after = evaluateState(state, memberPreferences, rosterPreferences)
    recomputeStats(sortedEvents, stats)
    logger.info(
      `Phase 2 done: ${iterations} iteration(s), ` +
      `quality ${before.toFixed(1)} -> ${after.toFixed(1)} (Δ ${(after - before).toFixed(1)})`
    )
  }
  
  // Pins were only needed to protect planned promotions during local search.
  clearPromotionPins(sortedEvents)

  // Strip the transient `_preExisting` lock markers so they never leak into the
  // returned roster data (they exist only for this run's local-search locking).
  sortedEvents.forEach(event => {
    event.roster?.forEach(roleAssignment => {
      if (roleAssignment._preExisting) delete roleAssignment._preExisting
    })
  })

  return {
    events: newEvents,
    stats,
    fairnessMetrics: {
      assignmentStdDev: tracker.getFairnessScore(),
      spreadStdDev: tracker.getSpreadScore(),
      assignmentsByMember: tracker.memberAssignments
    }
  }
}

/**
 * Recompute assignment statistics after local search may have filled or moved
 * assignments. unassignableRoles keeps only slots that are still empty.
 */
function recomputeStats(events, stats) {
  let assigned = 0
  let generated = 0
  const unassignable = []
  events.forEach(event => {
    event.roster?.forEach(roleAssignment => {
      if (roleAssignment.member_id) {
        assigned++
        if (roleAssignment.isGenerated) generated++
      } else {
        unassignable.push({
          event: event.name,
          date: event.date,
          role: roleAssignment.role,
          reason: 'No eligible members available'
        })
      }
    })
  })
  stats.assignedRoles = assigned
  stats.generatedAssignments = generated
  stats.unassignableRoles = unassignable
}

/**
 * Compute the final reported roster quality score (higher is better).
 * Delegates to evaluateState against the finished result.
 */
function calculateRosterQuality(result, memberPreferences, rosterPreferences) {
  return evaluateState(
    { events: result.events, tracker: { getFairnessScore: () => result.fairnessMetrics.assignmentStdDev, getSpreadScore: () => result.fairnessMetrics.spreadStdDev } },
    memberPreferences,
    rosterPreferences
  )
}

/**
 * Roster quality objective (higher is better), computed directly from a
 * RosterState-like object ({ events, tracker }). Shared by the final quality
 * report (calculateRosterQuality) and the local-search loop so both optimize
 * the same objective.
 */
function evaluateState(state, memberPreferences, rosterPreferences) {
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


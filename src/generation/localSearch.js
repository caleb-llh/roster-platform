/**
 * Local-search optimizer.
 *
 * Given an already-constructed RosterState (produced by the greedy pass), this
 * hill-climbs by repeatedly applying the single best *improving* move until no
 * improving move exists (a local optimum) or a safety cap is reached.
 *
 * Move types:
 *   - fill:  place an eligible member into an empty slot
 *   - swap:  exchange the occupants of two filled slots
 *
 * Feasibility is validated through the shared EligibilityChecker against the
 * candidate state (moves are applied reversibly, checked, then kept or undone),
 * so hard constraints are never violated. The objective is supplied by the
 * caller (see calculateRosterQuality) — higher is better.
 */

export function optimizeRoster(state, eligibilityChecker, evaluate, options = {}) {
  const {
    maxIterations = 500,
    maxNoImprovement = 1, // hill-climbing: stop as soon as no move improves
    logger = null,
  } = options

  let currentScore = evaluate(state)
  let iterations = 0
  let noImprovement = 0

  while (iterations < maxIterations && noImprovement < maxNoImprovement) {
    iterations++
    const best = findBestMove(state, eligibilityChecker, evaluate, currentScore)

    if (!best) {
      noImprovement++
      if (logger) logger.debug(`local search: no improving move at iteration ${iterations} (local optimum)`)
      break
    }

    if (logger) logger.debug(`local search: apply ${describeMove(state, best.candidate)}`, {
      quality: `${currentScore.toFixed(1)} -> ${best.score.toFixed(1)}`,
      delta: Number((best.score - currentScore).toFixed(1)),
    })

    applyCandidate(state, best.candidate)
    currentScore = best.score
    noImprovement = 0
  }

  return { score: currentScore, iterations }
}

/** Human-readable description of a candidate move for logging. */
function describeMove(state, candidate) {
  if (candidate.type === 'fill') {
    const ev = state.events[candidate.slot.eventIndex]
    const role = state.getSlot(candidate.slot).role
    return `fill ${ev.date} ${ev.name}/${role} with ${candidate.memberId}`
  }
  const evA = state.events[candidate.slotA.eventIndex]
  const evB = state.events[candidate.slotB.eventIndex]
  return `swap ${state.getOccupant(candidate.slotA)}@${evA.date}/${state.getSlot(candidate.slotA).role} ` +
    `<-> ${state.getOccupant(candidate.slotB)}@${evB.date}/${state.getSlot(candidate.slotB).role}`
}

/**
 * Scan all candidate moves and return the one with the greatest positive delta,
 * or null if none improves the current score.
 */
function findBestMove(state, eligibilityChecker, evaluate, currentScore) {
  const slots = state.allSlots()
  let best = null

  // 1. Fill moves: an eligible member into an empty slot.
  for (const slot of slots) {
    if (state.getOccupant(slot)) continue

    for (const memberId of eligibleForSlot(state, eligibilityChecker, slot)) {
      const candidate = { type: 'fill', slot, memberId }
      const score = tryCandidate(state, candidate, evaluate)
      if (score > currentScore && (!best || score > best.score)) {
        best = { candidate, score }
      }
    }
  }

  // 2. Swap moves: exchange occupants of two filled slots. Pre-assigned
  // (manually authored) slots are locked and never moved or overwritten.
  const filled = slots.filter(s => state.getOccupant(s) && !state.isLocked(s))
  for (let i = 0; i < filled.length; i++) {
    for (let j = i + 1; j < filled.length; j++) {
      const slotA = filled[i]
      const slotB = filled[j]
      if (state.getOccupant(slotA) === state.getOccupant(slotB)) continue

      const candidate = { type: 'swap', slotA, slotB }
      if (!swapIsFeasible(state, eligibilityChecker, slotA, slotB)) continue

      const score = tryCandidate(state, candidate, evaluate)
      if (score > currentScore && (!best || score > best.score)) {
        best = { candidate, score }
      }
    }
  }

  return best
}

/** Members eligible to fill a given (empty) slot, given current state. */
function eligibleForSlot(state, eligibilityChecker, slot) {
  const event = state.events[slot.eventIndex]
  const role = state.getSlot(slot).role
  const currentRoster = event.roster.filter(r => r.member_id)
  return eligibilityChecker.getEligibleMembers(role, event, currentRoster)
}

/**
 * Check whether swapping the two occupants keeps both assignments legal.
 * Uses reversible removal so the tracker's weekly/monthly counts reflect each
 * member NOT being in its old slot while we test the new one.
 */
function swapIsFeasible(state, eligibilityChecker, slotA, slotB) {
  const memberA = state.getOccupant(slotA)
  const memberB = state.getOccupant(slotB)
  const eventA = state.events[slotA.eventIndex]
  const eventB = state.events[slotB.eventIndex]
  const roleA = state.getSlot(slotA).role
  const roleB = state.getSlot(slotB).role

  // Temporarily vacate both slots so counts don't include the moving members.
  const invA = state.applyMove({ slot: slotA, memberId: null })
  const invB = state.applyMove({ slot: slotB, memberId: null })

  const rosterA = eventA.roster.filter(r => r.member_id)
  const rosterB = eventB.roster.filter(r => r.member_id)
  const bIntoA = eligibilityChecker.isEligible(memberB, roleA, eventA, rosterA).eligible
  const aIntoB = eligibilityChecker.isEligible(memberA, roleB, eventB, rosterB).eligible

  // Restore original occupants.
  state.revertMove(invB)
  state.revertMove(invA)

  return bIntoA && aIntoB
}

/** Apply a candidate, evaluate, then revert. Returns the resulting score. */
function tryCandidate(state, candidate, evaluate) {
  const inverse = applyCandidate(state, candidate)
  const score = evaluate(state)
  revertCandidate(state, candidate, inverse)
  return score
}

function applyCandidate(state, candidate) {
  if (candidate.type === 'fill') {
    return state.applyMove({ slot: candidate.slot, memberId: candidate.memberId })
  }
  return state.applySwap(candidate.slotA, candidate.slotB)
}

function revertCandidate(state, candidate, inverse) {
  if (candidate.type === 'fill') {
    state.revertMove(inverse)
  } else {
    state.revertSwap(inverse)
  }
}

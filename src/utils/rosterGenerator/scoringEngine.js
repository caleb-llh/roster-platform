/**
 * Scores eligible members for a role/event by delegating to the pluggable
 * scorer registry (see scorers.js). This class is a thin adapter that assembles
 * the scoring context and ranks candidates; all scoring logic and weights live
 * in scorers.js so they can be shared with the roster-quality evaluation.
 */

import { SCORING_WEIGHTS, scoreCandidate } from '../../rules/scorers'

export { SCORING_WEIGHTS }

export class ScoringEngine {
  constructor(rosterPreferences, memberPreferences, tracker) {
    this.rosterPreferences = rosterPreferences
    this.memberPreferences = memberPreferences
    this.tracker = tracker
    this.weights = SCORING_WEIGHTS
  }

  /**
   * Score a member for assignment to a role on an event.
   * Higher score = better choice.
   */
  scoreMember(memberId, role, event) {
    const ctx = {
      tracker: this.tracker,
      memberPreferences: this.memberPreferences,
      rosterPreferences: this.rosterPreferences,
      event,
      candidate: { memberId, role },
    }

    const { totalScore, breakdown } = scoreCandidate(ctx)
    return { memberId, totalScore, breakdown }
  }

  /**
   * Score all eligible members and return sorted by score (highest first)
   */
  scoreAndRankMembers(eligibleMemberIds, role, event) {
    const scoredMembers = eligibleMemberIds.map(memberId =>
      this.scoreMember(memberId, role, event)
    )

    return scoredMembers.sort((a, b) => b.totalScore - a.totalScore)
  }
}

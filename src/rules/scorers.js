/**
 * Pluggable scoring registry.
 *
 * Each scorer is a self-contained descriptor:
 *   {
 *     key:      unique identifier (also the weight key in SCORING_WEIGHTS)
 *     weight:   base weight (looked up from SCORING_WEIGHTS)
 *     factor:   optional extra multiplier applied on top of weight
 *     enabled:  (ctx) => boolean   // whether this scorer applies at all
 *     score:    (ctx, candidate) => number in [0, 1]  // higher = better
 *   }
 *
 * Adding a new scoring dimension = appending one entry here. The engine and the
 * roster-quality evaluation both consume this single list, so they can never
 * drift apart.
 *
 * `ctx` (scoring context) provides everything a scorer needs without coupling
 * it to the engine internals:
 *   { tracker, memberPreferences, rosterPreferences, event }
 * `candidate` is { memberId, role }.
 */

import { PREFERENCE_KEYS, isPreferenceEnabled } from '../schema/rosterSchema'
import { areConsecutiveWeekends } from './constraintPrimitives'
import { defineScorer } from './defineRule'

/**
 * Single source of truth for scoring weights.
 * Reused by the per-candidate ScoringEngine and by the roster-quality
 * evaluation in index.js.
 */
export const SCORING_WEIGHTS = {
  fairness: 300,              // Highest priority: balance workload
  consecutiveWeekends: 200,   // Avoid consecutive weekends
  dayPreference: 120,         // Member day preferences (member-level overrides roster-level)
  rolePreference: 120,        // Member role preferences (member-level preference)
  roleDiversity: 60,          // Encourage role diversity
  spread: 60,                 // Spread assignments over time
  dayBalance: 60,             // Balance assignments across different days of week
}

const always = () => true

/**
 * The scorer registry. Order is irrelevant to the total (contributions are
 * summed) but is kept readable / grouped by priority.
 */
export const SCORERS = [
  defineScorer({
    key: 'fairness',
    // Historically fairness carried an extra 10x emphasis over its base weight.
    factor: 10,
    enabled: always,
    score: (ctx) => fairnessScore(ctx.tracker, ctx.candidate.memberId),
  }),
  defineScorer({
    key: 'spread',
    enabled: (ctx) => isPreferenceEnabled(ctx.rosterPreferences, PREFERENCE_KEYS.SPREAD_ASSIGNMENTS),
    score: (ctx) => spreadScore(ctx.tracker, ctx.candidate.memberId, ctx.event.date),
  }),
  defineScorer({
    key: 'dayPreference',
    enabled: always,
    score: (ctx) => dayPreferenceScore(ctx.memberPreferences, ctx.candidate.memberId, ctx.event.day_of_week),
  }),
  defineScorer({
    key: 'rolePreference',
    enabled: always,
    score: (ctx) => rolePreferenceScore(ctx.memberPreferences, ctx.candidate.memberId, ctx.candidate.role),
  }),
  defineScorer({
    key: 'dayBalance',
    enabled: (ctx) => isPreferenceEnabled(ctx.rosterPreferences, PREFERENCE_KEYS.BALANCED_DAY_DISTRIBUTION),
    score: (ctx) => dayBalanceScore(ctx.tracker, ctx.candidate.memberId, ctx.event.day_of_week),
  }),
  defineScorer({
    key: 'consecutiveWeekends',
    enabled: (ctx) => isPreferenceEnabled(ctx.rosterPreferences, PREFERENCE_KEYS.AVOID_CONSECUTIVE_WEEKS),
    score: (ctx) => consecutiveWeekendScore(ctx.tracker, ctx.candidate.memberId, ctx.event.date, ctx.event.day_of_week),
  }),
  defineScorer({
    key: 'roleDiversity',
    enabled: (ctx) => isPreferenceEnabled(ctx.rosterPreferences, PREFERENCE_KEYS.DIVERSIFY_ROLE_ASSIGNMENTS),
    score: (ctx) => roleDiversityScore(ctx.tracker, ctx.candidate.memberId, ctx.candidate.role),
  }),
]

/**
 * Score a single candidate against the whole registry.
 * Returns { totalScore, breakdown } identical in shape to the previous engine.
 */
export function scoreCandidate(ctx) {
  let totalScore = 0
  const breakdown = {}

  for (const scorer of SCORERS) {
    if (!scorer.enabled(ctx)) continue
    const raw = scorer.score(ctx)
    const weight = SCORING_WEIGHTS[scorer.key] * (scorer.factor || 1)
    breakdown[scorer.key] = raw
    totalScore += raw * weight
  }

  return { totalScore, breakdown }
}

// ---------------------------------------------------------------------------
// Individual scoring functions (pure, no engine state)
// ---------------------------------------------------------------------------

function fairnessScore(tracker, memberId) {
  const assignmentCount = tracker.getAssignmentCount(memberId)
  const allCounts = Object.keys(tracker.memberAssignments)
    .map(id => tracker.getAssignmentCount(id))

  const minCount = Math.min(...allCounts)
  const maxCount = Math.max(...allCounts)

  // Members with fewer assignments get higher scores
  if (maxCount === minCount) return 1.0
  return 1.0 - ((assignmentCount - minCount) / (maxCount - minCount))
}

function spreadScore(tracker, memberId, eventDate) {
  const lastDate = tracker.getLastAssignmentDate(memberId)
  if (!lastDate) return 1.0 // No previous assignment, perfect spread

  const daysSinceLastAssignment = Math.ceil(
    (new Date(eventDate) - new Date(lastDate)) / (1000 * 60 * 60 * 24)
  )

  // Prefer longer gaps (normalized to 0-1, with 14+ days = 1.0)
  return Math.min(daysSinceLastAssignment / 14, 1.0)
}

function dayPreferenceScore(memberPreferences, memberId, dayOfWeek) {
  const memberPref = memberPreferences.find(p => p.member_id === memberId)
  if (!memberPref || !memberPref.days || memberPref.days.length === 0) {
    return 0.5 // Neutral if no preference
  }
  return memberPref.days.includes(dayOfWeek) ? 1.0 : 0.0
}

function rolePreferenceScore(memberPreferences, memberId, role) {
  const memberPref = memberPreferences.find(p => p.member_id === memberId)
  if (!memberPref || !memberPref.roles || memberPref.roles.length === 0) {
    return 0.5 // Neutral if no role preference
  }
  return memberPref.roles.includes(role) ? 1.0 : 0.0
}

function dayBalanceScore(tracker, memberId, dayOfWeek) {
  const dayCounts = tracker.memberAssignments[memberId]?.byDay || {}
  const currentDayCount = dayCounts[dayOfWeek] || 0

  const allDayCounts = Object.values(dayCounts)
  if (allDayCounts.length === 0) return 1.0

  const minCount = Math.min(...allDayCounts, 0)
  const maxCount = Math.max(...allDayCounts)

  // Prefer days with fewer assignments for this member
  if (maxCount === minCount) return 1.0
  return 1.0 - ((currentDayCount - minCount) / (maxCount - minCount + 1))
}

function consecutiveWeekendScore(tracker, memberId, eventDate, dayOfWeek) {
  if (dayOfWeek !== 'Saturday' && dayOfWeek !== 'Sunday') {
    return 1.0 // Not a weekend, no penalty
  }

  const lastDate = tracker.getLastAssignmentDate(memberId)
  if (!lastDate) return 1.0

  // Penalize if the last assignment fell on the immediately preceding weekend
  return areConsecutiveWeekends(lastDate, eventDate) ? 0.0 : 1.0
}

function roleDiversityScore(tracker, memberId, role) {
  const roleCount = tracker.getRoleAssignmentCount(memberId, role)

  const allRoleCounts = Object.values(tracker.memberRoleAssignments[memberId] || {})
  if (allRoleCounts.length === 0) return 1.0

  const minCount = Math.min(...allRoleCounts, 0)
  const maxCount = Math.max(...allRoleCounts)

  // Prefer roles this member hasn't done as much
  if (maxCount === minCount) return 1.0
  return 1.0 - ((roleCount - minCount) / (maxCount - minCount + 1))
}

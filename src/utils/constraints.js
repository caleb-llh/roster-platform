/**
 * Hard-constraint registry — one authority, many consumers.
 *
 * Each constraint is a single descriptor; the generator (EligibilityChecker),
 * the validator (assignmentValidator), manual swap/self-assign (explainSwap),
 * and the assignment dropdown are *consumers* of this one list rather than
 * re-owners of the rules. See the "Hard constraints: one authority, many
 * consumers" decision in specs/generation.md for the rationale and shape.
 *
 * Descriptor shape:
 *   {
 *     key,                        // stable id (also the violation code owner)
 *     kind,                       // 'feasibility' | 'load-cadence'
 *     enabled(ctx),               // reads the rosterConstraints flag
 *     check(placement, ctx, mode) // => violation | null
 *   }
 *
 * - `kind: 'feasibility'` — physically impossible to violate (availability, role,
 *   active, same-time clash, once-per-event). Enforced by ALL consumers,
 *   including manual swaps.
 * - `kind: 'load-cadence'` — policy caps a human may deliberately override
 *   (week/month, understudy gate). Enforced by generator + validator, NOT swaps.
 *
 * `mode ∈ { 'would-place', 'is-placed' }` — the SAME rule answers two questions:
 *   - 'would-place' (generator/swap, predictive): may I place M here? For a
 *     counting rule this is `count >= cap` ("would reach the cap").
 *   - 'is-placed'  (validator, diagnostic): is this already-placed assignment
 *     violating the rule? For a counting rule this is `count > cap`.
 *   Feasibility rules ignore `mode` (unavailable is unavailable whenever asked).
 *
 * A violation is STRUCTURED — `{ code, params }` — never a formatted sentence.
 * Each consumer renders its own wording via `formatViolation` (or its own map),
 * so the toast, the validator line, and the log can differ and stay i18n-ready.
 */

import { isMemberAvailable } from './constraintPrimitives'
import { CONSTRAINT_KEYS, isConstraintEnabled, getConstraintValue } from '../schema/rosterSchema'
import { isUnderstudyRole, baseRoleOf, UNDERSTUDY_MIN_SESSIONS } from './understudy'

export const CONSTRAINT_MODES = {
  WOULD_PLACE: 'would-place',
  IS_PLACED: 'is-placed',
}

/**
 * A `placement` is the subject of a check: a member landing (or already sitting)
 * in a slot of an event.
 *   { memberId, role, event }   // event carries `date` (and later start/end)
 *
 * The `ctx` is the consumer's environment. Feasibility rules read intrinsic
 * facts off it (`memberConstraints`, `members`). Load-cadence rules need COUNTS,
 * which each consumer computes differently — the generator from its stateful
 * tracker, the validator from a whole-roster scan of `allEvents`. To keep the
 * rule defined once, the descriptor calls a small uniform counting interface the
 * consumer supplies on `ctx`; only the plumbing differs, never the rule:
 *   ctx.currentRoster(placement)              -> slot[] of the event being filled
 *   ctx.weeklyCount(memberId, date)           -> assignments in that week
 *   ctx.monthlyCount(memberId, date)          -> assignments in that month
 *   ctx.priorUnderstudySessions(memberId, baseRole, date) -> understudy sessions
 *                                                            strictly before date
 *   ctx.overlappingEvents(placement)          -> OTHER events whose time span
 *                                                overlaps the placement's event
 *                                                (excludes that event itself)
 * In 'would-place' mode the counts EXCLUDE the placement being considered (it is
 * not yet recorded); in 'is-placed' mode they INCLUDE it (it is already in the
 * roster). That is exactly why the comparison is `count >= cap` (would-place)
 * vs `count > cap` (is-placed) — same cap, one extra already-counted self.
 */

export const CONSTRAINTS = [
  {
    key: 'availability',
    kind: 'feasibility',
    enabled: (ctx) => isConstraintEnabled(ctx.rosterConstraints, CONSTRAINT_KEYS.ENFORCE_MEMBER_AVAILABILITY),
    // Availability is intrinsic to (member, date): mode is irrelevant.
    check: (placement, ctx) => {
      if (isMemberAvailable(placement.memberId, placement.event.date, ctx.memberConstraints)) {
        return null
      }
      return { code: 'unavailable', params: { memberId: placement.memberId, date: placement.event.date } }
    },
  },
  {
    key: 'once-per-event',
    kind: 'feasibility',
    enabled: (ctx) => isConstraintEnabled(ctx.rosterConstraints, CONSTRAINT_KEYS.ONLY_ONCE_PER_EVENT),
    // A member may hold at most one slot in a single event. Mode is irrelevant:
    // whether we are about to place or checking a placed roster, the question is
    // "is this member in another slot of this event?" — the consumer's
    // currentRoster excludes the slot being filled (would-place) or is the whole
    // roster minus self-by-identity (is-placed handled by the validator's own
    // duplicate scan), so a single presence check answers both.
    check: (placement, ctx) => {
      const roster = ctx.currentRoster(placement)
      if (roster.some(s => s.member_id === placement.memberId)) {
        return { code: 'once-per-event', params: { memberId: placement.memberId, date: placement.event.date } }
      }
      return null
    },
  },
  {
    key: 'no-clash',
    kind: 'feasibility',
    enabled: (ctx) => isConstraintEnabled(ctx.rosterConstraints, CONSTRAINT_KEYS.ENFORCE_NO_CLASH),
    // A member cannot be in two events whose time spans overlap. once-per-event
    // already covers duplicates WITHIN one event; this covers the ACROSS-event
    // case using the half-open interval rule (a bare-date event is a whole day,
    // so two same-day events clash exactly as the old one-event-per-day model
    // assumed). Time span, not date-equality, is the rule — see
    // eventInterval/eventsClash in constraintPrimitives. Mode is irrelevant: the
    // consumer's overlappingEvents excludes the placement's own event, so the
    // question "is this member in ANOTHER overlapping event?" is the same whether
    // predicting a placement or diagnosing one.
    check: (placement, ctx) => {
      const clashers = ctx.overlappingEvents(placement)
      for (const other of clashers) {
        if (other.roster?.some(s => s.member_id === placement.memberId)) {
          return {
            code: 'clash',
            params: {
              memberId: placement.memberId,
              date: placement.event.date,
              otherDate: other.date,
              // A synthetic other-team event is marked _external so consumers can
              // word it as a cross-team clash. Local overlaps leave this falsy.
              external: !!other._external,
            },
          }
        }
      }
      return null
    },
  },
  {
    key: 'once-per-week',
    kind: 'load-cadence',
    enabled: (ctx) => isConstraintEnabled(ctx.rosterConstraints, CONSTRAINT_KEYS.ONLY_ONCE_PER_WEEK),
    // Cap of 1 per week. would-place: any prior assignment (>= 1) blocks;
    // is-placed: more than one in the week (> 1) is a violation.
    check: (placement, ctx, mode) => {
      const count = ctx.weeklyCount(placement.memberId, placement.event.date)
      const cap = 1
      const over = mode === CONSTRAINT_MODES.IS_PLACED ? count > cap : count >= cap
      if (over) {
        return { code: 'once-per-week', params: { memberId: placement.memberId, date: placement.event.date } }
      }
      return null
    },
  },
  {
    key: 'max-per-month',
    kind: 'load-cadence',
    enabled: (ctx) => isConstraintEnabled(ctx.rosterConstraints, CONSTRAINT_KEYS.MAX_ASSIGNMENTS_PER_MONTH),
    check: (placement, ctx, mode) => {
      const cap = getConstraintValue(ctx.rosterConstraints, CONSTRAINT_KEYS.MAX_ASSIGNMENTS_PER_MONTH)
      const count = ctx.monthlyCount(placement.memberId, placement.event.date)
      const over = mode === CONSTRAINT_MODES.IS_PLACED ? count > cap : count >= cap
      if (over) {
        return { code: 'max-per-month', params: { memberId: placement.memberId, date: placement.event.date, count, cap } }
      }
      return null
    },
  },
  {
    key: 'understudy-before-role',
    kind: 'load-cadence',
    enabled: (ctx) => isConstraintEnabled(ctx.rosterConstraints, CONSTRAINT_KEYS.ENFORCE_UNDERSTUDY_BEFORE_ROLE),
    // Two-sided gate for a trainee of base role X:
    //  - placing into the REAL role X requires >= MIN prior understudy sessions.
    //  - placing into the UNDERSTUDY slot for X once already qualified is blocked
    //    (they should perform the real role, not understudy again).
    // The validator only diagnoses the first side (it flags a trainee sitting in
    // a real role too early); the second side is a generator-only placement guard
    // (there is no "over-understudied" defect to report on a finished roster), so
    // it is expressed as a would-place-only branch.
    check: (placement, ctx, mode) => {
      const { memberId, role, event } = placement
      const member = (ctx.members || []).find(m => m.id === memberId)
      if (!member) return null
      const understudyFor = member.understudyFor || []

      if (isUnderstudyRole(role)) {
        if (mode === CONSTRAINT_MODES.IS_PLACED) return null // generator-only guard
        const baseRole = baseRoleOf(role)
        if (understudyFor.includes(baseRole)) {
          const prior = ctx.priorUnderstudySessions(memberId, baseRole, event.date)
          if (prior >= UNDERSTUDY_MIN_SESSIONS) {
            return { code: 'understudy-complete', params: { memberId, role: baseRole, minSessions: UNDERSTUDY_MIN_SESSIONS } }
          }
        }
        return null
      }

      // Real role: a trainee for it must have understudied enough first.
      const fullyPerforms = (member.roles || []).includes(role)
      if (fullyPerforms || !understudyFor.includes(role)) return null
      const prior = ctx.priorUnderstudySessions(memberId, role, event.date)
      if (prior < UNDERSTUDY_MIN_SESSIONS) {
        return { code: 'understudy-before-role', params: { memberId, role, minSessions: UNDERSTUDY_MIN_SESSIONS } }
      }
      return null
    },
  },
]

const CONSTRAINTS_BY_KEY = Object.fromEntries(CONSTRAINTS.map(c => [c.key, c]))

/**
 * Run the enabled constraints against a placement.
 *
 * @param {object} placement - { memberId, role, event }
 * @param {object} ctx - { rosterConstraints, memberConstraints, ... }
 * @param {object} [opts]
 * @param {'would-place'|'is-placed'} [opts.mode] - the question being asked.
 * @param {'feasibility'|'load-cadence'} [opts.kind] - restrict to one kind
 *   (swaps pass 'feasibility').
 * @param {boolean} [opts.all] - collect every violation (validator) instead of
 *   short-circuiting at the first (generator/swap).
 * @returns {object[]} violations (empty = allowed). Short-circuit mode returns
 *   at most one.
 */
export function checkConstraints(placement, ctx, opts = {}) {
  const { mode = CONSTRAINT_MODES.WOULD_PLACE, kind, all = false } = opts
  const violations = []
  for (const constraint of CONSTRAINTS) {
    if (kind && constraint.kind !== kind) continue
    if (!constraint.enabled(ctx)) continue
    const violation = constraint.check(placement, ctx, mode)
    if (violation) {
      violations.push(violation)
      if (!all) break
    }
  }
  return violations
}

/** Look up a single descriptor by key (for consumers migrating rule-by-rule). */
export function getConstraint(key) {
  return CONSTRAINTS_BY_KEY[key]
}

/**
 * Default human-readable formatter for a structured violation. Consumers may use
 * this or supply their own wording; the code+params are the stable contract.
 *
 * @param {object} violation - { code, params }
 * @param {(memberId: string) => string} [nameOf] - resolve a member id to a name.
 */
export function formatViolation(violation, nameOf = (id) => id) {
  if (!violation) return null
  const { code, params = {} } = violation
  const name = params.memberId != null ? nameOf(params.memberId) : undefined
  switch (code) {
    case 'unavailable':
      return `${name} is unavailable on ${params.date}.`
    case 'once-per-event':
      return `${name} is already rostered on ${params.date}.`
    case 'clash':
      return `${name} is already rostered on an overlapping event (${params.otherDate}).`
    case 'once-per-week':
      return `${name} is already rostered that week.`
    case 'max-per-month':
      return `${name} has reached the monthly cap (${params.cap}).`
    case 'understudy-before-role':
      return `${name} must understudy ${params.role} ${params.minSessions}× before performing it.`
    case 'understudy-complete':
      return `${name} has completed understudy for ${params.role} and should perform the role.`
    default:
      return 'Assignment violates a roster constraint.'
  }
}

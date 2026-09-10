/**
 * Descriptor factories for the rule registries.
 *
 * The domain has two registries that live side by side in `rules/`:
 *   - CONSTRAINTS — what is *legal* (hard rules, `check` returns a violation or null)
 *   - SCORERS     — what is *good*  (soft rules, `score` returns a number in [0, 1])
 *
 * `defineRule` / `defineScorer` are thin, explicit constructors for those
 * descriptors. They do two things and nothing more:
 *   1. Make the required shape of each descriptor self-documenting at the call
 *      site (so a new rule is written by copying a known form, not by guessing).
 *   2. Fail loud at module-load time if a descriptor is missing a required
 *      field, instead of failing deep inside the generator with an opaque
 *      "undefined is not a function".
 *
 * They deliberately do NOT wrap, memoise, or transform the descriptor — a rule
 * is still a plain object, consumers read `.check` / `.score` directly, and the
 * registries stay ordinary arrays. This is the "shape, not machinery" line the
 * overhaul draws: no rule DSL, no engine indirection.
 */

function requireFields(descriptor, fields, label) {
  for (const field of fields) {
    if (descriptor[field] == null) {
      throw new Error(`${label} "${descriptor.key ?? '(no key)'}" is missing required field "${field}"`)
    }
  }
}

/**
 * A hard rule (legality). Shape:
 *   { key, kind, enabled, check }
 *     key:     unique identifier
 *     kind:    'feasibility' | 'load-cadence' (grouping only)
 *     enabled: (ctx) => boolean
 *     check:   (placement, ctx) => violation | null
 */
export function defineRule(descriptor) {
  requireFields(descriptor, ['key', 'kind', 'enabled', 'check'], 'constraint')
  return descriptor
}

/**
 * A soft rule (quality). Shape:
 *   { key, factor?, enabled, score }
 *     key:     unique identifier (also the weight key in SCORING_WEIGHTS)
 *     factor:  optional extra multiplier applied on top of the weight
 *     enabled: (ctx) => boolean
 *     score:   (ctx) => number in [0, 1]  // higher = better
 */
export function defineScorer(descriptor) {
  requireFields(descriptor, ['key', 'enabled', 'score'], 'scorer')
  return descriptor
}

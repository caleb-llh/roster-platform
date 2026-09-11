/**
 * Source-code defaults for roster-level constraints and preferences.
 *
 * These are POLICY, not data: they rarely change, are owned by the app (not by
 * end users), and are the same across rosters. Keeping them here — rather than
 * requiring every YAML document to spell them out — removes a class of user
 * error and lets production build rosters without carrying this config.
 *
 * Precedence: a roster document may still OVERRIDE any of these by providing
 * `roster_constraints` / `roster_preferences` keys (see toState, which
 * merges the document over these defaults). Absent config falls back to the
 * intended defaults below rather than to "everything disabled".
 *
 * NOTE: roles are intentionally NOT defined here. Roles belong to a team (data),
 * not to app policy.
 */

import { CONSTRAINT_KEYS, PREFERENCE_KEYS } from '../schema/rosterSchema'

/** @type {Readonly<Record<string, boolean|number>>} */
export const DEFAULT_ROSTER_CONSTRAINTS = Object.freeze({
  [CONSTRAINT_KEYS.ENFORCE_MEMBER_ROLES]: true,
  [CONSTRAINT_KEYS.ENFORCE_MEMBER_AVAILABILITY]: true,
  [CONSTRAINT_KEYS.ONLY_ONCE_PER_EVENT]: true,
  [CONSTRAINT_KEYS.ENFORCE_NO_CLASH]: true,
  [CONSTRAINT_KEYS.ONLY_ONCE_PER_WEEK]: true,
  [CONSTRAINT_KEYS.MAX_ASSIGNMENTS_PER_MONTH]: 2,
  [CONSTRAINT_KEYS.ENFORCE_UNDERSTUDY_BEFORE_ROLE]: true,
})

/** @type {Readonly<Record<string, boolean>>} */
export const DEFAULT_ROSTER_PREFERENCES = Object.freeze({
  [PREFERENCE_KEYS.AVOID_CONSECUTIVE_WEEKS]: true,
  [PREFERENCE_KEYS.BALANCED_DAY_DISTRIBUTION]: true,
  [PREFERENCE_KEYS.SPREAD_ASSIGNMENTS]: true,
  [PREFERENCE_KEYS.DIVERSIFY_ROLE_ASSIGNMENTS]: true,
})

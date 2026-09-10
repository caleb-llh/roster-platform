/**
 * Understudy role *vocabulary* — the definitional half of the understudy feature.
 *
 * These are facts about how understudy roles are *named and shaped*, not
 * judgements about what is allowed. They belong in the Schema layer: pure
 * vocabulary with zero dependencies, which is why so many layers may import
 * them without creating cross-layer coupling. The togglable judgements and
 * thresholds (the promotion gate) live in `rules/understudyPolicy.js`.
 *
 * An "understudy" is a member who is TRAINING for a role but not yet a full
 * performer of it. A member declares this in YAML by flagging a role entry with
 * `understudy: true`, e.g.
 *
 *   roles:
 *     - name: multi-vm
 *       understudy: true    # training for multi-vm
 *     - vm                  # plain string = full role, still supported
 *
 * Slots that a trainee can fill use a suffix convention: the understudy slot for
 * role `X` is `"${X}-understudy"`. These slot roles do NOT need to be predeclared
 * in the top-level `roles` catalog (the catalog auto-expands to include them).
 *
 * See specs/understudy.md for the feature's rules.
 */

/** Suffix that marks an understudy slot role. */
export const UNDERSTUDY_SUFFIX = '-understudy'

/** The understudy slot role for a base role, e.g. "multi-vm" -> "multi-vm-understudy". */
export function understudySlotRole(baseRole) {
  return `${baseRole}${UNDERSTUDY_SUFFIX}`
}

/** True if a role string names an understudy slot. */
export function isUnderstudyRole(role) {
  return typeof role === 'string' && role.endsWith(UNDERSTUDY_SUFFIX)
}

/**
 * The base role for an understudy slot role, e.g. "multi-vm-understudy" ->
 * "multi-vm". Returns null if the given role is not an understudy role.
 */
export function baseRoleOf(role) {
  if (!isUnderstudyRole(role)) return null
  return role.slice(0, -UNDERSTUDY_SUFFIX.length)
}

/**
 * Normalize a member's raw `roles` array (mix of strings and
 * `{ name, understudy? }` objects) into a canonical shape:
 *
 *   {
 *     roles: string[],          // roles the member can FULLY perform now
 *     understudyFor: string[],  // roles the member is TRAINING for
 *   }
 *
 * An understudy-flagged role is excluded from `roles` (they can't perform it
 * yet) but recorded in `understudyFor`. A role appearing both as a plain string
 * and an understudy entry is treated as a full role (full capability wins).
 */
export function normalizeMemberRoles(rawRoles) {
  const roles = []
  const understudyFor = []

  if (Array.isArray(rawRoles)) {
    for (const entry of rawRoles) {
      if (typeof entry === 'string') {
        roles.push(entry)
      } else if (entry && typeof entry === 'object' && entry.name) {
        if (entry.understudy === true) understudyFor.push(entry.name)
        else roles.push(entry.name)
      }
    }
  }

  // Full capability wins over understudy for the same role.
  const fullSet = new Set(roles)
  const understudyOnly = understudyFor.filter(r => !fullSet.has(r))

  return {
    roles: [...new Set(roles)],
    understudyFor: [...new Set(understudyOnly)],
  }
}

/**
 * Centralized schema for roster configuration
 * Single source of truth for all YAML field names, constraints, preferences, and their metadata
 */

// ============================================================================
// YAML Field Paths
// ============================================================================

export const YAML_FIELDS = {
  MEMBERS: 'members',
  EVENTS: 'events',
  ROLES: 'roles',
  ROSTER_PERIOD: 'roster',  // Note: 'roster' in YAML contains start_date/end_date
  ROSTER_CONSTRAINTS: 'roster_constraints',
  ROSTER_PREFERENCES: 'roster_preferences',
  MEMBER_PREFERENCES: 'member_preferences',
  MEMBER_CONSTRAINTS: 'member_constraints',
}

// ============================================================================
// Roster Constraints (Hard Rules)
// ============================================================================

export const CONSTRAINT_KEYS = {
  ENFORCE_MEMBER_ROLES: 'ENFORCE_MEMBER_ROLES',
  ENFORCE_MEMBER_AVAILABILITY: 'ENFORCE_MEMBER_AVAILABILITY',
  ONLY_ONCE_PER_EVENT: 'ONLY_ONCE_PER_EVENT',
  ENFORCE_NO_CLASH: 'ENFORCE_NO_CLASH',
  ONLY_ONCE_PER_WEEK: 'ONLY_ONCE_PER_WEEK',
  MAX_ASSIGNMENTS_PER_MONTH: 'MAX_ASSIGNMENTS_PER_MONTH',
  ENFORCE_UNDERSTUDY_BEFORE_ROLE: 'ENFORCE_UNDERSTUDY_BEFORE_ROLE',
  // Cross-team (multi-tenant Phase 2). Both OFF by default so single-team
  // rosters are byte-for-byte unaffected — they only ever consult the
  // read-only externalAssignments snapshot when explicitly enabled, and that
  // snapshot is empty in single-team mode. See specs/multi-tenant.md.
  ENFORCE_CROSS_TEAM_CAPS: 'ENFORCE_CROSS_TEAM_CAPS',
  // Hard, BLOCKING rule (not a warning): a member cannot be scheduled on two
  // teams for overlapping events. Named ENFORCE_* to match its enforcement
  // class (feasibility), alongside ENFORCE_NO_CLASH.
  ENFORCE_CROSS_TEAM_CLASH: 'ENFORCE_CROSS_TEAM_CLASH',
}

// Coercion functions per constraint value. Return the coerced value, or null
// if the value is missing/invalid.
const coerceBoolean = (value) => (typeof value === 'boolean' ? value : null)
const coerceNonNegativeInt = (value) => {
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : null
}

const constraintCoercers = {
  [CONSTRAINT_KEYS.ENFORCE_MEMBER_ROLES]: coerceBoolean,
  [CONSTRAINT_KEYS.ENFORCE_MEMBER_AVAILABILITY]: coerceBoolean,
  [CONSTRAINT_KEYS.ONLY_ONCE_PER_EVENT]: coerceBoolean,
  [CONSTRAINT_KEYS.ENFORCE_NO_CLASH]: coerceBoolean,
  [CONSTRAINT_KEYS.ONLY_ONCE_PER_WEEK]: coerceBoolean,
  [CONSTRAINT_KEYS.MAX_ASSIGNMENTS_PER_MONTH]: coerceNonNegativeInt,
  [CONSTRAINT_KEYS.ENFORCE_UNDERSTUDY_BEFORE_ROLE]: coerceBoolean,
  [CONSTRAINT_KEYS.ENFORCE_CROSS_TEAM_CAPS]: coerceBoolean,
  [CONSTRAINT_KEYS.ENFORCE_CROSS_TEAM_CLASH]: coerceBoolean,
}

export const CONSTRAINT_METADATA = {
  [CONSTRAINT_KEYS.ENFORCE_MEMBER_ROLES]: {
    label: 'Enforce Member Roles',
    description: 'Members can only be assigned to roles they are qualified for',
    userFriendly: 'Members can only be assigned to roles they are qualified for',
    type: 'boolean',
  },
  [CONSTRAINT_KEYS.ENFORCE_MEMBER_AVAILABILITY]: {
    label: 'Enforce Member Availability',
    description: 'Members are only assigned when they are available',
    userFriendly: 'Members are only assigned when they are available',
    type: 'boolean',
  },
  [CONSTRAINT_KEYS.ONLY_ONCE_PER_EVENT]: {
    label: 'Only Once Per Event',
    description: 'A member cannot be assigned to multiple roles in the same event',
    userFriendly: 'No one gets assigned to multiple roles in the same event',
    type: 'boolean',
  },
  [CONSTRAINT_KEYS.ENFORCE_NO_CLASH]: {
    label: 'No Overlapping Events',
    description: 'A member cannot be assigned to two events whose times overlap',
    userFriendly: "A member can't be in two events that overlap in time",
    type: 'boolean',
  },
  [CONSTRAINT_KEYS.ONLY_ONCE_PER_WEEK]: {
    label: 'Only Once Per Week',
    description: 'A member can only be assigned once per week',
    userFriendly: 'Each member is assigned at most once per week',
    type: 'boolean',
  },
  [CONSTRAINT_KEYS.MAX_ASSIGNMENTS_PER_MONTH]: {
    label: 'Max Assignments Per Month',
    description: 'Members will not exceed the specified monthly assignment limit',
    userFriendly: "Members won't exceed the specified monthly assignment limit",
    type: 'integer',
  },
  [CONSTRAINT_KEYS.ENFORCE_UNDERSTUDY_BEFORE_ROLE]: {
    label: 'Understudy Before Role',
    description: 'A member training for a role must be scheduled as its understudy before performing it',
    userFriendly: 'Trainees must understudy a role before performing it',
    type: 'boolean',
  },
  [CONSTRAINT_KEYS.ENFORCE_CROSS_TEAM_CAPS]: {
    label: 'Cross-Team Load Caps',
    description: "Count a member's weekly/monthly assignments across ALL their teams when applying the once-per-week and max-per-month caps",
    userFriendly: 'Weekly/monthly caps count a member’s shifts across all their teams',
    type: 'boolean',
  },
  [CONSTRAINT_KEYS.ENFORCE_CROSS_TEAM_CLASH]: {
    label: 'Cross-Team Clash',
    description: 'A member cannot be scheduled on two teams for events whose times overlap',
    userFriendly: 'A member can’t be double-booked across teams at the same time',
    type: 'boolean',
  },
}

// ============================================================================
// Roster Preferences (Soft Goals)
// ============================================================================

export const PREFERENCE_KEYS = {
  AVOID_CONSECUTIVE_WEEKS: 'AVOID_CONSECUTIVE_WEEKS',
  SPREAD_ASSIGNMENTS: 'SPREAD_ASSIGNMENTS',
  DIVERSIFY_ROLE_ASSIGNMENTS: 'DIVERSIFY_ROLE_ASSIGNMENTS',
  BALANCED_DAY_DISTRIBUTION: 'BALANCED_DAY_DISTRIBUTION',
}

export const PREFERENCE_METADATA = {
  [PREFERENCE_KEYS.AVOID_CONSECUTIVE_WEEKS]: {
    label: 'Avoid Consecutive Weeks',
    description: 'Avoid assigning the same member to consecutive weekend events',
    userFriendly: 'Avoid assigning the same member to consecutive weekend events',
    type: 'boolean',
  },
  [PREFERENCE_KEYS.SPREAD_ASSIGNMENTS]: {
    label: 'Spread Assignments',
    description: 'For each member, spread assignments evenly across the roster period',
    userFriendly: 'For each member, spread assignments evenly across the roster period',
    type: 'boolean',
  },
  [PREFERENCE_KEYS.DIVERSIFY_ROLE_ASSIGNMENTS]: {
    label: 'Diversify Role Assignments',
    description: 'Maximize variety by assigning different members to each role',
    userFriendly: 'Maximize variety by assigning different members to each role',
    type: 'boolean',
  },
  [PREFERENCE_KEYS.BALANCED_DAY_DISTRIBUTION]: {
    label: 'Balanced Day Distribution',
    description: 'Balance number of assignments across different days of week (e.g. Sundays and Saturdays)',
    userFriendly: 'Balance number of assignments across different days of week (e.g. Sundays and Saturdays)',
    type: 'boolean',
  },
}

// ============================================================================
// Member Preference Fields
// ============================================================================

export const MEMBER_PREF_FIELDS = {
  MEMBER_NAME: 'member_name',
  PREFERRED_DAY: 'preferred_day',
  MAX_ASSIGNMENTS: 'max_assignments',
  PREFERRED_ROLES: 'roles',
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the constraint value with type coercion
 */
export function getConstraintValue(rosterConstraints, constraintKey) {
  if (!rosterConstraints) return null

  const coerce = constraintCoercers[constraintKey]
  if (!coerce) return null

  const value = rosterConstraints[constraintKey]
  if (value == null) return null

  return coerce(value)
}

/**
 * Get user-friendly description for a constraint
 */
export function getConstraintDescription(constraintKey, rosterConstraints) {
  const metadata = CONSTRAINT_METADATA[constraintKey]
  if (!metadata) return constraintKey
  
  // For integer constraints, include the specific limit if available
  if (metadata.type === 'integer' && rosterConstraints) {
    const limit = getConstraintValue(rosterConstraints, constraintKey)
    if (limit !== null) {
      return `Members won't exceed ${limit} assignment${limit !== 1 ? 's' : ''} per month`
    }
  }
  
  return metadata.userFriendly
}

/**
 * Get user-friendly description for a preference
 */
export function getPreferenceDescription(preferenceKey) {
  const metadata = PREFERENCE_METADATA[preferenceKey]
  return metadata ? metadata.userFriendly : preferenceKey
}

/**
 * Get all active constraints from config
 */
export function getActiveConstraints(rosterConstraints) {
  if (!rosterConstraints) return []
  return Object.entries(rosterConstraints)
    .filter(([key, _]) => {
      const value = getConstraintValue(rosterConstraints, key)
      return value !== null
    })
    .map(([key]) => key)
}

/**
 * Get all active preferences from config
 */
export function getActivePreferences(rosterPreferences) {
  if (!rosterPreferences) return []
  return Object.entries(rosterPreferences)
    .filter(([_, value]) => !!value)
    .map(([key]) => key)
}

/**
 * Check if a specific constraint is enabled
 */
export function isConstraintEnabled(rosterConstraints, constraintKey) {
  const value = getConstraintValue(rosterConstraints, constraintKey)
  if (value === null) return false
  
  const metadata = CONSTRAINT_METADATA[constraintKey]
  if (metadata?.type === 'boolean') {
    return value === true
  }
  // For integer constraints, any non-null value means enabled
  return value !== null
}

/**
 * Check if a specific preference is enabled
 */
export function isPreferenceEnabled(rosterPreferences, preferenceKey) {
  return rosterPreferences && rosterPreferences[preferenceKey] === true
}

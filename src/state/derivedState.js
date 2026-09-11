/**
 * Roster document adapter — normalization half. `toState` takes a FLAT
 * roster document and produces the shape the engine/validators/stats consume
 * (active members, role colours, resolved constraints/preferences).
 *
 * The nested-tenant resolution half lives in tenantResolver.js: it flattens a
 * multi-team tenant document into the SAME flat shape this module consumes, so
 * `toState(resolveTenant(...))` is the full adapter. Flat input needs no
 * resolver, so single-team behaviour is unchanged.
 */

import { YAML_FIELDS, isMemberIncluded } from '../schema/rosterSchema'
import { createRoleColorMap } from '../design/colorUtils'
import { DEFAULT_ROSTER_CONSTRAINTS, DEFAULT_ROSTER_PREFERENCES } from '../config/rosterDefaults'
import { normalizeMemberRoles } from '../schema/understudyRoles'

export function toState(document) {
  if (!document) {
    return {
      members: [],
      events: [],
      roles: [],
      roleColorMap: {},
      activeMembers: [],
      memberConstraints: [],
      memberPreferences: [],
      rosterConstraints: { ...DEFAULT_ROSTER_CONSTRAINTS },
      rosterPreferences: { ...DEFAULT_ROSTER_PREFERENCES },
      rosterPeriod: null
    }
  }

  const rawMembers = document[YAML_FIELDS.MEMBERS] || []
  const events = document[YAML_FIELDS.EVENTS] || []

  // Normalize each member's roles: understudy-flagged roles are pulled out of
  // `roles` (they can't fully perform them yet) into `understudyFor`. Keeps
  // `member.roles` a plain string array for all downstream `.includes` checks.
  const members = rawMembers.map(m => {
    if (!m) return m
    const { roles, understudyFor } = normalizeMemberRoles(m.roles)
    return { ...m, roles, understudyFor }
  })

  // Handle both formats: roles: [{name: "x"}, ...] or declared_roles: ["x", ...]
  let roles = []
  if (document[YAML_FIELDS.ROLES] && Array.isArray(document[YAML_FIELDS.ROLES])) {
    roles = document[YAML_FIELDS.ROLES].map(r => typeof r === 'string' ? r : (r && r.name)).filter(Boolean)
  } else if (document.declared_roles && Array.isArray(document.declared_roles)) {
    roles = document.declared_roles.filter(Boolean)
  }
  
  // Generate role color map (shared palette from colorUtils)
  const roleColorMap = createRoleColorMap(roles)

  // Filter to schedulable members (see isMemberIncluded — `include` is the one
  // canonical field; `active` is only a legacy alias).
  const activeMembers = members.filter(isMemberIncluded)

  // Extract member constraints from member_constraints (top-level array in YAML)
  const memberConstraints = document[YAML_FIELDS.MEMBER_CONSTRAINTS] || []

  // Extract member preferences from member_preferences (top-level array in YAML)
  const memberPreferences = document[YAML_FIELDS.MEMBER_PREFERENCES] || []

  // Extract roster-level constraints and preferences. Source-code defaults are
  // the base; any keys present in the document override them (so an explicit
  // `false` or a different MAX_ASSIGNMENTS_PER_MONTH still wins).
  const rosterConstraints = { ...DEFAULT_ROSTER_CONSTRAINTS, ...(document[YAML_FIELDS.ROSTER_CONSTRAINTS] || {}) }
  const rosterPreferences = { ...DEFAULT_ROSTER_PREFERENCES, ...(document[YAML_FIELDS.ROSTER_PREFERENCES] || {}) }
  const rosterPeriod = document[YAML_FIELDS.ROSTER_PERIOD] || null

  return {
    members,
    events,
    roles,
    roleColorMap,
    activeMembers,
    memberConstraints,
    memberPreferences,
    rosterConstraints,
    rosterPreferences,
    rosterPeriod
  }
}

/**
 * Convenience aggregator: derived state + the cross-team `externalAssignments`
 * snapshot in one object. Names the "resolved derived-state" contract the
 * engine/validators consume, so a future tenant/team backend can resolve the
 * SAME shape by joining `members` + `team_members` without the engine changing.
 *
 * NOTE ON WIRING: the live provider path assembles these two pieces separately —
 * `toState(resolveTenant(...))` for the flat state and
 * `deriveExternalAssignments(...)` for the snapshot — because they update on
 * different triggers (selection vs. cross-team edits). This helper bundles them
 * for callers/tests that want the whole contract in one call; both routes yield
 * the same shape.
 *
 * For a single team it is an identity pass over `toState(document)` plus the
 * optional read-only cross-team **assignments**, which default to empty/no-op so
 * single-team behaviour is byte-for-byte identical.
 *
 * `externalAssignments` is the single cross-team primitive: any "load" figure
 * (monthly/weekly/total counts) is *derived* from it by the same rollup the
 * `AssignmentTracker` already applies to local assignments, so it is never
 * passed or stored as a separate, drift-prone input. See specs/multi-tenant.md.
 *
 * @param {object|null} document - the roster document (flat, or already-resolved)
 * @param {object} [external] - { externalAssignments } read-only snapshot of the
 *   member's assignments in OTHER teams (`{ memberId: [dateOrDatetime, ...] }`);
 *   empty by default.
 * @returns derived state + `externalAssignments`.
 */
export function resolveState(document, external = {}) {
  return {
    ...toState(document),
    externalAssignments: external.externalAssignments || {},
  }
}

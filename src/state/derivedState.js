/**
 * Roster document adapter — normalization half. `toState` takes a FLAT
 * roster document and produces the shape the engine/validators/stats consume
 * (active members, role colours, resolved constraints/preferences).
 *
 * The nested-tenant resolution half lives in tenantResolver.js: it flattens a
 * multi-team tenant document into the SAME flat shape this module consumes, so
 * `toState(selectRosterDocument(...))` is the full adapter. Flat input needs no
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
 * Combine a committed document with uncommitted draft events into the EFFECTIVE
 * document: the same document shape with its `events` replaced by the draft's
 * `effectiveEvents` (`draftEvents ?? committed.events`). A pure COMBINE of two
 * inputs (`assemble*`) that produces a `document` — the committed-vs-draft merge
 * the engine input is then cast from. Returns the input unchanged when it is
 * null (nothing to overlay).
 *
 * @param {object|null} document - the committed document.
 * @param {any[]} effectiveEvents - the draft's effective events to overlay.
 * @returns the effective document (a `document`).
 */
export function assembleEffectiveDocument(document, effectiveEvents) {
  if (!document) return document
  return { ...document, events: effectiveEvents }
}

/**
 * Combine a finished `State` (from `toState`) with the cross-team
 * `externalAssignments` snapshot (from `deriveExternalAssignments`) into the
 * complete engine input: `State with external`. This is a PURE COMBINE of two
 * already-made nouns — it does NOT cast a document and does NOT know about
 * drafts or tenants. Its name reflects its inputs: `assemble*` = combine, and
 * both inputs are the named nouns (`State`, `externalAssignments`).
 *
 * Callers build the two pieces themselves — `toState(selectRosterDocument(...))`
 * for the State and `deriveExternalAssignments(...)` for the snapshot — because
 * they update on different triggers (selection vs. cross-team edits).
 *
 * `externalAssignments` is the single cross-team primitive: any "load" figure
 * (monthly/weekly/total counts) is *derived* from it by the same rollup the
 * `AssignmentCounters` already applies to local assignments, so it is never
 * passed or stored as a separate, drift-prone input. See specs/multi-tenant.md.
 *
 * @param {object} state - a `State` (the output of `toState`).
 * @param {object} [external] - { externalAssignments } read-only snapshot of the
 *   member's assignments in OTHER teams (`{ memberId: [dateOrDatetime, ...] }`);
 *   empty by default.
 * @returns the `State` with `externalAssignments` attached.
 */
export function assembleStateWithExternal(state, external = {}) {
  return {
    ...state,
    externalAssignments: external.externalAssignments || {},
  }
}

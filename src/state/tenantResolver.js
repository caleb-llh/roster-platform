/**
 * Nested-tenant resolution. A tenant document nests
 * `teams: [{ name, roles, team_members, rosters }]` with a tenant-level
 * `members` registry (identity + global `unavailable_dates`). This module
 * flattens such a document (given a `{ teamId, rosterId }` selection) into the
 * SAME flat shape `getDerivedState` (see derivedState.js) already consumes, plus
 * the cross-team helpers (`deriveExternalAssignments`, `validateTenantRosters`).
 * Flat input passes through untouched, so single-team behaviour is unchanged.
 *
 * See specs/multi-tenant.md "Phase 1 contract". Its output is the shape
 * `getDerivedState` consumes; the two modules together form the data adapter.
 */

import { YAML_FIELDS } from '../schema/rosterSchema'
import { parseDayKey } from '../utils/calendarUtils'

/** True when `data` uses the nested tenant shape (has a top-level `teams` array). */
export function isTenantShape(data) {
  return !!(data && Array.isArray(data.teams))
}

/**
 * Shallow-merge constraint/preference layers in precedence order (later wins),
 * skipping absent layers. Used for the tenant → team → roster merge chain so a
 * team can set house rules that a specific roster may still override. Returns
 * `null` when no layer supplied an object, so callers can omit the key entirely
 * (keeping flat single-team docs unchanged rather than injecting an empty {}).
 */
function mergeLayers(...layers) {
  const present = layers.filter(l => l && typeof l === 'object')
  if (!present.length) return null
  return Object.assign({}, ...present)
}

/**
 * Stable synthetic id for a team/roster that has no explicit id. Nested YAML
 * teams/rosters are keyed positionally (name is not guaranteed unique), so the
 * provider selection layer can address them deterministically.
 */
function teamId(team, index) {
  return (team && team.id) || `team-${index}`
}
function rosterId(roster, index) {
  return (roster && roster.id) || `roster-${index}`
}

/**
 * Enumerate a tenant document's teams and their rosters for the provider
 * selection layer. Flat documents resolve to one default team with one default
 * roster. Returns `{ teams: [{ id, name, rosters: [{ id, name }] }] }`.
 */
export function tenantSelection(data) {
  if (!isTenantShape(data)) {
    return {
      teams: [
        { id: 'team-0', name: 'Team', rosters: [{ id: 'roster-0', name: 'Roster' }] },
      ],
    }
  }
  return {
    teams: (data.teams || []).map((team, ti) => ({
      id: teamId(team, ti),
      name: (team && team.name) || `Team ${ti + 1}`,
      rosters: ((team && team.rosters) || []).map((r, ri) => ({
        id: rosterId(r, ri),
        name: (r && r.name) || (r && r.roster && r.roster.start_date) || `Roster ${ri + 1}`,
      })),
    })),
  }
}

/**
 * Map each registry member to the names of every team they are on
 * (`{ memberId: [teamName, ...] }`). Used for the members-view "Also on" line
 * (cross-team visibility, multi-tenant Phase 1). Flat documents have no teams,
 * so this is `{}` and callers show nothing.
 */
export function memberTeams(data) {
  if (!isTenantShape(data)) return {}
  const map = {}
  ;(data.teams || []).forEach((team, ti) => {
    const name = (team && team.name) || `Team ${ti + 1}`
    ;(team.team_members || []).forEach(tm => {
      if (!tm || !tm.member_id) return
      ;(map[tm.member_id] || (map[tm.member_id] = [])).push(name)
    })
  })
  return map
}

/**
 * Write committed `events` back into a nested tenant document's selected roster,
 * returning a NEW document (the input is not mutated). This is the inverse of
 * `resolveTenant` for the events portion: `resolveTenant` reads a roster's
 * events out to the flat working doc; on commit this puts the edited events
 * back so switching team/roster and returning preserves the edit
 * (multi-tenant Phase 1 write-back).
 *
 * Only the addressed roster's `events` change; everything else (registry,
 * team_members, other rosters, roster period/overrides) is untouched. Flat
 * documents (no `teams`) are returned unchanged — flat mode keeps its events in
 * the working doc as before.
 */
export function writeBackEvents(data, { teamId: selTeamId, rosterId: selRosterId }, events) {
  if (!isTenantShape(data)) return data
  const next = JSON.parse(JSON.stringify(data))
  const teams = next.teams || []
  const ti = teams.findIndex((t, i) => teamId(t, i) === selTeamId)
  const team = ti >= 0 ? teams[ti] : teams[0]
  if (!team) return next
  const rosters = team.rosters || []
  const ri = rosters.findIndex((r, i) => rosterId(r, i) === selRosterId)
  const roster = ri >= 0 ? rosters[ri] : rosters[0]
  if (!roster) return next
  roster.events = JSON.parse(JSON.stringify(events || []))
  return next
}

/**
 * Derive the read-only cross-team `externalAssignments` snapshot for the active
 * team: `{ memberId: ['YYYY-MM-DD', ...] }`, gathering every assignment a member
 * holds on rosters belonging to *other* teams.
 *
 * "External" is defined per the active TEAM, not the active roster: the active
 * team's own sibling rosters are excluded (they are different periods of the
 * same team, and the local once-per-week/clash logic is already period-scoped —
 * counting them here would double-count). Every roster on every other team
 * contributes its placed dates. Flat documents (no `teams`) have no other teams,
 * so this is `{}` and single-team enforcement stays a no-op.
 *
 * Only the *dates* are needed (the fold in constraintPrimitives derives week/
 * month/clash from them); role and team identity are irrelevant to the caps and
 * to same-day clash. Duplicate dates are kept intentionally — a member rostered
 * twice on another team the same week should count twice toward a weekly cap.
 */
export function deriveExternalAssignments(data, { teamId: selTeamId } = {}) {
  if (!isTenantShape(data)) return {}
  const teams = data.teams || []
  const activeIndex = teams.findIndex((t, i) => teamId(t, i) === selTeamId)
  const external = {}
  teams.forEach((team, ti) => {
    if (ti === activeIndex) return // skip the active team's own rosters
    ;(team.rosters || []).forEach(r => {
      ;(r.events || []).forEach(ev => {
        const date = ev && ev.date
        if (!date) return
        ;(ev.roster || []).forEach(slot => {
          const mid = slot && slot.member_id
          if (!mid) return
          ;(external[mid] || (external[mid] = [])).push(date)
        })
      })
    })
  })
  return external
}

/**
 * Validate the structural invariant that a team's rosters PARTITION time: no two
 * rosters on the same team may cover overlapping date periods.
 *
 * `deriveExternalAssignments` relies on this — it treats a team's own sibling
 * rosters as "different periods of the same team" and excludes them from the
 * cross-team snapshot to avoid double-counting. If two sibling rosters actually
 * overlapped, a genuine within-team double-booking spanning both would be
 * silently dropped (excluded as "sibling", and each roster is validated in
 * isolation). This surfaces that authoring mistake loudly instead.
 *
 * Non-fatal by design (matches the app's warning style): returns an array of
 * human-readable warning strings — `[]` for flat docs and for well-formed
 * tenants. Rosters without both `start_date` and `end_date` are skipped (a
 * missing period can't be checked). Overlap is inclusive on calendar days: two
 * rosters that merely share a boundary day are considered overlapping.
 */
export function validateTenantRosters(data) {
  if (!isTenantShape(data)) return []
  const warnings = []
  ;(data.teams || []).forEach((team, ti) => {
    const teamName = (team && team.name) || `Team ${ti + 1}`
    const periods = ((team && team.rosters) || [])
      .map((r, ri) => {
        const p = r && r.roster
        if (!p || !p.start_date || !p.end_date) return null
        // Parse via the shared local-midnight helper (not `new Date(str)`, which
        // is UTC and can slip a day in negative-offset zones — see calendarUtils).
        const start = parseDayKey(p.start_date).getTime()
        const end = parseDayKey(p.end_date).getTime()
        if (Number.isNaN(start) || Number.isNaN(end)) return null
        return { name: (r && r.name) || p.start_date, id: rosterId(r, ri), start, end }
      })
      .filter(Boolean)
    // Pairwise overlap. A team has few rosters, so O(n²) is fine and keeps the
    // message precise (names the two offending periods).
    for (let a = 0; a < periods.length; a++) {
      for (let b = a + 1; b < periods.length; b++) {
        const pa = periods[a]
        const pb = periods[b]
        // Inclusive overlap: [aStart, aEnd] ∩ [bStart, bEnd] ≠ ∅.
        if (pa.start <= pb.end && pb.start <= pa.end) {
          warnings.push(
            `${teamName}: rosters "${pa.name}" and "${pb.name}" cover overlapping date periods; ` +
              `a team's rosters must not overlap (cross-team load excludes sibling rosters).`
          )
        }
      }
    }
  })
  return warnings
}

/**
 * Resolve a tenant document + selection into today's FLAT document shape.
 *
 * - Flat input (no `teams`) is returned unchanged.
 * - Nested input joins the tenant `members` registry with the selected team's
 *   `team_members` (capability lives per team), lifts each member's global
 *   `unavailable_dates` into `member_constraints`, and flattens the selected
 *   roster's period/events/overrides to the top level.
 *
 * `teamId`/`rosterId` default to the first team/roster. Members not on the
 * selected team are excluded (a member absent from `team_members` is not on it).
 */
export function resolveTenant(data, { teamId: selTeamId, rosterId: selRosterId } = {}) {
  if (!isTenantShape(data)) return data

  const teams = data.teams || []
  const team = teams.find((t, i) => teamId(t, i) === selTeamId) || teams[0]
  if (!team) return { members: [], roles: [], events: [] }

  const rosters = team.rosters || []
  const roster = rosters.find((r, i) => rosterId(r, i) === selRosterId) || rosters[0] || {}

  // Registry keyed by id for the join.
  const registry = new Map(
    (data.members || []).filter(Boolean).map(m => [m.id, m])
  )

  const teamMembers = team.team_members || []
  // Per-roster `include` overrides. Team capability (roles) is shared across a
  // team's rosters, but whether a member is *active* can differ per period
  // (e.g. someone on sabbatical this quarter). A roster may carry
  // `member_overrides: [{ member_id, include }]`; when a member has an override
  // for the selected roster it wins over the team_members `include`.
  const rosterOverrides = new Map(
    ((roster && roster.member_overrides) || [])
      .filter(o => o && o.member_id)
      .map(o => [o.member_id, o])
  )

  // Join: each team_member row → today's flat member (registry identity +
  // per-team capability). Members absent from the registry are skipped.
  const members = teamMembers
    .map(tm => {
      const reg = registry.get(tm.member_id)
      if (!reg) return null
      const override = rosterOverrides.get(tm.member_id)
      const include = override && override.include !== undefined ? override.include : tm.include
      return {
        id: reg.id,
        name: reg.name,
        telegram: reg.telegram,
        ...(reg.avatar !== undefined ? { avatar: reg.avatar } : {}),
        roles: tm.roles || [],
        include,
      }
    })
    .filter(Boolean)

  // Global unavailability lives on the registry member; surface it as
  // member_constraints for the members ON this team (Design Decision 4). The
  // free-text `note` travels with it (it annotates the person's availability),
  // so a row is emitted when EITHER dates or a note is present.
  const memberConstraints = members
    .map(m => {
      const reg = registry.get(m.id)
      const dates = (reg && reg.unavailable_dates) || []
      const note = reg && reg.note
      if (!dates.length && !note) return null
      const row = { member_id: m.id }
      if (note) row.note = note
      if (dates.length) row.unavailable_dates = dates
      return row
    })
    .filter(Boolean)

  const flat = {
    members,
    roles: team.roles || [],
    events: roster.events || [],
  }
  if (roster.roster) flat.roster = roster.roster
  // Constraint/preference merge chain: tenant → team → roster (later wins),
  // mirroring today's DEFAULT → document merge one level deeper. A team can set
  // tenant-wide house rules (e.g. cross-team caps) that a specific roster may
  // still override. Only emit the merged object when any layer supplied one, so
  // flat single-team docs (no tenant/team layers) are unchanged.
  //
  // Auto-enable cross-team enforcement for genuinely multi-team tenants: when a
  // tenant has >1 team, the cross-team cap/clash keys default ON as the LOWEST-
  // precedence layer, so any explicit tenant/team/roster YAML still overrides
  // them. A single-team tenant leaves both off (nothing to be cross-team about),
  // keeping single-team output byte-for-byte identical.
  const crossTeamDefaults =
    teams.length > 1
      ? { ENFORCE_CROSS_TEAM_CAPS: true, ENFORCE_CROSS_TEAM_CLASH: true }
      : null
  const mergedConstraints = mergeLayers(
    crossTeamDefaults,
    data.roster_constraints,
    team.roster_constraints,
    roster.roster_constraints
  )
  if (mergedConstraints) flat.roster_constraints = mergedConstraints
  const mergedPreferences = mergeLayers(
    data.roster_preferences,
    team.roster_preferences,
    roster.roster_preferences
  )
  if (mergedPreferences) flat.roster_preferences = mergedPreferences
  if (roster.member_preferences) flat.member_preferences = roster.member_preferences

  // getDerivedState reads member unavailability from the YAML field
  // `member_constraints` (Design Decision 4: global unavailability, resolved
  // per team).
  flat[YAML_FIELDS.MEMBER_CONSTRAINTS] = memberConstraints
  return flat
}

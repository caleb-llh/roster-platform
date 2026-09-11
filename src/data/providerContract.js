/**
 * The provider contract shared by every data-layer mode (local, production).
 *
 * This is the seam that makes dual-mode maintainable: components depend ONLY on
 * this shape, never on a concrete provider or on the current mode. Every mutation
 * is async and fallible ({ ok, errors }) so that callers written against the local
 * playground already handle the production reality (network / RLS / validation
 * failures). Local mode simply resolves immediately and never denies permission.
 *
 * Business rules (validation, generation, constraint checks) live in the shared
 * layer and are invoked identically by both providers — providers differ only in
 * I/O (where the document is read from / written to).
 */

/**
 * @typedef {Object} MutationResult
 * @property {boolean} ok           Whether the mutation succeeded.
 * @property {string[]} errors      Human-readable errors when ok === false.
 */

/**
 * Permission flags supplied by the provider. Components gate UI on these instead
 * of checking the mode. Local mode returns all-true (single-user sandbox);
 * production derives them from the authenticated user's role (admin/member).
 *
 * @typedef {Object} RosterPermissions
 * @property {boolean} canEditRoster   Insert/remove/replace/swap assignments, generate.
 * @property {boolean} canImport       Import/replace the whole document (seed).
 * @property {boolean} canUndo         Undo the last change.
 */

/**
 * The uniform value returned by every provider (and by useRosterData).
 *
 * @typedef {Object} RosterProvider
 * @property {any} data                       Parsed working document (or null).
 *   May carry a transient `data.warnings` (string[]): document-level, non-fatal
 *   warnings surfaced by the provider on load — the merge of `runAllValidators`
 *   document warnings and any tenant-structure warnings (e.g. overlapping team
 *   rosters from `validateTenantRosters`). It is display-only (rendered by the
 *   members/events views) and is stripped before persistence, so it never round-
 *   trips into the stored document.
 * @property {any} originalData               Snapshot for diffing (or null).
 * @property {{type: string, message: string}|null} error
 * @property {boolean} loading
 * @property {boolean} hasGenerated
 * @property {(any[]|null)} draftEvents    Uncommitted working events, or null when clean.
 * @property {any[]} effectiveEvents       What the UI should render: draftEvents ?? data.events.
 * @property {boolean} hasUncommitted      Whether an uncommitted draft exists.
 * @property {boolean} canUndo
 * @property {boolean} canRedo
 * @property {any[]} actionLog
 * @property {RosterPermissions} permissions
 *
 * @property {('owner'|'editor'|'viewer'|null)} role  Caller's role on the active
 *   roster (production); null in local mode. The admin UI is gated on role === 'owner'.
 * @property {{id: string, name: string}[]} teams  The tenant's teams (multi-tenant
 *   Phase 1). A team-selection layer sits ABOVE roster selection; `rosters` is the
 *   ACTIVE team's rosters. Flat/single-team documents resolve to one synthetic team.
 * @property {(string|null)} activeTeamId  Currently-selected team id.
 * @property {(string|null)} activeTeamName  Display name of the active team (for
 *   the members-view team-membership zone label); null in flat/single-team mode.
 * @property {Object<string, string[]>} memberTeams  Map of member id → names of
 *   ALL teams that member is on, for the members-view "Also on" line. `{}` in
 *   flat/single-team mode, so the line never shows.
 * @property {Object<string, string[]>} externalAssignments  Cross-team snapshot
 *   (multi-tenant Phase 2): map of member id → the dates that member is assigned
 *   on OTHER teams' rosters. Folded through the shared counting seam by the
 *   generator/validator when cross-team caps/clash are enabled. `{}` in
 *   flat/single-team mode, so cross-team enforcement is a no-op.
 * @property {(id: string) => void} selectTeam  Switch the active team; resets
 *   `activeRosterId` to that team's first roster.
 * @property {{id: string, name: string, role: string}[]} rosters  The ACTIVE team's
 *   rosters (production); empty in local mode until a tenant document is loaded.
 * @property {(string|null)} activeRosterId  Currently-loaded roster id.
 * @property {(id: string) => void} selectRoster  Switch the active roster.
 * @property {(name: string) => Promise<MutationResult>} createRoster
 * @property {() => Promise<MutationResult & {members: {user_id: string, email: string, role: string}[]}>} listMembers
 * @property {(email: string, role: string) => Promise<MutationResult>} setMemberRole
 * @property {(userId: string) => Promise<MutationResult>} removeMember
 * @property {(email: string, role: string) => Promise<MutationResult>} inviteMember  Whitelist an email before login.
 * @property {() => Promise<MutationResult & {invites: {email: string, role: string}[]}>} listInvites
 * @property {(email: string) => Promise<MutationResult>} revokeInvite
 *
 * @property {(yamlText: string) => Promise<MutationResult>} importData
 * @property {() => Promise<void>} clearData
 * @property {(events: any[]) => Promise<MutationResult>} saveEvents  Persist committed
 *   events (the "binding"). Called by the Session layer on commit — CRUD only.
 * @property {(parsedData: any, keepEvents: any[]) => Promise<MutationResult & {nextEvents: any[]}>} replaceDocument
 *   Replace the non-event document, keeping `keepEvents`; returns the parsed
 *   document's events as `nextEvents` for the Session layer to route through the draft.
 * @property {(entryOrEntries: any) => void} logAction
 * @property {(error: any) => void} setError
 *
 * The following keys are added by the SESSION layer (`useSession`), which wraps
 * a provider. They are NOT part of the pure-CRUD provider surface:
 * @property {(events: any[]) => Promise<MutationResult>} updateEvents  Edit → draft.
 * @property {(parsedData: any) => Promise<MutationResult>} replaceData  YAML editor edit.
 * @property {() => boolean} undo             Undo one edit within the draft.
 * @property {() => boolean} redo             Redo one undone edit.
 * @property {() => Promise<MutationResult>} commitDraft   Persist the draft (the "binding").
 * @property {() => void} discardDraft        Drop the uncommitted draft.
 */

/**
 * Full-access permissions used by the local single-user playground.
 * @type {RosterPermissions}
 */
export const LOCAL_PERMISSIONS = Object.freeze({
  canEditRoster: true,
  canImport: true,
  canUndo: true,
})

/**
 * The exact set of keys every PROVIDER's returned object must expose — the pure
 * CRUD storage surface. A provider owns the committed document and knows how to
 * persist events (`saveEvents`) and swap the non-event document
 * (`replaceDocument`), but it is timeless: it has NO draft/undo/redo overlay and
 * no edit command surface. That is the Session layer's job (see below).
 *
 * The conformance test renders both the local and Supabase providers and asserts
 * each returns exactly these keys, so the two backends cannot drift out of
 * interchangeability without a test failing.
 *
 * @type {readonly string[]}
 */
export const PROVIDER_KEYS = Object.freeze([
  // document
  'data', 'originalData', 'error', 'loading', 'hasGenerated', 'actionLog',
  // tenant/selection
  'teams', 'activeTeamId', 'activeTeamName', 'memberTeams', 'externalAssignments',
  'selectTeam', 'rosters', 'activeRosterId', 'selectRoster',
  // admin/membership
  'role', 'permissions', 'createRoster', 'listMembers', 'setMemberRole',
  'removeMember', 'inviteMember', 'listInvites', 'revokeInvite',
  // CRUD document actions
  'importData', 'clearData', 'saveEvents', 'replaceDocument', 'logAction', 'setError',
])

/**
 * The keys the SESSION layer (`useSession`) adds on top of a provider: the
 * draft/commit + undo/redo overlay and the edit command surface. Together with
 * `PROVIDER_KEYS` these form the full composed surface (`ROSTER_PROVIDER_KEYS`)
 * that the UI consumes via `useRosterData`.
 *
 * @type {readonly string[]}
 */
export const SESSION_KEYS = Object.freeze([
  // draft/history overlay
  'draftEvents', 'effectiveEvents', 'hasUncommitted', 'canUndo', 'canRedo',
  'undo', 'redo', 'commitDraft', 'discardDraft',
  // edit commands (orchestrate the draft on top of provider CRUD)
  'updateEvents', 'replaceData',
])

/**
 * The full composed surface returned by `useRosterData` (provider + Session).
 * This is the machine-checkable form of the `RosterProvider` typedef above and
 * is what components depend on. The conformance test asserts that
 * `useSession(provider)` returns exactly these keys.
 *
 * @type {readonly string[]}
 */
export const ROSTER_PROVIDER_KEYS = Object.freeze([
  ...PROVIDER_KEYS,
  ...SESSION_KEYS,
])

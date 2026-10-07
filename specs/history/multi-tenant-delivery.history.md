# Multi-tenant delivery — migration record (history, non-binding)

> **This is a historical record, not a binding spec.** The tenant → team →
> roster hierarchy, member registry, cross-team constraints and the local YAML
> resolver were delivered in sequenced phases (Phase 0 seam → datetime-range
> model → Phase 1 local model → Phase 2 cross-team constraints); the remaining
> Supabase persistence (Phase 3) is planned in
> [multi-tenant.plan.md](../multi-tenant.plan.md). The durable behaviour those
> phases established is now authoritative and present-tense in
> [multi-tenant.md](../multi-tenant.md). This file is kept **only for the
> "why"**: the per-phase log of what landed and in what order. Nothing here binds
> current behaviour — if it ever conflicts with a binding spec, the binding spec
> wins. Read it to understand *how the feature got here*, not *what it does now*.

## Phased delivery (as built)

Design was complete up front; delivery was sequenced so each phase was shippable
and kept `npx vitest run` + `npm run build` green.

- **Phase 0 — types & seam (no behaviour change).** The resolved derived-state
  became the single contract via `resolveState(data, { externalAssignments })`
  in [`derivedState.js`](../../src/state/derivedState.js) — a single-team identity
  pass over `toState` plus the empty/no-op cross-team assignments snapshot.
  `generateRoster` threaded `externalAssignments` (defaulting `{}`) into the
  `EligibilityChecker`, which stored it unused until Phase 2 (then consulted by
  the cross-team cap/clash fold). `externalLoad` was deliberately *not* an input
  — load derives from the assignments snapshot. Tests locked in the no-op: the
  full suite stayed green, `resolveState` was proven identical to `toState`, and
  an empty `externalAssignments` produced byte-for-byte identical generator
  output.
- **Datetime-range model + local clash (prerequisite for Phase 2 clash).**
  Events resolve to half-open `[start, end)` intervals so same-day non-overlapping
  events don't clash, and clash is interval-overlap — landed as the `no-clash`
  feasibility constraint enforced by the generator, validator and swap
  ([data-layer.md](../data-layer.md) owns the interval semantics;
  [generation.md](../generation.md#hard-constraints-one-authority-many-consumers)
  owns the registry). The rule was written once against intervals, so Phase 2's
  cross-team clash is the *same* rule extended to fold in `externalAssignments`,
  not a new one.
- **Phase 1 — local model.** New nested YAML shape + `toState` resolver + nested
  `sample_tenant.yaml`; MembersView split (registry vs. team membership); global
  unavailability; team selector above roster selector; events write-back into the
  tenant doc.
  - **Resolver + selection + nested sample.** `isTenantShape`, `tenantSelection`
    and `resolveTenant` in [`tenantResolver.js`](../../src/state/tenantResolver.js)
    detect the nested shape and flatten a selected team+roster into a flat
    document (registry ⋈ `team_members`, global `unavailable_dates` — and its
    free-text `note` — → per-team `member_constraints`), which `toState` consumes
    unchanged. Flat input is returned untouched (`resolveTenant` is identity when
    there is no `teams` key). The provider contract gained `teams` /
    `activeTeamId` / `selectTeam` above `rosters` / `activeRosterId` /
    `selectRoster`; the local provider holds the raw tenant doc and re-resolves
    the flat working document on selection, and App renders a team selector above
    the roster selector when a nested doc is loaded.
    [`public/sample_tenant.yaml`](../../public/sample_tenant.yaml) is the
    canonical nested example (sibling of the flat `sample.yaml`); a validator test
    resolves *every* team+roster to a valid flat document.
  - **Write-back.** Committing an edit while a nested tenant doc is loaded also
    persists the events into the active roster inside the tenant doc, so switching
    team/roster and returning preserves the edit.
    `withRosterEvents(tenantDoc, {teamId, rosterId}, events)` in
    [`tenantResolver.js`](../../src/state/tenantResolver.js) is the pure inverse of
    `resolveTenant` for the events portion (returns a new doc; only the addressed
    roster's `events` change; identity for flat docs). The local provider's
    committed-events sink calls it via refs — see
    [`useLocalRosterProvider.js`](../../src/data/useLocalRosterProvider.js). Scope:
    only the **events** round-trip; non-event edits (members, roles, roster
    overrides via the YAML editor) apply to the flat working view only; durable
    per-team persistence of those lands with the Supabase provider.
  - **MembersView split.** Each member card separates tenant-level IDENTITY
    (name, telegram, global unavailability — relabelled "Unavailable (global)" in
    a tenant context) from this team's CAPABILITY (roles/understudy), via a subtle
    divider labelled "on &lt;team&gt;". A read-only **"Also on: …"** line shows the
    OTHER teams a member serves — rendered only for members with multi-team
    membership. Cross-team visibility is derived by `memberTeams(tenantDoc)` in
    [`tenantResolver.js`](../../src/state/tenantResolver.js) (member id → team
    names), exposed via the provider (`memberTeams`, `activeTeamName`) and threaded
    App → MembersView → MemberCard. In flat/single-team mode the divider, team
    label and "Also on" line are all absent, so single-team cards are unchanged.
- **Phase 2 — cross-team constraints.**
  - **Enforcement core.** Two new constraint keys in
    [`rosterSchema.js`](../../src/schema/rosterSchema.js) —
    `ENFORCE_CROSS_TEAM_CAPS` and `ENFORCE_CROSS_TEAM_CLASH` — fold a member's
    `externalAssignments` into the *same* counting/clash seam every consumer
    already reads, so no new rule was introduced. Both default **OFF** and the
    snapshot is empty in single-team mode, so single-team behaviour is
    byte-for-byte unchanged. The fold helpers `externalEventsFor` /
    `externalWeeklyCount` / `externalMonthlyCount` live in
    [`constraintPrimitives.js`](../../src/rules/constraintPrimitives.js); the
    `no-clash` descriptor emits `params.external`. Caps depend on the local cap;
    cross-team clash BLOCKS during generation (the `EligibilityChecker` OR-s it
    into the `no-clash` run condition via a `forceRun` seam and the swap validator
    folds externals into its always-on clash scan). The constraint/preference
    merge chain `resolveTenant` applies is `tenant → team → roster` (later wins)
    via the `mergeLayers` helper.
  - **Data-sourcing + auto-enable + UI.** The read-only `externalAssignments`
    snapshot is derived from the tenant document by
    `deriveExternalAssignments(data, { teamId })` in
    [`tenantResolver.js`](../../src/state/tenantResolver.js) — scoped to the active
    TEAM (sibling rosters excluded). The local provider
    ([`useLocalRosterProvider.js`](../../src/data/useLocalRosterProvider.js))
    computes it for the active team and exposes it; [`App.jsx`](../../src/App.jsx)
    threads it into `generateRoster`, `validateEventAssignments` and `explainSwap`.
    `validateTenantRosters(data)` enforces the "a team's rosters partition time"
    invariant (non-fatal warning on overlap). `resolveTenant` auto-enables both
    cross-team keys as the lowest-precedence layer iff the tenant has >1 team. UI
    surfacing reuses the existing validation renderer in
    [`EventsView.jsx`](../../src/components/EventsView.jsx).
  - **Deferred (follow-ups, now in [multi-tenant.plan.md](../multi-tenant.plan.md)):**
    a dedicated cross-team *load* view in stats (clash badges are done); production
    wiring of `externalAssignments` in the Supabase provider (a `{}` stub) lands
    with Phase 3.

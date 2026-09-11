# Multi-tenant, teams & cross-team members — design plan (not yet built)

> **Status: PLANNING.** This file is the agreed target design and impact
> analysis for introducing a **tenant → team → roster** hierarchy with a
> **tenant-level member registry** and **cross-team-aware constraints**. Nothing
> here is implemented yet. It is binding *as a plan*: when a phase lands, move
> its decisions into the relevant spec ([architecture](architecture.md),
> [data-layer](data-layer.md), [generation](generation.md)) and update this file's
> status. Sequencing is deliberate — see [Phased delivery](#phased-delivery).

## Why this change

Today a **roster row = the whole document = the RBAC unit** (owner/editor/viewer
live on `roster_members`, keyed by `roster_id`). Members, roles, constraints and
events are all embedded in that one JSONB `document`
([architecture.md](architecture.md) "Data model"). That model cannot express:

- one organisation ("tenant") running **many teams**, each with its own
  schedule, under shared administration and billing;
- a **person who serves on multiple teams** as a single identity (so their
  availability and workload are one truth, not per-document copies);
- **constraints that span teams** ("Alice is away 3/5" must block *every* team;
  a monthly cap should count her shifts *across* teams; two teams must not
  double-book her on the same day).

## Target model

Three levels, plus a first-class member registry that is **not** owned by any
single roster:

```
tenant (org)
 ├── members        (registry: the PEOPLE — identity, global constraints)
 ├── teams
 │    ├── team_members   (which people are on this team + their roles ON this team)
 │    ├── bots           (future: team-tied bots, e.g. Telegram)        ── governance
 │    ├── reminders      (future: team-tied reminder config/cadence)    ── governance
 │    └── rosters        (schedules; each still a JSONB document of events)
 │         └── events[].roster[] → { role, member_id, isGenerated }  (member_id → tenant member)
 └── tenant_users   (RBAC: which auth.users can administer this tenant/teams)
```

**Bots and reminders are team-scoped and governed as configuration** (managed by
`owner`/`admin` — see [permissions.md](permissions.md#target-model-planned-tenant-scoped--not-yet-built)).
They are listed here as future nodes of the scope tree so the permission targets
(`team:manage-bots`, `team:manage-reminders`) have a home; their data shape is
specified when built.

### Design decisions

1. **Tenant is the isolation + billing boundary; team is the scheduling unit;
   roster is a schedule a team produces.** A team can have **many rosters**
   (e.g. one per quarter, or draft variants) — we keep `roster` as the
   document so the existing draft/commit, undo/redo, diff, stats and generation
   machinery keep working *unchanged per roster*. We deliberately did **not**
   collapse "team = roster": teams are long-lived and own membership/roles;
   rosters are disposable schedules. This also leaves room for the
   multi-version idea in `todo.md` (versions = sibling rosters of a team).

2. **Members are tenant-level entities with a stable id.** A member row
   `{ id, tenant_id, name, telegram, avatar?, claimed_user_id? }` exists once
   per person per tenant. Teams reference members via `team_members
   (team_id, member_id, roles[], understudy_for[], include)`. A roster document
   embeds **only assignments** (`member_id`), never the member's profile. This
   is what makes a person cross-team: they are one `members` row referenced by
   many `team_members` rows.
   - **Rationale (rejected alternative):** keeping members embedded per document
     and "emulating" cross-team by copying the member into each document (ids
     matching) was rejected — the copies drift (constraints edited on one team
     don't propagate), and cross-team caps/clash detection become impossible
     because there is no shared identity to aggregate over.
   - **Role capability is per-team.** "Alice can lead" may be true on Team A and
     not Team B (different role catalogs). Therefore `roles`/`understudyFor`
     live on `team_members`, **not** on the member. Only the understudy
     *declaration* is team config this way; understudy **progress and promotion
     are roster-specific and derived** — see
     [understudy.md](understudy.md#scope-what-is-team-level-vs-roster-level) for
     the three-way split. The tenant member carries
     only identity + *global* attributes (see constraints below). The generator
     and eligibility checks continue to receive a **per-team resolved member
     list** shaped exactly like today's normalized member
     (`{ id, name, roles[], understudyFor[], include }`) — see
     [Compatibility seam](#compatibility-seam).

3. **Roles are per-team.** Each team owns its `roles` catalog (the existing
   top-level `roles`). Two teams may share role *names* by coincidence; they are
   not the same role. Understudy-role derivation (`isUnderstudyRole`) is
   unchanged within a team.

4. **Constraints are cross-team aware in four concrete ways** (all four were
   requested):
   - **Global unavailability.** `member.unavailable_dates` moves to the
     **tenant member** (one calendar per person). Every team/roster that
     references the member sees the same unavailability. `isMemberUnavailable`
     keeps its signature but is fed the member's global constraint list.
   - **Cross-team load caps.** `MAX_ASSIGNMENTS_PER_MONTH` (and once-per-week)
     may be evaluated over the member's assignments **summed across all teams**
     in the tenant, not just the current roster. This requires the generator /
     validator to see the member's *other* current assignments (a read-only
     cross-team **assignments** snapshot); the count itself is **derived** from
     that snapshot, not passed separately — see
     [Compatibility seam](#compatibility-seam-how-we-avoid-rewriting-the-engine).
   - **Cross-team clash detection.** Two teams scheduling the same member on an
     overlapping **time range** (see the datetime-range model in
     [data-layer.md](data-layer.md)) is a clash. Detected at validation time
     (warn or block, configurable) using the tenant-wide assignment index. The
     clash rule is interval-overlap, which subsumes the date-equality behaviour
     used before datetime ranges landed.
   - **Per-team overrides.** Team-level `roster_constraints` /
     `roster_preferences` override tenant defaults, exactly as roster-level
     overrides tenant/source defaults today (`toState` already merges
     `DEFAULT → document`; we add a `tenant → team → roster` merge chain).

5. **The document keeps its atomic draft/commit contract.** Per
   [data-layer.md](data-layer.md), a roster is edited as one draft and published
   atomically. That stays true **per roster**. Cross-team reads (external load,
   clashes) are **read-only inputs** to that roster's generation/validation;
   they never make one roster's Save mutate another roster.

6. **Identity: one member, many providers, one `auth.users`.** The four
   entities tie to a single human through **`members.claimed_user_id`** as the
   sole hinge — it is the only FK from the person-side (`members` →
   `team_members`) to the auth-side (`auth.users` ← `tenant_users`), and the
   `self` relation (`member.claimed_user_id === actor.user_id`) is the bridge
   ([permissions.md](permissions.md#target-model-planned-tenant-scoped--not-yet-built)).
   The subtlety this decision pins is that **`auth.users` is itself the
   multi-identity account**: Supabase keeps one `auth.identities` row *per login
   provider* (Google today; Telegram later), and account-linking collapses them
   to **one** `auth.users.id`. So the target is: many login providers → one
   `auth.users` row → one claimed `members` row. Concretely:
   - **`members.telegram` is promoted from a notify string to a login
     identity** when Telegram sign-in lands. Today it is a display/notification
     handle only; for "log in with Telegram → I *am* this member" it must feed
     `auth.identities` (as a Supabase provider) or a `member_identities
     (member_id, provider, provider_uid)` side table, **not** stay free text.
     The notification use keeps working either way.
   - **Google + Telegram must resolve to the same `auth.users`.** If a member
     signs in with Google once and Telegram another time, those are two
     `auth.identities` rows that MUST link to one `auth.users.id`, or they become
     two claimed members. This relies on Supabase **account-linking**, keyed on a
     verified shared factor (e.g. email) or an explicit "link account" step — it
     is *not* automatic across dissimilar providers.
   - **The claim/match rule is explicit, not implicit.** An anonymous OAuth login
     is matched to its intended `members` row by a defined mechanism — carried
     forward from the current invite-email claim
     ([architecture.md](architecture.md#data-model-supabase-production-only)):
     Google → invite-email match; Telegram → handle-match against
     `members.telegram` **or** an invite. Matching is never "same display name".
   - **Rationale (rejected alternative):** treating each provider login as its own
     identity (no linking) was rejected — it fragments one person into several
     claimed members, breaking `self`, cross-team load and clash (which all
     assume one identity per human, Design Decision 2). The member registry is the
     canonical person; providers are *credentials that resolve to it*, never
     identities in their own right.
   - **Phase note:** local YAML mode has no auth, so Phase 1 stores `telegram` as
     today and needs no `auth.users`. This decision constrains **Phase 3** and the
     `0004_tenants_teams.sql` shape (keep `claimed_user_id` the single auth FK;
     leave room for `member_identities` / provider linking) so Phase 1's registry
     shape does not paint us into a corner.

## Data-model changes (Supabase, Phase 3)

New/changed tables (all RLS-scoped to the tenant):

| Table | Purpose | Notes |
| --- | --- | --- |
| `tenants` | org boundary | `id, name, created_at` |
| `tenant_users` | **RBAC** (replaces the per-roster owner/editor/viewer grant) | `(tenant_id, user_id, role)` where role ∈ `owner/admin/viewer` (governance roles; `self` is an orthogonal automatic relation, not stored here — see [permissions.md](permissions.md#target-model-planned-tenant-scoped--not-yet-built)); a user can hold different roles in different tenants |
| `members` | tenant member registry (people) | `id, tenant_id, name, telegram, avatar, claimed_user_id → auth.users` (nullable — onboarding "claim" links identity). **Multiple login providers (Google, Telegram) resolve to one `auth.users` → one member** via Supabase account-linking; `claimed_user_id` stays the single auth FK — see Design Decision 6. |
| `member_constraints` | **global** per-member unavailability | `(member_id)` → date list/ranges; tenant-scoped |
| `teams` | scheduling unit | `id, tenant_id, name, colour/gradient` |
| `team_members` | who's on a team + capability **on that team** | `(team_id, member_id, roles jsonb, understudy_for jsonb, include bool)` |
| `rosters` | schedule document (existing) | **gains `team_id`**; RBAC moves from `roster_members` to `tenant_users` (+ optional team scoping); keeps `document jsonb` |
| `roster_invites` | invite by email | re-scoped to **tenant** (invite a person to the org), team assignment separate |

**RBAC redesign.** The authorization model (permission-roles, the tenant-scoped
grant, the `self` relation, and the action matrix) is specified in its own file:
**[permissions.md](permissions.md#target-model-planned-tenant-scoped--not-yet-built)**.
In storage terms this file only records the *table* change: the current
`roster_members` + owner-guarded RPCs move **up to the tenant** — `tenant_users`
becomes the authority, and the `is_roster_member` / `roster_role_of`
`SECURITY DEFINER` helpers become `is_tenant_member(tenant)` /
`tenant_role_of(tenant)`, with roster/team RLS resolving the tenant from
`rosters.team_id → teams.tenant_id`. This preserves the load-bearing invariant
that **the database is the real authority and client flags are UI-only**. Also
note the **permission-role vs. team-role** split (see permissions.md): the
`team_members.roles` column is *schedulable capability*, never governance.

**Migration.** A new migration `0004_tenants_teams.sql` creates the tables and a
**backfill**: for each existing `rosters` row, create a tenant (owner = current
`owner_id`), a default team, hoist the document's embedded `members` into
`members` + `team_members`, hoist `member_constraints` to global, and rewrite
`document` to drop the member registry (keeping `events`, `roles`,
`roster_*`). `sample.yaml` and the JSONB shape both change → update in the same
change (feedback loop). Because ids inside `events[].roster[].member_id` are
preserved, assignments survive the hoist.

## Compatibility seam (how we avoid rewriting the engine)

The generator, eligibility checker, validators, stats, diff and the whole
`utils/` layer currently consume a **derived state** from one document
(`toState` → `{ members, events, roles, memberConstraints, … }`). We
keep that contract. The change is *where the pieces come from*:

- `toState` (local/YAML) learns to read the new nested shape and
  **resolve a single team's members** by joining `members` + `team_members`
  into today's normalized member objects (`{ id, name, roles, understudyFor,
  include }`), with `memberConstraints` pulled from the global member calendar.
- The Supabase provider does the same join server-side / in the loader and hands
  the engine the identical resolved shape.
- **One new optional input** threads through as an *addition*, defaulting to
  empty/no-op so all existing tests pass unchanged:
  - `externalAssignments`: a read-only snapshot of each member's assignments in
    *other* teams' rosters (`{ memberId: [dateOrDatetime, …] }`). It is the
    **single cross-team primitive** and drives both cross-team rules:
    - **clash detection** — interval-overlap between an external range and a
      candidate slot's range (see the datetime-range model in
      [data-layer.md](data-layer.md));
    - **cross-team caps** — the monthly/weekly/total "load" is *derived* by the
      same rollup `AssignmentTracker` already applies to local assignments. We do
      **not** pass a separate precomputed `externalLoad`: a stored count would be
      a second source of truth that can drift from the assignments it summarises
      (`externalLoad = fold(externalAssignments)`, a function, not an input).

  It is read-only and only consulted when the corresponding constraint is
  enabled, so single-team behaviour is byte-for-byte identical.

  > **Load derives from assignments (Design Decision).** Both intra-team and
  > cross-team, the **assignment list is the only source of truth** and every
  > count (`total`/`byMonth`/`byWeek`) is a fold over it — exactly what
  > `AssignmentTracker` does today. So the seam exposes assignments, not counts.

**Which teams count where (Design Decision).** The two cross-team rules use
cross-team data *asymmetrically*, on purpose:

- **Hard caps and clash are person-global** — `MAX_ASSIGNMENTS_PER_MONTH`,
  once-per-week, and same-time clash count **local + external**. Burnout and
  physical availability are properties of the *person*, not the team, so a
  member on three teams must not quietly get 3× the load or be double-booked.
- **Soft fairness stays team-local** — the `fairness` scorer (and spread /
  diversity) rank within the *current* team only. A member who is busy elsewhere
  but light here should not be artificially de-prioritised on this team; keeping
  optimisation team-local preserves team autonomy. The rule of thumb:
  **feasibility and burnout are global; optimisation quality is team-local.**

**Testing the seam (the acceptance test).** The strongest correctness signal is
that **every existing generator / `derivedState` / stats / validator test passes
unchanged** after the entity model lands — that proves the resolved shape is
truly identical to today's. So the seam's tests are: (1) keep the current suite
green with `externalAssignments` defaulting to no-op; (2) add
`toState` cases asserting a `members` + `team_members` join resolves to
the same `{ id, name, roles, understudyFor, include }` shape, that one member on
two teams resolves to different per-team `roles`, and that global
`member_constraints` flow in regardless of team. (Authorization is tested
separately — see
[permissions.md](permissions.md#testing-two-levels-mirroring-the-two-layer-authority).)

## Feature-by-feature impact analysis

Ordered by how much each is affected.

1. **Data layer / providers** (`architecture.md`, `data-layer.md`) — **high.**
   Contract gains a `tenant`/`team`/`activeTeamId` selection layer above
   `activeRosterId` (rosters are now listed *within a team*). `rosters` list
   becomes team-scoped; add `teams` list and `members` (registry) CRUD.
   Draft/commit/undo/diff per roster are **unchanged**.

2. **RBAC / RLS / admin RPCs** (`architecture.md` "Permissions model") —
   **high.** Authority moves to `tenant_users`; all owner-guarded RPCs re-scope
   to tenant; `AdminModal` becomes tenant/team management (members registry,
   team assignment, roles). Invites become tenant invites.

3. **Members UI** (`MembersView`) — **high.** Splits into *tenant registry*
   (identity, global unavailability, avatar, claim status) vs. *team membership*
   (capabilities/roles on this team, include flag). A member card shows which
   **other teams** they serve (cross-team visibility) and surfaces global
   unavailability.

4. **Generation & eligibility** (`generation.md`, `understudy.md`) — **medium.**
   Engine still runs **per roster/team** on the resolved member list; only the
   *input* grows (`externalAssignments`) and only when cross-team caps/clash
   constraints are on. Determinism (seeded) is preserved
   because external inputs are read-only snapshots. Understudy *capability
   declaration* stays per-team (`team_members.roles`/`understudy_for`), while
   understudy progress/seeding/promotion stay roster-specific and derived
   ([understudy.md](understudy.md#scope-what-is-team-level-vs-roster-level)).
   **Invariant to keep:** locked/pre-existing slots never move, still true.

5. **Constraints & validation** (`constraintPrimitives`, `swapPolicy`, `assignmentValidator`,
   `rosterSchema`) — **medium.** `isMemberUnavailable` fed the global calendar;
   `canSwapRosterSlots` and the manual-assignment picker gain an optional
   cross-team clash check; add tenant→team→roster constraint merge; new
   constraint keys: `ENFORCE_CROSS_TEAM_CAPS`, `ENFORCE_CROSS_TEAM_CLASH`, with
   sensible defaults (both off) so existing single-team rosters are unaffected.

6. **Roster statistics & availability heatmap** (`data-layer.md`,
   `events-ui.md`) — **medium.** Everything stays real-time and per roster.
   *New optional* views: a member's **cross-team load** (shifts across all
   teams) and clashes highlighted. The availability heatmap's "available"
   already means role-capable-AND-free; global unavailability flows in for free
   via the shared calendar. Optional future: tenant-level "who's overloaded
   across teams".

7. **Events UI / export** (`events-ui.md`, `data-layer.md`) — **low.**
   `event.roster` positional-array structure and export column layout are
   unchanged (still per roster). Clash badges are additive.

8. **Onboarding / bots / calendar** (`todo.md` backlog) — **enabled, not
   required now.** Tenant/team/member identity + `claimed_user_id` is the
   foundation the member-claim flow, per-team Telegram bot, team colour, and
   Google Calendar sync were waiting on. Out of scope for the first phases but
   the model is designed to accommodate them.

9. **Local YAML mode** (`data-layer.md`, `sample.yaml`) — **medium.** YAML gains
   a nested shape: top-level `tenant`/`members` (registry with global
   `unavailable_dates`) and `teams: [{ name, roles, members: [{ member_id,
   roles, include }], rosters: [{ start/end, events, roster_constraints }] }]`.
   Per `todo.md` "yaml only for local", production won't ingest YAML — but the
   **resolved derived-state shape stays identical** across modes, which is the
   point of the seam.

## Ratified decisions (review)

- **Governance roles this phase: `owner` / `admin` / `viewer`** (the `editor`
  role was dropped; member-only rights come from the orthogonal automatic `self`
  relation, and members can self-assign). See
  [permissions.md](permissions.md#target-model-planned-tenant-scoped--not-yet-built)
  for the axes, the action matrix, and the future owner-configurable defaults.
- **Team-roles / member capabilities are admin-managed**, never self-granted —
  the concrete encoding of the permission-role vs. team-role split.
- **Reviewed-publish UX is preserved under normalization.** The member registry
  and `team_members` become normalized rows, but edits to them are **staged as a
  draft and committed in one transaction** (one reviewed publish), rather than
  writing each row immediately. This keeps the [data-layer.md](data-layer.md)
  draft/commit contract's *feel* (edit → review → publish atomically) even though
  the underlying storage is rows, not a single JSONB blob. Rosters keep their
  JSONB document + existing per-roster draft/commit unchanged (Design Decision 5).
- **JSONB → normalized backfill is approved.** The `0004_tenants_teams.sql`
  migration includes the one-off backfill (below) from existing JSONB rosters
  into the normalized tenant/team/member tables before production flips over.

## Open questions (defer, not blocking the model)

- **Team-scoped governance** (a user who is `admin` of Team A only) — the model
  allows it (`tenant_users.role` + optional per-team scoping), but the first
  phase can ship tenant-wide roles first.
- **Tenant-level read-only `viewer`** vs. per-team-only viewer — deferred (also
  tracked in permissions.md).
- **Clash granularity**: date-only now; date+`reporting_time` later (needs a
  normalized time on events).
- **Cross-tenant members** (same human in two orgs) — explicitly *out*: a
  member belongs to exactly one tenant; two orgs = two member rows.
- **Provider-linking mechanism** (Phase 3): whether Telegram sign-in is a
  first-class Supabase auth provider or a `member_identities` side table, and the
  exact account-linking trigger (verified-email match vs. explicit "link
  account" step). The *decision* — many providers resolve to one `auth.users` →
  one member — is settled (Design Decision 6); only the encoding is deferred.
- **Versioning**: modelling roster *versions* as sibling rosters of a team is
  compatible with this design but specified separately.

## Phased delivery

Design is complete now; delivery is sequenced so each phase is shippable and
keeps `npx vitest run` + `npm run build` green.

- **Phase 0 — types & seam (no behaviour change). ✅ Landed.** The resolved
  derived-state is now the single contract via `resolveState(data,
  { externalAssignments })` in
  [`derivedState.js`](../src/state/derivedState.js) — a single-team identity pass
  over `toState` plus the empty/no-op cross-team assignments snapshot.
  `generateRoster` threads `externalAssignments` (defaulting `{}`) into the
  `EligibilityChecker`, which stored it unused until Phase 2 (now consulted by
  the cross-team cap/clash fold). `externalLoad` is
  deliberately *not* an input — load derives from the assignments snapshot. Tests
  lock in the no-op: the full suite stays green, `resolveState` is proven
  identical to `toState`, and an empty `externalAssignments` produces
  byte-for-byte identical generator output.
- **Datetime-range model + local clash (done — prerequisite for Phase 2 clash).**
  Events resolve to half-open `[start, end)` intervals so same-day non-overlapping
  events don't clash, and clash is interval-overlap — landed as the `no-clash`
  feasibility constraint enforced by the generator, validator and swap
  ([data-layer.md](data-layer.md) owns the interval semantics;
  [generation.md](generation.md#hard-constraints-one-authority-many-consumers)
  owns the registry). The rule is written once against intervals, so Phase 2's
  cross-team clash is the *same* rule extended to fold in `externalAssignments`,
  not a new one.
- **Phase 1 — local model. ✅ Landed.** New nested YAML shape + `toState`
  resolver + nested `sample_tenant.yaml`; MembersView split (registry vs. team
  membership); global unavailability; team selector above roster selector;
  events write-back into the tenant doc. The concrete Phase 1 contract — nested
  YAML shape, flat-shape back-compat rule, and the selection layer — is pinned in
  [Phase 1 contract](#phase-1-contract-local-model) below. Cross-team clash/caps
  enforcement is deferred to Phase 2 (the seam exists; only the enforcement is
  pending).
  - **Resolver + selection + nested sample: ✅ Landed.** `isTenantShape`,
    `tenantSelection` and `resolveTenant` in
    [`tenantResolver.js`](../src/state/tenantResolver.js) detect the nested shape and
    flatten a selected team+roster into today's flat document (registry ⋈
    `team_members`, global `unavailable_dates` — and its free-text `note` —
    → per-team `member_constraints`),
    which `toState` consumes unchanged. Flat input is returned untouched
    (`resolveTenant` is identity when there is no `teams` key) — all 352 prior
    tests still pass. The provider contract gained `teams` / `activeTeamId` /
    `selectTeam` above `rosters` / `activeRosterId` / `selectRoster`; the local
    provider holds the raw tenant doc and re-resolves the flat working document on
    selection, and App renders a team selector above the roster selector when a
    nested doc is loaded. [`public/sample_tenant.yaml`](../public/sample_tenant.yaml)
    is the canonical nested example (sibling of the flat `sample.yaml`); a
    validator test resolves *every* team+roster to a valid flat document.
  - **Write-back: ✅ Landed.** Committing an edit while a nested tenant doc is
    loaded also persists the events into the active roster INSIDE the tenant doc,
    so switching team/roster and returning preserves the edit.
    `withRosterEvents(tenantDoc, {teamId, rosterId}, events)` in
    [`tenantResolver.js`](../src/state/tenantResolver.js) is the pure inverse of
    `resolveTenant` for the events portion (returns a new doc; only the addressed
    roster's `events` change; identity for flat docs). The local provider's
    committed-events sink calls it via refs (the sink is captured by the draft
    hook) — see [`useLocalRosterProvider.js`](../src/data/useLocalRosterProvider.js).
    Scope note: only the **events** round-trip. Non-event edits (members, roles,
    roster overrides via the YAML editor) still apply to the flat working view
    only; durable per-team persistence of those lands with the Supabase provider
    in Phase 3.
  - **MembersView split: ✅ Landed.** Each member card now separates
    tenant-level IDENTITY (name, telegram, global unavailability — relabelled
    "Unavailable (global)" in a tenant context) from this team's CAPABILITY
    (roles/understudy), via a subtle divider labelled "on &lt;team&gt;". A
    read-only **"Also on: …"** line shows the OTHER teams a member serves —
    rendered only for members with multi-team membership. Cross-team visibility
    is derived by `memberTeams(tenantDoc)` in
    [`tenantResolver.js`](../src/state/tenantResolver.js) (member id → team names),
    exposed via the provider (`memberTeams`, `activeTeamName`) and threaded
    App → MembersView → MemberCard. In flat/single-team mode the divider, team
    label and "Also on" line are all absent, so single-team cards are unchanged.
- **Phase 2 — cross-team constraints.**
  - **Enforcement core: ✅ Landed.** Two new constraint keys in
    [`rosterSchema.js`](../src/schema/rosterSchema.js) —
    `ENFORCE_CROSS_TEAM_CAPS` and `ENFORCE_CROSS_TEAM_CLASH` — fold a member's
    `externalAssignments` (their assignments on OTHER teams) into the *same*
    counting/clash seam every consumer already reads, so no new rule is
    introduced. Both default **OFF** and the snapshot is empty in single-team
    mode, so single-team behaviour is byte-for-byte unchanged (locked by tests).
    - The fold helpers `externalEventsFor` / `externalWeeklyCount` /
      `externalMonthlyCount` live in
      [`constraintPrimitives.js`](../src/utils/constraintPrimitives.js) and derive
      every cross-team figure from the assignments snapshot (never a stored,
      drift-prone load). The `no-clash` descriptor now emits `params.external`
      so consumers can word a cross-team clash distinctly.
    - **Caps depend on the local cap.** `ENFORCE_CROSS_TEAM_CAPS` only *adds* the
      external week/month load to `weeklyCount` / `monthlyCount`; those counts
      are consulted only when the LOCAL `ONLY_ONCE_PER_WEEK` /
      `MAX_ASSIGNMENTS_PER_MONTH` are themselves enabled. It does not force those
      rules to run. (Rationale: the cap threshold is a local policy; cross-team
      caps change *what counts toward it*, not *whether it applies*.)
    - **Cross-team clash BLOCKS during generation.** Unlike a soft warning, a
      cross-team clash is a feasibility failure (a person can't be in two
      overlapping events across teams), so the generator's `EligibilityChecker`
      OR-s `ENFORCE_CROSS_TEAM_CLASH` into the `no-clash` run condition (a
      `forceRun` seam) and the swap validator folds externals into its
      always-on clash scan. The validator surfaces a cross-team weekly overage
      even when there is no OTHER *local* in-week event (it would otherwise drop
      the error silently).
    - **Constraint/preference merge chain: ✅ Landed.** `resolveTenant` merges
      `roster_constraints` / `roster_preferences` **tenant → team → roster**
      (later wins) via the `mergeLayers` helper in
      [`tenantResolver.js`](../src/state/tenantResolver.js), mirroring today's
      `DEFAULT → document` merge one level deeper. It emits the merged object
      only when a layer supplied one, so flat single-team docs are unchanged.
  - **Data-sourcing + auto-enable + UI: ✅ Landed.** The read-only
    `externalAssignments` snapshot is derived from the tenant document by
    `deriveExternalAssignments(data, { teamId })` in
    [`tenantResolver.js`](../src/state/tenantResolver.js): it gathers every placed
    date on the rosters of **other** teams, keyed by member id. "External" is
    scoped to the active TEAM (not roster) — a team's own sibling rosters are
    excluded, because they are different periods of the same team and the local
    week/clash logic is already period-scoped (counting them would double-count).
    The local provider ([`useLocalRosterProvider.js`](../src/data/useLocalRosterProvider.js))
    computes it for the active team and exposes it on the provider contract;
    [`App.jsx`](../src/App.jsx) threads it into `generateRoster`,
    `validateEventAssignments` and `explainSwap`.
    - **Invariant — a team's rosters partition time (must not overlap).** The
      "exclude sibling rosters" rule above is only sound if a team's rosters
      cover *disjoint* date periods. If two sibling rosters overlapped, a genuine
      within-team double-booking spanning both would be silently dropped
      (excluded as "sibling", and each roster is validated in isolation).
      `validateTenantRosters(data)` in
      [`tenantResolver.js`](../src/state/tenantResolver.js) enforces this: on import
      the local provider surfaces a **non-fatal warning** (through the same
      `data.warnings` channel the UI already shows) naming any two overlapping
      rosters on a team. Overlap is inclusive on calendar days (sharing a
      boundary day counts). It is a warning, not a hard error, because a
      malformed period should not block loading the rest of the document — but it
      must not pass silently.
    - **Auto-enable for multi-team tenants.** `resolveTenant` turns both
      cross-team keys ON as the **lowest-precedence** layer of the merge chain
      **iff the tenant has >1 team**, so any explicit tenant/team/roster YAML
      still overrides them and a single-team tenant leaves them off (nothing to
      be cross-team about) — single-team output stays byte-for-byte identical.
    - **UI surfacing reuses the existing validation renderer.** A cross-team
      clash is already emitted by the validator as an error string ("… rostered
      on another team …"); it flows through the per-event error badges and the
      issue summary in [`EventsView.jsx`](../src/components/EventsView.jsx) with
      no new component (isolated-vs-shared: reuse, don't duplicate).
  - **Deferred (follow-ups):** a dedicated cross-team *load* view in stats (the
    clash badges are done); production wiring of `externalAssignments` in the
    Supabase provider (a `{}` stub today) lands with Phase 3.
- **Phase 3 — production (Supabase).** `0004_tenants_teams.sql` (tables, RLS
  re-scoped to tenant, RPCs, backfill migration), provider join to the resolved
  shape, tenant/team admin UI. **RLS/RPC tests run against the local Supabase
  stack** (`supabase start` + `supabase db reset`), preferably in pgTAP — see
  [permissions.md](permissions.md#testing-two-levels-mirroring-the-two-layer-authority).
  Update `architecture.md` data-model + permissions sections in the same change.

Each phase updates the relevant binding spec files and this file's status per
[`../AGENTS.md`](../AGENTS.md).

## Phase 1 contract (local model)

This section pins the three things Phase 1 must implement so the work can start
without re-deciding shape mid-implementation. It is binding for Phase 1.

### 1. Canonical nested YAML shape (full tenant in one file)

A tenant document is one YAML file. The **member registry lives at tenant level**
(identity + *global* `unavailable_dates`); **capability lives per team** on
`team_members`; each team owns its `roles` catalog and one or more `rosters`,
each a schedule document identical in shape to today's flat document minus the
embedded member registry. Field names reuse the existing constants
([`YAML_FIELDS`](../src/schema/rosterSchema.js)) so the resolver and validators
are shared, not forked.

```yaml
tenant:
  name: "Grace Community"

# Tenant-level member registry — the PEOPLE. Identity + GLOBAL constraints only.
# No per-team capability here (that lives on each team's team_members).
members:
  - id: member-1-alice
    name: Alice Johnson
    telegram: "@alice"
    # Global unavailability — every team/roster that references Alice sees this.
    unavailable_dates:
      - "2026-02-14"
      - start: "2026-03-05"
        end: "2026-03-10"
  - id: member-2-bob
    name: Bob Smith
    telegram: "@bob"

teams:
  - name: "Worship"
    # Per-team role catalog. Two teams may share a role NAME by coincidence;
    # they are not the same role.
    roles:
      - name: lead
      - name: support
    # Which registry members are on THIS team + their capability ON this team.
    # roles / understudy flag / include are team-local (Design Decision 2).
    team_members:
      - member_id: member-1-alice
        include: true
        roles:
          - name: lead
          - name: support
      - member_id: member-2-bob
        include: true
        roles:
          - name: support
          - name: lead        # training for lead on THIS team
            understudy: true
    # A team can have MANY rosters (Design Decision 1). Each roster is today's
    # document shape: roster period + events (+ optional roster_constraints /
    # roster_preferences / member_preferences overrides).
    rosters:
      - roster:
          start_date: "2026-02-01"
          end_date: "2026-03-31"
        events:
          - name: "Weekend Service"
            date: "2026-02-07"
            roster:
              - role: lead
                member_id:
              - role: support
                member_id:
        # Optional per-roster overrides (merged over team, then tenant defaults).
        roster_constraints:
          MAX_ASSIGNMENTS_PER_MONTH: 3
  - name: "Hospitality"
    roles:
      - name: host
    team_members:
      - member_id: member-1-alice   # same person, DIFFERENT team → different roles
        include: true
        roles:
          - name: host
    rosters:
      - roster:
          start_date: "2026-02-01"
          end_date: "2026-03-31"
        events: []
```

Notes that make this non-ambiguous:

- **`members[].unavailable_dates`** replaces the flat file's top-level
  `member_constraints` list — unavailability is now a property of the person, so
  it sits on the registry row (Design Decision 4, global unavailability). The
  resolver feeds it into `memberConstraints` for *every* team the member is on.
- **`team_members[]`** is the join: `member_id` references a registry `id`;
  `roles` (with the `understudy: true` object form) and `include` are exactly
  today's per-member fields, just relocated. A member absent from a team's
  `team_members` is simply not on that team.
- **`teams[].rosters[].member_overrides[]`** (optional) is the *per-roster*
  escape hatch for a member's **active status**. A team's `roles` catalog and
  `team_members` are shared across all of that team's rosters, but whether a
  member is *active* can genuinely differ per period (e.g. someone joins mid-year,
  or sits out a quarter). Each override is `{ member_id, include }` and wins over
  the `team_members` `include` for **that roster only**; a member with no override
  keeps the team default. This is deliberately scoped to `include` (not `roles`):
  *capability* is a stable team-level fact, *availability to serve this period* is
  the thing that varies. (Global calendar `unavailable_dates` still handles
  date-level absence; `member_overrides` handles a whole-period opt-out without
  editing the registry.) A member absent from the team entirely for a period is
  modelled as `include: false` on both `team_members` (default) and/or the
  roster override — the resolver still lists them (so cross-team "Also on"
  visibility is intact) but the engine treats `include: false` as opted out.
- **`teams[].rosters[]`** each hold `roster` (period), `events`, and optional
  `roster_constraints` / `roster_preferences` / `member_preferences`. These are
  the *same* keys as the flat document; [data-layer.md](data-layer.md) still owns
  their semantics — this section only owns *where they nest*.
- Member `roles` accept the object form and a bare string exactly as today
  (`normalizeMemberRoles`); the nested shape does not change that.

### 2. Flat shape stays working (back-compat rule)

**A flat document (today's `sample.yaml`) is a valid tenant.** The resolver
detects shape and, when there is no top-level `teams` key, treats the whole
document as a **single default tenant → single default team → single default
roster**:

- top-level `members` (with embedded `roles`) + top-level `member_constraints`
  are lifted into that one team's `team_members` + the registry's global
  `unavailable_dates`;
- top-level `roles`, `events`, `roster`, `roster_constraints`,
  `roster_preferences`, `member_preferences` become that single roster.

This is a *read-time* adaptation, not a migration: the flat file is not
rewritten. The **acceptance test is that every existing fixture and the current
flat `sample.yaml` parse, validate, and resolve byte-for-byte identically** —
same resolved `{ members, events, roles, memberConstraints, … }` — which is the
same no-op guarantee the [compatibility seam](#compatibility-seam-how-we-avoid-rewriting-the-engine)
already established for `externalAssignments`. `sample.yaml` gains a *sibling*
nested example (or a second sample) demonstrating the tenant shape without
removing the flat one, so both code paths stay exercised.

Detection is by the presence of `teams:` at the top level (nested) vs. its
absence (flat). No version flag; the shapes are structurally distinguishable.

### 3. Team/roster selection contract

The provider contract ([`providerContract.js`](../src/data/providerContract.js))
today exposes `rosters`, `activeRosterId`, `selectRoster(id)`, `createRoster`,
and `LOCAL_PERMISSIONS`. Phase 1 adds a **team-selection layer above roster
selection**, mirroring that shape one level up:

- `teams: [{ id, name }]` — the tenant's teams.
- `activeTeamId` — the currently selected team; `rosters` becomes the
  **active team's** rosters (team-scoped list), and `activeRosterId` selects
  within it.
- `selectTeam(id)` — switches team. Switching team resets `activeRosterId` to
  that team's first roster (a team always has ≥1 roster).
- `members` (registry) is **tenant-level**, not team-scoped: it is the same list
  regardless of `activeTeamId`; per-team capability is resolved via the active
  team's `team_members` when building derived state.

Invariant: **the engine still receives one resolved single-team derived state**
— `activeTeamId` + `activeRosterId` together pick exactly one roster document,
which `toState` resolves (joining the registry with that team's
`team_members`) into today's normalized shape. The selection layer is UI/provider
state; it does not change the engine contract (Design Decision 5 and the
compatibility seam). In the flat/default case there is exactly one synthetic team
and `selectTeam` is a no-op, so single-team UX is unchanged.
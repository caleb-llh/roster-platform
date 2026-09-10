# Permissions model

> Scope of this file: **who may do what, and how it is enforced.** This is the
> single home for the RBAC/authorization model — the governing principle, the
> role definitions, the action matrix, and the two-layer (DB vs. UI) enforcement
> invariant. The **data/entity model** it acts on lives in
> [architecture.md](architecture.md#data-model) (current) and
> [multi-tenant.md](multi-tenant.md) (target hierarchy); the **members-editing
> feature** that consumes these checks lives in its own feature plan. Those
> files link here rather than restating permissions, so the model is defined
> once.

## Guiding principle

> **A permission is a function `(actor, action, target)` → boolean, where the
> `target` is a node in the scope tree and roles are granted at a scope level.**
> A check resolves the actor's role *at or above* the target's scope, then asks
> whether that role grants the action on that target's type.

Everything below is an application of that sentence. The scope tree (current:
`roster → {events, members, assignments}`; target: `tenant → team → roster → …`)
is defined in the data-model specs; this file only assigns actions to roles on
those nodes.

## Two role axes that must not be conflated

The word "role" is overloaded. They are permanently separate concepts with
separate types, columns, and code paths:

- **Permission-role (governance):** *what a person may do in the app* — currently
  `owner` / `editor` / `viewer` (per-roster); in the target model `owner` /
  `admin` / `viewer` plus the orthogonal automatic `self` relation. This is the
  RBAC axis; it is what this document is about.
- **Team-role (schedulable capability):** *what a person can be rostered as* —
  `main-cam`, `vm`, `roving-cam`, …. This is **domain data** (per team), drives
  eligibility and generation, and has nothing to do with authorization. It lives
  on the member's team membership (`team_members.roles` in the target model), not
  on any RBAC table.

**Invariant:** editing a member's `team_roles` is a *data* edit gated by a
*permission-role*; a permission-role is never stored in, or derived from, a
team-role. Conflating them (e.g. treating "main-cam" as if it granted edit
rights) is a bug.

---

## Current model (implemented, roster-scoped)

Three per-roster permission-roles form the RBAC (`public.roster_role` enum):
**owner**, **editor**, **viewer**. Role is stored per `(roster_id, user_id)` in
`roster_members`; a user can hold different roles on different rosters, so
permissions are always relative to the **active roster** (the current scope
node). There is **no `self` relation in this model** — self-service (a member
managing their own record/assignments) is a *target-model* addition and does not
exist yet.

**Two layers enforce it, and the split is the load-bearing invariant:**

1. **The database (RLS) is the real authority.** Every access is gated by the
   policies in `0001_init.sql` and the owner-guarded RPCs — a hostile or buggy
   client cannot exceed its role because Postgres re-checks on every row.
2. **Client permission flags are UI-only.** Components gate on `permissions`
   (never on the mode), so a viewer sees a read-only UI — but if the flags ever
   disagreed with the DB, the DB wins (the mutation returns `{ ok:false,
   errors }`). The flags exist only to shape the UI ahead of the round-trip, not
   to secure anything.

**Client flags** (`RosterPermissions` in
[`providerContract.js`](../src/data/providerContract.js)) derived from role in
[`useSupabaseRosterProvider.js`](../src/data/useSupabaseRosterProvider.js):

| Flag | Grants | owner | editor | viewer |
| --- | --- | :-: | :-: | :-: |
| `canEditRoster` | insert/remove/replace/swap assignments, generate | ✓ | ✓ | |
| `canImport` | import/replace the whole document (seed), open the YAML drawer | ✓ | | |
| `canUndo` | undo the last change | ✓ | ✓ | |

Local mode grants all three (`LOCAL_PERMISSIONS`, a single-user sandbox). Admin
actions (add/remove members, change roles, invite) are **owner-only** and have no
client flag — they're guarded server-side by the owner-guarded RPCs and simply
not surfaced in the UI for non-owners.

**Server-side enforcement** — what each role can actually do, and the policy that
enforces it:

| Capability | owner | editor | viewer | Enforced by |
| --- | :-: | :-: | :-: | --- |
| Read the roster `document` | ✓ | ✓ | ✓ | `rosters_select_members` (via `is_roster_member`) |
| Update the roster `document` | ✓ | ✓ | | `rosters_update_editors` (`roster_role_of ∈ {owner,editor}`) |
| Create a roster (become its owner) | ✓ | — | — | `rosters_insert_owner` + `add_owner_membership` trigger; `create_roster` RPC |
| Delete a roster | ✓ | | | `rosters_delete_owner` (`owner_id = auth.uid()`) |
| Read the member list | ✓ | | | `list_roster_members` RPC is **owner-only** (raises otherwise), even though the `members_select_own_rosters` RLS policy would let any member `SELECT` the raw table |
| Add / remove members, change roles, invite / revoke | ✓ | | | `members_write_owner` (`roster_role_of = 'owner'`) + owner-guarded RPCs (each raises `'Only the roster owner …'`) |

The owner cannot remove themselves (`remove_member` raises), so a roster always
has an owner. Today a roster has **exactly one** owner (the creator, via
`add_owner_membership`); the target model generalises this to **≥1** owner with a
"can't remove the last owner" rule (see below). `anon` (not signed in) gets
nothing — production requires login, so there is no unauthenticated read path.
Because a policy on `roster_members` cannot itself `SELECT` from `roster_members`
without infinite recursion, all role checks go through the `SECURITY DEFINER`
helpers `is_roster_member` / `roster_role_of` (RLS bypassed inside them), which
are the single source of truth the policies call.

---

## Target model (planned, tenant-scoped) — not yet built

When the [multi-tenant hierarchy](multi-tenant.md) lands, governance moves **up
to the tenant** and gains a `self` relation for member self-service. This section
is the RBAC half of that plan (the entity/storage half stays in
[multi-tenant.md](multi-tenant.md)).

The model has **two orthogonal axes**, and they must not be flattened into one
ladder:

- **Granted permission-role** (governance) — assigned to a user at **tenant**
  scope (`tenant_users(tenant_id, user_id, role)`): **`owner`**, **`admin`**, or
  **`viewer`**. A user can hold different roles in different tenants.
- **The `self` relation** (own-record capability) — *not* a role and not on the
  ladder. It is the per-target condition `member.claimed_user_id ===
  actor.user_id`. **It is automatic for any claimed member** (a member whose
  account is linked), regardless of — and in *addition* to — any granted role.
  It is what lets a member manage their **own** stuff. Until a member is claimed,
  `self` is simply never true for them.

**Why only two granted roles (`editor` was dropped).** Every action that a
would-be `editor` needed splits cleanly onto one of the two axes: *governance*
actions belong to `owner`/`admin`, and *"manage only my own"* actions belong to
`self` — which every logged-in member already has. A separate team-wide
"curator who edits everyone's schedule but governs nothing" had **no stated
need**: schedules are either self-served by members or built by governance
(`admin`). Keeping `editor` would have been an unproven third tier
(the anti-over-engineering rule). If a real "edits everyone's schedule, governs
nothing" need appears, it re-enters cleanly as a role whose matrix column is
"all `roster:*` + `member:edit-*`, no `team:*`".

- **`owner`** — the tenant/team owner: everything `admin` can do, plus
  destructive/ownership actions (delete team/roster, manage tenant users,
  transfer ownership). A tenant may have **multiple** owners; there is always ≥1
  (can't remove the last owner).
- **`admin`** — **team governance**: members (add/remove/active), team-role
  catalog + each member's capabilities, the team-facing note, schedule editing
  for the whole team, and the future team-tied **bots** and **reminders**.
- **`viewer`** — read-only.
- **`self`** (claimed member, automatic) — manage own record: edit own profile,
  own availability, and **self-assign / self-unassign to event slots** (subject
  to the same eligibility + swap rules as any assignment).

**Resolver.** The coarse `permissions` booleans are superseded by a single
authority:

```
can(action, target) => boolean
```

- `target` carries a node type + ids, e.g.
  `{ type:'member', id, tenantId, claimedUserId }`, `{ type:'assignment',
  eventId, memberId, tenantId }`, or `{ type:'roster', id, tenantId }`.
- The resolver reads the actor's `tenant_users.role` for `target.tenantId` **and**
  evaluates the `self` relation for member/assignment targets, then consults the
  matrix below. `self` is additive: a `viewer`-roled member still gets the `self`
  actions on their own record.
- `permissions.canEditRoster` / `canImport` / `canUndo` remain as **derived
  convenience booleans** over `can()`, so existing call sites keep working while
  `can()` becomes the source of truth. (Same "one authority + thin wrappers"
  pattern as `canSwapRosterSlots` over `explainSwap`.)

**Action matrix** (granted-role columns + the orthogonal `self` column). Target
type in the second column.

| Action | target | owner | admin | viewer | self |
| --- | --- | :-: | :-: | :-: | :-: |
| `member:view` | member | ✓ | ✓ | ✓ | ✓ |
| `member:edit-profile` | member | ✓ | ✓ | | ✓ |
| `member:edit-availability` | member | ✓ | ✓ | | ✓ |
| `member:edit-team-roles` | member | ✓ | ✓ | | ✗ |
| `member:edit-note` | member | ✓ | ✓ | | |
| `member:set-active` | member | ✓ | ✓ | | |
| `member:add` | team | ✓ | ✓ | | |
| `member:remove` | member | ✓ | ✓ | | |
| `member:link-user` | member | ✓ | ✓ | | |
| `roster:edit` (any member's slots) | roster | ✓ | ✓ | | |
| `roster:assign-self` (own slots only) | assignment | ✓ | ✓ | | ✓ |
| `roster:import` | team | ✓ | ✓ | | — |
| `roster:undo` | roster | ✓ | ✓ | | — |
| `team:manage-roles` | team | ✓ | ✓ | | — |
| `team:manage-bots` | team | ✓ | ✓ | | — |
| `team:manage-reminders` | team | ✓ | ✓ | | — |
| `team:delete` | team | ✓ | | | — |
| `tenant:manage-users` | tenant | ✓ | | | — |

Notes on the encoding (decisions ratified in review):

- **`self` is the "manage only my own" tier.** `roster:assign-self` lets a member
  add/remove **themselves** to/from a slot they're eligible for (right team-role,
  available, not double-booked). Self-assign is an *add-to-empty-slot* (and its
  inverse), not a swap, so it reuses the **eligibility** half of the swap
  logic — the per-member `rejection()` checks inside `explainSwap`
  ([`swapPolicy.js`](../src/evaluation/swapPolicy.js)), i.e. the same hard
  constraints the generator's `EligibilityChecker` enforces — not the two-sided
  swap wrapper. It is scoped to `target.memberId === actor's claimed member`.
  `roster:edit` (any member's slots) stays governance-only. This is the
  self-serve-signup model.
- **Team-roles / capabilities are admin-managed** (`member:edit-team-roles` =
  `owner`/`admin`, **never** `self`): a schedulable capability ("Alice can lead
  main-cam") is a governance decision, not self-granted. Concrete encoding of the
  permission-role vs. team-role split above.
- **A member editing their own info** = the `self` column: own profile + own
  availability + own slot assignments only — never the admin note, active-toggle,
  add/remove, or their own team-roles.
- **`bots` and `reminders`** are team-scoped governance targets (future), managed
  by `admin`+`owner` like every other team-configuration action.

**Enforcement** is unchanged in principle: DB (RLS) remains the real authority;
`can()` is UI-only. The tenant-scoped tables get RLS keyed on `tenant_users.role`
via `SECURITY DEFINER` helpers (`is_tenant_member(tenant)` /
`tenant_role_of(tenant)`), plus the `self` check
(`members.claimed_user_id = auth.uid()`). Migration details are in
[multi-tenant.md](multi-tenant.md#data-model-changes-supabase-phase-3).

### Testing (two levels, mirroring the two-layer authority)

Authorization is tested at **both** enforcement layers, and one must never be
mistaken for the other (the load-bearing invariant above):

- **`can(action, target)` — Vitest, pure.** `can()` is a pure resolver over the
  policy table, so it is tested exactly like the other pure utils
  ([`derivedState.test.js`](../src/state/derivedState.test.js) pattern): a new
  `permissions.test.js` drives the **action matrix** as a `describe.each` table —
  one row per (role, action, target, self?) → expected boolean. It must cover the
  non-obvious cells: **`self` is additive** (a `viewer`-roled member still gets
  the `self` actions on their **own** record); **`self` never grants
  `member:edit-team-roles`**; **owner-only** actions (`tenant:manage-users`,
  `team:delete`); and a **configurable-defaults** case — override one policy-table
  cell and assert `can()` reflects it (proving overrides are data, not code).
  `roster:assign-self`'s **eligibility** cases live with the `explainSwap`
  `rejection()` tests in
  [`swapPolicy.test.js`](../src/evaluation/swapPolicy.test.js) (it reuses
  those checks — see the note above), not here.
  > These are **UI-shaping** tests. Passing `can()` tests do **not** prove a
  > client can't exceed its role — only the DB does. Treating them as security
  > tests would recreate the very conflation this file warns against.

- **RLS policies + `SECURITY DEFINER` helpers — the real authority, DB harness.**
  The client cannot be trusted, so the actual authorization guarantee is proven
  against a **running Postgres**, not in Vitest. Use the **local Supabase stack**
  the repo already ships (`supabase start` brings it up on `:54322`;
  `supabase db reset` applies every migration under `supabase/migrations/`). The
  tests set the acting identity (e.g. `SET LOCAL role authenticated` +
  `request.jwt.claim.sub`) and assert the policy outcome:
  - a `viewer` is **denied** `UPDATE rosters`; an `owner`/`admin` is allowed.
  - `tenant_role_of(tenant)` / `is_tenant_member(tenant)` return the right role
    (and don't recurse — the reason they are `SECURITY DEFINER`).
  - **last-owner protection**: removing the final owner raises.
  - the **`self`** predicate (`members.claimed_user_id = auth.uid()`) gates
    own-record writes and nothing else.

  Prefer **pgTAP** (Supabase's supported in-DB test framework) so assertions run
  where the policies do. This DB layer has **no coverage today** — writing it is
  part of the Phase-3 migration work
  ([multi-tenant.md](multi-tenant.md#phased-delivery)), and until it exists the
  RLS gap is called out here rather than left silent.

### Configurable defaults (future)

The matrix above is the **default policy**, not a hard-coded law. A future
**settings page** lets a tenant/team `owner` adjust which role grants which
action (within safe bounds — e.g. `owner`-only actions like `tenant:manage-users`
and last-owner protection stay fixed). The `can(action, target)` resolver is
designed for this: it reads a policy table (defaulting to this matrix) rather than
hard-coding role checks at call sites, so overriding a default is a data change,
not a code change. Until that page exists, the defaults are the policy.

### Resolved decisions (review)

1. **`editor` role dropped.** Replaced by two axes: governance (`owner`/`admin`)
   + the automatic orthogonal `self` relation. No unproven team-wide-curator tier.
2. **`self` is automatic for claimed members and orthogonal to roles** — even a
   `viewer`-roled member manages their own record.
3. **Members can self-assign** (`roster:assign-self`), eligibility-gated — the
   self-serve-signup model.
4. **`self` cannot edit own team-roles** — capabilities are admin-managed.
5. **Permissions become owner-configurable** via a future settings page; the
   matrix is the default policy.

### Still open

- Tenant-level read-only `viewer` vs. per-team-only `viewer` — deferred.
- Safe-bounds list for the configurable-defaults page (which actions are
  non-overridable) — specify when the settings page is built.

# Multi-tenant persistence (Supabase) — plan

> **Status: PLANNING (Supabase persistence not built).** The tenant → team →
> roster hierarchy, member registry, cross-team constraints and the local YAML
> resolver are **built and present-tense** in
> [multi-tenant.md](multi-tenant.md) — that is the binding spec. This plan owns
> only the **remaining unbuilt work**: persisting the nested shape in Supabase
> (tables, RLS, RPCs, backfill) and the one identity detail deferred with it.
> When this lands, fold its durable decisions into the owning specs
> ([multi-tenant.md](multi-tenant.md), [architecture.md](architecture.md),
> [permissions.md](permissions.md)) as present-tense behaviour and delete this
> plan, per [`../AGENTS.md`](../AGENTS.md) and the plan-doc convention in
> [README.md](README.md).

## Scope

Local YAML mode runs the full hierarchy today (nested shape, resolver +
selection, cross-team enforcement, events write-back). The engine consumes the
resolved single-team derived state either way, so the *behaviour* is spec'd; the
gap is **durable production storage**. This plan covers moving the nested shape
into Supabase without changing the resolved contract the engine reads.

## Work items

### 1. Schema migration `0004_tenants_teams.sql`

Create the normalized tables specified in
[multi-tenant.md](multi-tenant.md#supabase-data-model) — `tenants`,
`tenant_users`, `members`, `member_constraints`, `teams`, `team_members`,
`rosters` (gaining `team_id`), `roster_invites` (re-scoped to tenant) — all
RLS-scoped to the tenant.

### 2. RLS + RPC re-scope

Move authority from `roster_members` up to `tenant_users`: the owner-guarded
RPCs re-scope to tenant, and the `is_roster_member` / `roster_role_of`
`SECURITY DEFINER` helpers become `is_tenant_member(tenant)` /
`tenant_role_of(tenant)`, with roster/team RLS resolving the tenant from
`rosters.team_id → teams.tenant_id`. This preserves the invariant that the
database is the real authority and client flags are UI-only. The full
authorization model is owned by [permissions.md](permissions.md); this item is
its storage/RLS realization.

### 3. Backfill

A one-off backfill from existing JSONB rosters into the normalized tables before
production flips over: for each existing `rosters` row, create a tenant (owner =
current `owner_id`), a default team, hoist the document's embedded `members` into
`members` + `team_members`, hoist `member_constraints` to global, and rewrite
`document` to drop the member registry (keeping `events`, `roles`, `roster_*`).
`sample.yaml` and the JSONB shape both change → update in the same change
(feedback loop). Because ids inside `events[].slots[].member_id` are preserved,
assignments survive the hoist.

### 4. Provider join + admin UI

The Supabase provider does the `members` + `team_members` join server-side / in
the loader and hands the engine the identical resolved shape (the same one the
local resolver produces). `externalAssignments` — a `{}` stub in the Supabase
provider today — is wired to the tenant-wide assignment index. Build the
tenant/team admin UI (members registry, team assignment, roles) as the
tenant-scoped successor to `AdminModal`.

### 5. Provider-linking encoding (deferred identity detail)

The *decision* is settled — many login providers resolve to one `auth.users` →
one member (Design Decision 6 in [multi-tenant.md](multi-tenant.md)). The
remaining choice is the **encoding**: whether Telegram sign-in is a first-class
Supabase auth provider or a `member_identities (member_id, provider,
provider_uid)` side table, and the exact account-linking trigger (verified-email
match vs. an explicit "link account" step). Keep `claimed_user_id` the single
auth FK and leave room for `member_identities` so the shape does not paint the
persistence layer into a corner.

## Testing

RLS/RPC tests run against the local Supabase stack (`supabase start` +
`supabase db reset`), preferably in pgTAP — mirroring the two-layer authority per
[permissions.md](permissions.md#testing-two-levels-mirroring-the-two-layer-authority).
This DB-authority layer has **no coverage yet**; writing it is part of this
migration work, tracked here rather than left silent.
The resolver's acceptance guarantee still holds: the Supabase-resolved shape must
be byte-for-byte identical to the local-resolved shape, so the existing
generator / `derivedState` / stats / validator suite stays green unchanged (the
no-op guarantee from the [compatibility seam](multi-tenant.md#compatibility-seam)).

When this lands, update `architecture.md`'s data-model + permissions references
and fold the durable parts here into the owning specs in the same change.

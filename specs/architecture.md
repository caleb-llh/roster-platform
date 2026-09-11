# Architecture (binding spec)

The system-level view — including **context you cannot recover from the code
alone** (Supabase project setup, OAuth, deployment). Behaviour-level decisions
live in the sibling spec files; this file explains *how the pieces fit and where
the off-repo dependencies are*.

## One app, two data modes

Roster Platform is a single React + Vite SPA that runs in one of two modes,
selected **once at startup** and constant for the app's lifetime:

- **Local** — a login-free, in-memory YAML playground. Nothing is persisted; a refresh starts fresh. Every permission is granted.
- **Production** — rosters are read/written from **Supabase**, behind Google sign-in and row-level security.

**Mode selection** is purely a function of two build-time env vars
([`src/data/mode.js`](../src/data/mode.js)):

```js
export function detectMode() {
  const url = import.meta.env?.VITE_SUPABASE_URL
  const anonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY
  return url && anonKey ? 'production' : 'local'
}
```

If **both** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are present → `production`; otherwise → `local`. This is why the repo ships a usable playground with zero configuration, and why turning on production is just an env change (no code branch to flip).

## The provider contract is the seam

Components never check the mode. They depend only on the **`RosterProvider`
contract** ([`src/data/providerContract.js`](../src/data/providerContract.js))
and gate behaviour on `permissions`. A single dispatcher hook picks the
implementation ([`src/hooks/useRosterData.js`](../src/hooks/useRosterData.js)):

```js
const local = mode === 'local' ? useLocalRosterProvider() : null
const production = mode === 'production' ? useSupabaseRosterProvider() : null
return local ?? production
```

(Mode is constant, so calling one hook per render is Rules-of-Hooks-safe.)

Both providers implement the same surface:

- **State:** `data`, `originalData`, `error`, `loading`, `hasGenerated`, `actionLog`.
- **Draft/history:** `draftEvents`, `effectiveEvents` (= `draftEvents ?? data.events`), `hasUncommitted`, `canUndo`, `canRedo`. The draft/undo/redo logic is shared as pure transitions in [`useDraftHistory.js`](../src/session/useDraftHistory.js) so both modes behave identically (see [data-layer.md](data-layer.md)). *(This is a **Session** concern; it currently still lives inside the providers — the target is to lift it above them. See [architecture-overhaul.plan.md](architecture-overhaul.plan.md).)*
- **Permissions/roles:** `permissions` (`{ canEditRoster, canImport, canUndo }`), `role` (`'owner' | 'editor' | 'viewer' | null`), `rosters`, `activeRosterId`.
- **Mutations (all async, returning `{ ok, errors[] }`):** `importData`, `clearData`, `updateEvents`, `replaceData`, `logAction`, `undo`, `redo`, `commitDraft`, `discardDraft`, `setError`.
- **Roster/admin:** `selectRoster`, `createRoster`, `listMembers`, `setMemberRole`, `removeMember`, `inviteMember`, `listInvites`, `revokeInvite`.

The **local provider** ([`useLocalRosterProvider.js`](../src/data/useLocalRosterProvider.js)) resolves immediately, never denies permission (`LOCAL_PERMISSIONS` = all true), and stubs the admin methods as inert. The **Supabase provider** ([`useSupabaseRosterProvider.js`](../src/data/useSupabaseRosterProvider.js)) derives `permissions` from the authenticated role — but **the database (RLS) is the real authority**; client-side permissions only shape the UI.

**The contract's shape is machine-checked, not just documented.** The exact key set is exported once as `ROSTER_PROVIDER_KEYS` in [`providerContract.js`](../src/data/providerContract.js), and [`providerContract.test.jsx`](../src/data/providerContract.test.jsx) renders *both real providers* and asserts each returns exactly those keys — so the two backends cannot silently drift out of interchangeability. (The Supabase provider is inert under test: with no `VITE_SUPABASE_*` env its client is `null`, so every effect early-returns and it yields the same shape with zero I/O.)

## Data model (Supabase, production only)

The production backend is **not fully described by this repo's runtime code** — it depends on a configured Supabase project. The schema and policies live in [`supabase/migrations/`](../supabase/migrations/) and must be applied to that project (`npm run db:push`, or `db:reset` locally).

**Data model** — the whole roster is stored as **one JSONB `document`** per roster row, not as normalised tables. RBAC is separate:

- `public.rosters` — `id`, `name`, `document jsonb` (the entire roster), `owner_id → auth.users`, timestamps.
- `public.roster_members` — pk `(roster_id, user_id)`, `role` of enum `public.roster_role ('owner','editor','viewer')`.
- `public.roster_invites` — pk `(roster_id, email)`, pending email-whitelist invites claimed on sign-up.

**Why JSONB, not tables:** the app already treats a roster as one editable document (draft/commit publishes the whole `events` array atomically — see [data-layer.md](data-layer.md)). Storing it as one JSONB blob keeps that atomicity trivial and avoids a schema migration every time the roster shape evolves. Normalised tables (`events`, `members`, `constraints`, …) were not used deliberately; the trade-off is that per-row queries/analytics aren't available server-side (they aren't needed — the client owns roster logic).

**Row-level security** (`0001_init.sql`): RLS is on for `rosters` and `roster_members`. Because a policy on `roster_members` cannot self-`SELECT` without recursion, membership checks go through `SECURITY DEFINER` helpers `is_roster_member(target)` / `roster_role_of(target)`. Members can read a roster; owner/editor can update its `document`; only owners write membership. A trigger auto-adds a roster's creator as its owner. `anon` gets nothing — production requires login.

**Admin RPCs** (`0002_admin_rpcs.sql`, `0003_invites.sql`): all owner-guarded `SECURITY DEFINER` functions — `create_roster`, `set_member_role`, `remove_member`, `list_roster_members`, `invite_member`, `list_roster_invites`, `revoke_invite`, and the invite-claim path (`claim_invites_for` via an `auth.users` insert trigger, with `claim_my_invites()` as a fallback for pre-existing users). Email↔uid resolution happens server-side because `auth.users` isn't client-queryable.

## Permissions model

The authorization model — permission-roles (owner/editor/viewer), the
`(actor, action, target)` principle, the client-flag vs. server-RLS enforcement
invariant, and the full capability matrix — has its own spec:
**[permissions.md](permissions.md)**. In brief: RBAC is currently per-roster
(`roster_members`), **the database (RLS) is the real authority and client
`permissions` flags are UI-only**, and the target tenant-scoped model is planned
in [multi-tenant.md](multi-tenant.md). See [permissions.md](permissions.md) for
the tables and enforcement detail; the data model those permissions act on is the
[Data model](#data-model-supabase-production-only) section above.

## Off-repo context: authentication (Google OAuth)

Production auth is **Google OAuth via Supabase** ([`src/hooks/useAuth.js`](../src/hooks/useAuth.js), [`AuthGate.jsx`](../src/components/AuthGate.jsx)):

```js
supabase.auth.signInWithOAuth({
  provider: 'google',
  options: { redirectTo: window.location.origin + import.meta.env.BASE_URL },
})
```

The Supabase client is created with `detectSessionInUrl: true` ([`supabaseClient.js`](../src/data/supabaseClient.js)) — **required** because a static GitHub Pages SPA must recover the OAuth session from the redirect hash on the client. `AuthGate` mounts outside `<App/>` so the app only renders once the user is known (or immediately in local mode).

The Google provider is configured in [`supabase/config.toml`](../supabase/config.toml) via **server-side** env vars `SUPABASE_AUTH_GOOGLE_CLIENT_ID` / `SUPABASE_AUTH_GOOGLE_SECRET` (set in the Supabase dashboard/env — **not** in `.env.example`, and never `VITE_`-prefixed since they must not ship to the client).

## Off-repo context: deployment (GitHub Pages)

- Built with Vite; **`base: '/roster-builder/'`** ([`vite.config.js`](../vite.config.js)) — this sets `import.meta.env.BASE_URL` and must match the Pages sub-path (and the OAuth `redirectTo`).
- Deploy is **manual** via the `gh-pages` package: `npm run deploy` (with `predeploy` running the build) publishes `dist/` to the `gh-pages` branch. **There is no CI workflow** (`.github/workflows/` does not exist) — deployment is a deliberate manual step.
- Live at `https://caleb-llh.github.io/roster-builder/`.

## Environment variables

Copy `.env.example` → `.env.local` (gitignored). Client (build-time, `VITE_`-prefixed):

| Var | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL. Presence (with the anon key) flips the app to production mode. |
| `VITE_SUPABASE_ANON_KEY` | Public anon key (safe to ship). |

Server-side (Supabase dashboard, `config.toml` only, never shipped): `SUPABASE_AUTH_GOOGLE_CLIENT_ID`, `SUPABASE_AUTH_GOOGLE_SECRET`.

## Module map

| Path | Holds |
| --- | --- |
| `src/components/` | React UI (views, panels, modals, shared primitives incl. `HoverCard`, `DesignSystem`). |
| `src/data/` | Dual-mode data layer: mode detection, provider contract (+ `ROSTER_PROVIDER_KEYS` conformance), Supabase client, and the two providers. |
| `src/session/` | Session layer: `useDraftHistory` (draft/commit + undo/redo pure transitions). Still invoked *inside* the providers today — see [architecture-overhaul.plan.md](architecture-overhaul.plan.md). |
| `src/hooks/` | `useAuth` (Google OAuth/session) and `useRosterData` (the dual-mode dispatcher). |
| `src/schema/` | `rosterSchema.js` — schema constants (also used as test-data constants). |
| `src/utils/` | Framework-agnostic helpers not yet homed to a layer: diffing, constraints, `bulkClear` (a session-command helper, → `session/` later), the `statsTheme` design tokens + `colorUtils` (→ `design/`). Being dissolved by the overhaul (see [architecture-overhaul.plan.md](architecture-overhaul.plan.md)). |
| `src/lib/` | Genuinely generic, domain-free helpers: `calendarUtils` (date math), `dataExport` (YAML export/download). |
| `src/readmodel/` | Live aggregate *views* of State — `rosterStats`, `availabilityUtils` (bench depth), `distributionUtils` (charts). Read-only; share counting primitives with `rules/` but do **not** route through the placement registry. |
| `src/generation/` | The generation engine (seeding, promotion planning, scoring, local search, RNG) + its own `README.md`. Imports the judge from `src/evaluation/`. See [generation.md](generation.md) and [understudy.md](understudy.md). |
| `supabase/` | `migrations/*.sql` (schema, RLS, RPCs, invites) and `config.toml` (local stack + Google provider). |

## Generation pipeline overview

Generation is a deterministic, seeded pipeline (details and scoring weights in
[`../src/generation/README.md`](../src/generation/README.md);
binding rules in [generation.md](generation.md) and [understudy.md](understudy.md)):

1. **Phase 0 — understudy seeding**: schedule trainee shadowing early, base-role-centric with promotion lookahead.
2. **Phase 0.5 — promotion planning**: backtrack to reserve later real-role slots for as many unlocked trainees as possible (pinned so local search won't undo them).
3. **Phase 1 — greedy construction**: fill slots (understudy slots before real roles) using weighted scorers.
4. **Phase 2 — local search**: hill-climb the whole-roster objective `evaluateState` (fairness, spread, day/role preferences, consecutive-weekend avoidance, empty slots), never moving locked/pinned/pre-existing slots.

Every soft goal that biases Phase 1 must also be a term in `evaluateState`, or Phase 2 can undo it (see [generation.md](generation.md)).

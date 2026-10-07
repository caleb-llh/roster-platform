# Architecture (binding spec)

The system-level view — including **context you cannot recover from the code
alone** (Supabase project setup, OAuth, deployment). Behaviour-level decisions
live in the sibling spec files; this file explains *how the pieces fit and where
the off-repo dependencies are*.

## The mental model: a rule engine over shared state

Strip away UI, storage, and integrations and what remains is a **rule engine**:

- a **vocabulary** everything is written in — **Schema** (field/enum names +
  *definitional* predicates like `isMemberIncluded`; zero imports);
- a body of **facts** — the current roster + derived counts (the **`State`**,
  produced from a document by the adapter);
- a **rule base** — what's legal (the `CONSTRAINTS` registry) and what's good
  (the `SCORERS` registry), both living in **`rules/`** (see [generation.md](generation.md));
- an **inference step** that applies the rules to the facts (**Evaluation**);
- an **agent** that mutates the facts searching for a high-scoring, legal set
  (**Generation**).

That is the whole domain core. Everything else (Presentation, Storage,
Integrations, Authorization) is *periphery* that feeds it, persists it, or shows
it.

```
                         ┌───────────────────────┐
                         │        SCHEMA         │   the vocabulary
                         │  field/enum names +   │   (definitional; 0 imports)
                         │  definitional preds   │
                         └───────────┬───────────┘
                     both written in │ its terms
              ┌────────────────┬─────┴─────┬────────────────┐
              ▼                            ▼
      ┌───────────────┐            ┌───────────────┐
      │     RULES     │            │     STATE     │   the facts / working memory
      │ constraints   │            │ current roster│   (produced from a document
      │  (veto)       │            │ + derived     │    by the ADAPTER)
      │ scorers       │            │ counts        │
      │  (gradient)   │            └───────┬───────┘
      └───────┬───────┘                    │
              │   ┌────────────────────────┴──────┐
              └──▶│          EVALUATION           │  apply RULES to STATE
                  │   verdict = Rules ⋈ State     │  → { violations, score }
                  │   (pure; owns neither input)  │  ▲
                  └───────────────┬───────────────┘  │ queries
                                  └───────────▶┌──────┴───────────┐
                                               │    GENERATION    │  the agent:
                                               │  mutate State    │  propose → apply
                                               │  → Evaluate →    │  → evaluate →
                                               │  keep or revert  │  keep/revert
                                               └──────────────────┘
```

The crux: **Generation manipulates the `State`; Evaluation reads (Rules,
`State`); Rules and the `State` both speak Schema.** Nobody points "up."

**Schema is orthogonal, not the floor of a stack.** Schema is not a layer *below*
Rules with the `State` on top — it is the shared vocabulary Rules *and* the
`State` are both written in, a foundation both stand on side by side (a
T-shape, not a tower). Rules and the `State` each depend on Schema
independently; neither depends on the
other. That independence is *why* the same rule can judge a `State` built two
different ways — the generator's live tracker and the whole-roster validator.
Schema holds **definitional** facts (what the data *is*); a togglable judgement
about what's *allowed/good* is a **Rule**, not Schema.

**The core is a pure function of a single `State`.** Everything it does is either:

- **Evaluation:** `f(Rules, State) → verdict` (given these rules and this roster, is it valid? No side effects).
- **Generation:** `g(State, seed) → State'` (given this starting roster and a random seed, produce a new filled roster deterministically).

It has **no notion of** *time* (draft-vs-committed, undo), *persistence* (documents, backends), or *who is asking* (UI, bot, cron). Those three concerns live **outside** the core: time → the [Session](session.md) layer; persistence → the Provider layer (below); callers → the command surface (UI and [integrations](integrations.md) are peers).

The one exception that belongs *to* the core is the **adapter** (`toState`). It acts as an **anti-corruption boundary**: it uses the Schema to sanitize and translate the messy outside world (a raw YAML document or database JSON) into the pristine, predictable `State` the core requires.

### Naming mandate: folders reflect layers; symbols reflect vocabulary

Two rules, enforced per-change (they extend [`../AGENTS.md`](../AGENTS.md)'s
isolated-vs-shared check), keep the layer graph legible:

1. **Folders and filenames reflect the layer a module belongs to.** A file's
   path announces its layer: rules in `rules/`, the judge in `evaluation/`, the
   agent in `generation/`, persistence in `data/`, the time layer in `session/`.
   There is no `utils/` grab-bag — if you can't name the layer a file belongs to,
   that is a smell to resolve, not a file to drop in `utils/`.
2. **Function and variable names reflect the layer's vocabulary.** The vocabulary
   is more CRUD-like closer to storage and more command-like closer to the
   domain, because storage *is* plain resource CRUD while the domain is
   *behaviour that carries verdicts*: a provider method is CRUD (`saveEvents`,
   `replaceDocument`), a session op is a command/query that can be **rejected**
   (`stageEvents`, `generateDraft`, `commitDraft`), an adapter fn is a transform
   (`toState` and the reverse `withRosterEvents`), a rule is a descriptor
   (`{ key, kind, check }`). Avoid cross-vocabulary names — a session command
   named `saveEvents` is CRUD leaking up; a provider named `applySwap` is a
   command leaking down. The name should tell you which layer you're in.

### The vocabulary split: `document` is persisted, `State` is derived

Two words carry the whole data model, and the split between them is an
**invariant**, not a stylistic choice:

- A **`document`** is the *persisted* thing — what a backend saves and loads
  (YAML file, SQL rows). "Committed document" is the one authoritative base.
- A **`State`** is the *derived, in-memory, never-persisted* value the core
  reads — the output of the `toState` adapter. It exists only for the duration
  of one computation and is recomputed on demand.

The persistence line is therefore carried by the **noun** you use: if it can be
saved it is a `document`; if it is computed and thrown away it is a `State`.
This is why the pure-core contracts read as `f(Rules, State) → verdict` and
`g(State, seed) → State'` — the core only ever touches derived `State`, never a
`document`, so it has no notion of storage. Conversely, nothing persists a
`State`: to save, you write the originating `document` (or, in future, the rows
it decomposes into — see [data-layer.md](data-layer.md)).

Two rules keep the split from eroding:

- **Never call the committed document "the state."** It is "the document." The
  moment "state" means the saved thing, the core looks like it owns storage.
- **Never call a derived `State` "a snapshot."** "Snapshot" is reserved for a
  genuinely frozen point-in-time copy (e.g. the `externalAssignments` snapshot),
  not the live-recomputed engine input.

Each verb is named after the noun it produces: `to*` is a pure 1:1 cast
(`toState`), `assemble*` combines inputs (`assembleEffectiveDocument`,
`assembleStateWithExternal`), `select*` picks one out of a collection
(`selectRosterDocument`), `derive*` computes a value
(`deriveExternalAssignments`). The full vocabulary — the noun pipeline
(committed document → effective document → `State` → `State with external`), its
composition taxonomy, the verb taxonomy, and the retired/allowed uses of
"snapshot" and the overloaded noun "roster" — is owned by
[glossary.md](glossary.md); name a term and link there rather than redefining it.

## The state model: one base, everything else derived

The core is a *pure function of a `State`* (above), which only works because the
system is disciplined about what "state" means. Borrowing the rule a database
engine lives by: **there is exactly one authoritative representation of committed
data, and every other representation is a derivation of it with a clearly defined
refresh moment.** The buffer pool derives from the heap; indexes derive from the
heap; materialized views derive from the heap. Nobody writes to a derived thing
and hopes the base catches up. **Writes go to one place; reads come from
derivations of that place.**

The invariant this architecture holds to:

> **Writes target the base through one door; every other "current roster" is a
> derivation produced by one named pipeline. No reader rebuilds the `State`
> itself.**

### Four distinct senses of "state"

Keeping these apart is what lets the core stay pure. Loosely, the **draft is the
"buffer pool"**: the single place uncommitted writes accumulate before being
flushed (committed) to durable storage, with the undo stack as its write-ahead
log.

| Sense of "state" | Owner | Mutable? | Lifetime | DB analogy |
| :--- | :--- | :--- | :--- | :--- |
| **Committed document** | Provider | yes | until next save | durable storage (disk/heap) |
| **Draft** (`draftEvents` + undo/redo) | Session | yes | until commit/discard | buffer pool + WAL |
| **`State`** (`toState(effective document)`) | nobody — derived | no (immutable) | one function call | a materialized view, recomputed per query |
| **Generator scratch** (`WorkingRoster`/`AssignmentCounters`) | the generator, internally | yes | one `generateRoster` call | a session temp table |

The four senses above map onto the vocabulary split (["The vocabulary split"](#the-vocabulary-split-document-is-persisted-state-is-derived)): the *persisted* thing is the **committed document**, the *derived* value the rule engine consumes is the **`State`** from `toState`, and "snapshot" is not a synonym for either. The term definitions themselves live in [glossary.md](glossary.md).

### The buffer-pool analogy's limit (and why it matters)

In a database the executor reads *from* the buffer pool — pages are the one
representation. Here the core does **not** read the draft. The draft holds **raw
events only**; the core consumes the derived **`State`** value (resolved
constraints, normalized roles, derived members/counts), recomputed fresh each
call via `toState(assembleEffectiveDocument(committed, effectiveEvents))`. So the
draft is the single *write buffer*, but it is **not** the representation
everything *reads*. That separation — dirty-writes-buffer vs. read-`State` — is
precisely why the
core can stay a stateless function. Moving the committed store "into Session" to
make the core stateless would be redundant (the core is already stateless) and
would force Session to own persistence — collapsing [the seam](#the-provider-contract-is-the-seam).

### How the invariant holds today

- *One write door:* only the Provider's `saveEvents`/`replaceDocument` mutate the
  committed base; the draft is the single dirty-write buffer that flushes through
  that door on commit.
- *One pipeline:* the read value the core consumes — committed ⋈ draft ⋈
  external load — is produced by one named pipeline, not re-assembled ad hoc at
  each call site. `externalAssignments` is a *declared join input* (a second,
  read-only relation — the person's load on other teams), **not** part of the
  base and **not** stapled on afterward. Each stage has one named producer (see
  the verb table in [glossary.md](glossary.md)):
  [`assembleEffectiveDocument`](../src/state/derivedState.js) overlays the draft,
  [`toState`](../src/state/derivedState.js) casts the document to a `State`,
  [`deriveExternalAssignments`](../src/state/tenantResolver.js) builds the
  cross-team relation, and
  [`assembleStateWithExternal(state, external)`](../src/state/derivedState.js)
  combines the `State` with it. The session accessor
  [`useSession`](session.md)'s memoized `effectiveStateWithExternal` is the single place
  that chains all four, so the session, read model, and generator input share one
  definition.
- *Derivations don't drift:* the read model, the edit-path commands, and the
  generator's input all derive from that one pipeline. The generator's
  `WorkingRoster` is then a performance-only *scratch* (events + incremental
  `AssignmentCounters`, like a DB sort work-area) whose private state — counters,
  transient lock markers — is dropped at the flush seam; it is a superset of the
  draft's format, never a second persisted format.

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

**The UI is written once against one fixed interface; which backend sits behind
it is swapped at a single spot; and a test proves the two backends are
interchangeable.** That interface is *the seam* — the one clean cut where a
local-YAML backend and a Supabase backend become substitutable.

**Three rings wrap the pure [core](#the-mental-model-a-rule-engine-over-shared-state).**
The core (State + Rules) is
timeless, storage-blind, and caller-blind — it just judges a `State`
(`f(Rules,State)→verdict`) or builds one (`g(State,seed)→State'`)
and points at nobody. Each ring adds back exactly one concern the core refuses to
hold, and nothing more:

| Ring (outer → inner) | Adds the concern of… | So that… |
| :--- | :--- | :--- |
| **UI** (components) | **the caller** | something renders state and fires edits — reads `effectiveEvents`, gates buttons on `permissions`. |
| **Session** (`SESSION_KEYS`) | **time** | edits can be drafted, undone, and committed — a `draftEvents` overlay + undo/redo on top of the committed document. |
| **Provider** (`STORAGE_KEYS`) | **persistence + identity** | the document survives reloads and knows its editor — load/save a backend document, report `role`/`permissions`. |

(The core itself is not a ring — it is the thing the rings wrap. The `toState`
**adapter** is the small normalizer that turns a Provider's raw document into the
pristine `State` the core requires; Session invokes it on demand, as below.)

**The shape is an "L", not a straight line.** It is tempting to read
`UI → Session → Provider → core` as one chain, but that is wrong: **storage and
judgment are independent axes that only meet at Session.**

- **UI → Session → Provider is a linear composition chain.** Each ring *imports
  and calls* the ring to its right (a dependency arrow), never the reverse. This
  direction is fixed by need: the UI needs Session's draft/undo and command
  surface; Session needs a Provider to hold the committed document (and report
  identity) so a draft has a baseline to diff against and commit to. You cannot
  reorder them — a Provider that depended on Session would mean "persistence"
  requires "undo history" to exist first, which is backwards.
- **The core hangs off the side, not off the end of that chain.** It is a library
  of pure functions, invoked independently by whichever ring needs judgment —
  **not** the next link after Provider. Crucially, **the Provider and the core
  never touch**: the Provider does backend I/O only and never imports the core;
  the core is pure and imports nobody. **Session is the corner of the "L"** — the
  one place that depends on *both*, borrowing storage from the Provider and
  judgment from the core.

**Who touches the core, and when.** On the **edit path**, only Session does: when
the UI fires a command (`assign`, `swap`, …), Session runs the effective
document through the `toState` adapter and hands the resulting `State` to the
core's **Evaluation** for a verdict — which is why a command can be *rejected* (a
viewer's edit, an infeasible swap). On commit, Session calls the Provider's
`saveEvents` to persist. (Off the edit path, the read model and generator also
call the core's derivations — e.g. to project stats or score a roster — which is
exactly why the core is kept a standalone pure library rather than wired into the
chain.)

A one-liner to hold onto: **Provider = where the facts are stored; core = how
facts are judged; Session = the editor that borrows storage from one and
judgment from the other, holding an unsaved draft in between.** (The committed /
draft / `State` distinction behind this is spelled out in
[The state model](#the-state-model-one-base-everything-else-derived).)

Because `Provider` is an interface, every ring that depends on it is identical
whichever backend is underneath — that substitutability is *the seam*.

**Where the swap happens.** The composition root
([`src/App.jsx`](../src/App.jsx)) renders one of two tiny mode-specific wrappers;
each calls exactly one provider hook and lifts it through Session:

```js
// ProductionApp
const roster = useSession(useSupabaseProvider())
// LocalApp
const roster = useSession(useLocalProvider())
```

Splitting by component — rather than a `mode ? useLocal() : useSupabase()`
dispatcher — means no provider hook is ever called conditionally, so the unused
backend's mount effects (e.g. Supabase's network RPCs) never run. Mode is a
build-time constant, so the selection is stable for the app's lifetime.

**What the interface contains.** The two swappable/composable rings — Provider
and Session — expose two key sets, composed into the one object the UI consumes
(`ROSTER_PROVIDER_KEYS = [...STORAGE_KEYS, ...SESSION_KEYS]`):

| Layer | Adds | Responsibility | Representative keys |
| :--- | :--- | :--- | :--- |
| **Provider** (`STORAGE_KEYS`) | Persistence + identity | **I/O only.** Reads/writes the committed document to a backend and reports who the user is. Timeless — no undo history, no uncommitted drafts, no rules. | `data`, `error`, `loading`; `permissions`, `role`; CRUD `importData`/`saveEvents`/`replaceDocument`; tenant/admin `selectRoster`/`inviteMember`/… |
| **Session** (`SESSION_KEYS`) | Draft/time + commands | **Drafts and history.** Sits on the Provider, intercepting edits so the user can make uncommitted changes, undo mistakes, and only touch the backend on "Save". Commands run the core's Evaluation and may be *rejected*. | `draftEvents`, `effectiveEvents` (= `draftEvents ?? data.events`), `undo`/`redo`/`commitDraft`; **commands** `assign`/`addSlot`/`swap`/`bulkClear` — can be *rejected* (viewer edit, infeasible swap) |

The two providers differ only in those storage-ring details: the **local**
provider resolves immediately and grants all permissions; the **Supabase**
provider derives `permissions` from the authenticated role — but **the database
(RLS) is the real authority**, so client-side permissions only hide or show UI.

**Why it can't silently break.** `STORAGE_KEYS` isn't just prose — it's a frozen
array of the exact keys a provider must return, i.e. the *machine-checkable form
of the contract*. The conformance test mounts **both** real providers and
asserts each returns exactly `STORAGE_KEYS`, and that `useSession(provider)`
returns exactly `ROSTER_PROVIDER_KEYS`. The two backends therefore cannot drift
apart without a test going red — which is what makes swapping at the seam *safe*
rather than hopeful.

## Data model (Supabase, production only)

The production backend is **not fully described by this repo's runtime code** — it depends on a configured Supabase project. The schema and policies live in [`supabase/migrations/`](../supabase/migrations/) and must be applied to that project (`npm run db:push`, or `db:reset` locally).

**Data model** — the whole roster is stored as **one JSONB** **`document`** per roster row, not as normalised tables. RBAC is separate:

- `public.rosters` — `id`, `name`, `document jsonb` (the entire roster), `owner_id → auth.users`, timestamps.
- `public.roster_members` — pk `(roster_id, user_id)`, `role` of enum `public.roster_role ('owner','editor','viewer')`.
- `public.roster_invites` — pk `(roster_id, email)`, pending email-whitelist invites claimed on sign-up.

**Why JSONB, not tables:** the app already treats a roster as one editable document (draft/commit publishes the whole `events` array atomically — see [data-layer.md](data-layer.md)). Storing it as one JSONB blob keeps that atomicity trivial and avoids a schema migration every time the roster shape evolves. Normalised tables (`events`, `members`, `constraints`, …) were not used deliberately; the trade-off is that per-row queries/analytics aren't available server-side (they aren't needed — the client owns roster logic).

**If the document is ever decomposed into tables, the vocabulary does not move.**
Splitting the one `document jsonb` into `events` / `members` / `constraints` rows
is purely a change to **byte-serialization** — a *provider* concern. The
invariant from ["The vocabulary split"](#the-vocabulary-split-document-is-persisted-state-is-derived)
tells you exactly what stays fixed:

- The **`document`** is still the persisted base — it is simply *stored as rows
  instead of a blob*. "Load the document" becomes "`SELECT` the rows and assemble
  them back into the flat document shape the adapter understands"; "save the
  document" becomes "write the rows." The provider's job is still "emit/accept a
  `document` in the shapes the one adapter understands," so **`toState` and every
  `State` stage are untouched** — they never knew whether the bytes were YAML, a
  JSONB blob, or a join of five tables.
- A decomposed layout therefore needs **no new noun**. Resist the temptation to
  call the row-set "the state" because it now looks relational: it is still a
  `document` (persisted), and `State` remains the derived, in-memory value. The
  only thing that gains vocabulary is the *reassembly* step — a provider-internal
  `document` ← rows mapping (the mirror of today's YAML-parse), which produces a
  `document`, so by the verb taxonomy it is an `assemble*`/`to*` producing a
  `document`. It is **not** part of the `State` pipeline.
- The already-present `selectRosterDocument` (tenant → one flat `document`) is the
  template: in a tabular backend it would resolve by *joining tables* rather than
  *indexing into nested JSON*, but its contract — "produce one flat `document`" —
  is identical. This is why the multi-tenant persistence plan
  ([multi-tenant.plan.md](multi-tenant.plan.md), the JSONB → normalized backfill)
  is a *provider/serialization* change, not a vocabulary change.

**Decomposition is vocabulary-neutral but *not* authorization-neutral.** The one
thing that genuinely moves is **row-level security**: today a single policy pair
on the `document jsonb` column (`rosters_select_members` / `rosters_update_editors`)
guards the whole roster at once. Split the column into `events` / `members` /
`constraints` tables and the single "update the document" capability **fans out
into one RLS policy per table**, each of which must resolve the *same* role or an
authorization gap opens (writable `events` rows beside unprotected `constraints`
rows). That fan-out is an **authorization** concern, owned by
[permissions.md](permissions.md#decomposing-the-document-fans-rls-out-per-table) —
not a vocabulary one. (This is also why the planned tenant backfill keeps the
roster schedule itself as `document jsonb` and only normalizes the *surrounding*
entities — see [multi-tenant.md](multi-tenant.md#supabase-data-model).)

In short: **table decomposition changes how a `document` is stored, never what a
`document` or a `State` *is*.** The persisted-vs-derived line is drawn at the noun,
not at the storage format, precisely so that this future migration is a
provider-local change.

**Row-level security** (`0001_init.sql`): RLS is on for `rosters` and `roster_members`. Because a policy on `roster_members` cannot self-`SELECT` without recursion, membership checks go through `SECURITY DEFINER` helpers `is_roster_member(target)` / `roster_role_of(target)`. Members can read a roster; owner/editor can update its `document`; only owners write membership. A trigger auto-adds a roster's creator as its owner. `anon` gets nothing — production requires login.

**Admin RPCs** (`0002_admin_rpcs.sql`, `0003_invites.sql`): all owner-guarded `SECURITY DEFINER` functions — `create_roster`, `set_member_role`, `remove_member`, `list_roster_members`, `invite_member`, `list_roster_invites`, `revoke_invite`, and the invite-claim path (`claim_invites_for` via an `auth.users` insert trigger, with `claim_my_invites()` as a fallback for pre-existing users). Email↔uid resolution happens server-side because `auth.users` isn't client-queryable.

## Permissions model

The authorization model — permission-roles (owner/editor/viewer), the
`(actor, action, target)` principle, the client-flag vs. server-RLS enforcement
invariant, and the full capability matrix — has its own spec:
**[permissions.md](permissions.md)**.&#x20;

In brief: RBAC is currently per-roster (`roster_members`), enforced by a
two-layer split (server RLS is authoritative, client flags shape the UI only —
owned by [permissions.md](permissions.md)), and the target tenant-scoped model is
planned in [multi-tenant.md](multi-tenant.md). The data model those permissions
act on is the [Data model](#data-model-supabase-production-only) section above.

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

| Var                      | Purpose                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `VITE_SUPABASE_URL`      | Supabase project URL. Presence (with the anon key) flips the app to production mode. |
| `VITE_SUPABASE_ANON_KEY` | Public anon key (safe to ship).                                                      |

Server-side (Supabase dashboard, `config.toml` only, never shipped): `SUPABASE_AUTH_GOOGLE_CLIENT_ID`, `SUPABASE_AUTH_GOOGLE_SECRET`.

## Module map

| Path                | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/`   | React UI (views, panels, modals, shared primitives incl. `HoverCard`, `DesignSystem`).                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/data/`         | Dual-mode data layer: mode detection, provider contract (`STORAGE_KEYS`/`SESSION_KEYS`/`ROSTER_PROVIDER_KEYS` conformance), Supabase client, and the two **pure-CRUD** providers.                                                                                                                                                                                                                                                                                        |
| `src/session/`      | Session layer (the "time" layer, above the provider): the pure per-action command surface (`commands.js` + its `bulkClear` helper — see [session.md](session.md)), `useSession` (wraps a CRUD provider — owns the draft/commit + undo/redo overlay and the `stageEvents`/`stageDocument` command surface) and `useDraftHistory` (draft/commit + undo/redo pure transitions).                                                                                             |
| `src/hooks/`        | `useAuth` (Google OAuth/session). The dual-mode provider is composed in App's mode-specific wrappers (see "The provider contract is the seam"), not a dispatcher hook here.                                                                                                                                                                                                                                                                                              |
| `src/schema/`       | `rosterSchema.js` — schema constants (also used as test-data constants).                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/design/`       | Presentation vocabulary: `designSystem.js` (the Tailwind glass token module — see [design-system.md](design-system.md)), `colorUtils` (functional role/day colour palette), and `slateRamp` (the shared concern→slate-HSL ramp token reused by every roster-stats visual).                                                                                                                                                                                               |
| `src/lib/`          | Genuinely generic, domain-free helpers: `calendarUtils` (date math + `formatDate`/`formatDateRange` presentational formatting), `yamlExport` (YAML export/download), `clipboard` (`copyText` — the async-Clipboard-with-legacy-fallback boundary), `slotKey` (the shared `date#roleIndex` roster-slot key used by the UI, the diff, and the bulk-clear command).                                                                                                         |
| `src/integrations/` | External-platform glue. Today: `telegram.js` (Telegram Mini App — read-only viewport/theme mirroring, no-op outside Telegram). A future bot **write** path (commands as actors on the session command surface) is foreshadowed — see [integrations.md](integrations.md).                                                                                                                                                                                                 |
| `src/readmodel/`    | Live aggregate *views* of the `State` — `rosterStats`, `benchDepth` (availability bench depth), `rosterStatsCharts` (the roster-stats charts + their helpers + the availability-heatmap cell colour), `rosterDiff` (committed-vs-draft diff), `rosterTable` (the CSV/clipboard export projection — columns + rows; the browser download/write glue stays in the view). Read-only; share counting primitives with `rules/` but do **not** route through the placement registry. |
| `src/generation/`   | The generation engine (seeding, promotion planning, scoring, local search, RNG) + its own `README.md`. Imports the judge from `src/evaluation/`. See [generation.md](generation.md) and [understudy.md](understudy.md).                                                                                                                                                                                                                                                  |
| `supabase/`         | `migrations/*.sql` (schema, RLS, RPCs, invites) and `config.toml` (local stack + Google provider).                                                                                                                                                                                                                                                                                                                                                                       |

## Dependency direction (enforced invariant)

The layers above form an **acyclic graph**, and the arrows only point one way.
This is not a style preference — it is what keeps the timeless core independent
of "time" (Session) and persistence (Data), and keeps `rules/` the domain heart
rather than a dependency sink. The allowed cross-layer arrows are:

| Layer                              | May import from                                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `schema/`                          | nothing (the leaf)                                                                                                          |
| `rules/`                           | `schema` only — the domain heart, **not** a sink; arrows point *into* it                                                    |
| `evaluation/`                      | `rules`, `schema`                                                                                                           |
| `state/`                           | `schema`, `config`, `design`, `lib`, `rules` (the tracker reuses a rules counting primitive)                                |
| `generation/`                      | `state`, `evaluation`, `rules`, `schema`                                                                                    |
| `readmodel/`                       | `state`, `evaluation`, `rules`, `schema`, `design` (chart views use tokens), `lib` (`rosterDiff` uses the shared `slotKey`) |
| `session/`                         | `state`, `evaluation`, `lib` (the `bulkClear` helper uses the shared `slotKey`)                                             |
| `data/`                            | `state` (providers use the adapter)                                                                                         |
| `hooks/`                           | `data`, `session`                                                                                                           |
| `components/`                      | `readmodel`, `evaluation`, `generation`, `rules`, `schema`, `design`, `lib`                                                 |
| `lib/`, `design/`, `integrations/` | nothing (domain-free / leaf)                                                                                                |
| `config/`                          | `schema`                                                                                                                    |

Key invariants: **the core (`schema`/`rules`/`evaluation`/`state`/`generation`)
never imports** **`session/`** **or** **`data/`**; `rules/` never imports `evaluation/`
(or anything but `schema`); read-model views never route through the placement
registry. `App.jsx`/`main.jsx` are the composition root and may import anything.

This is **enforced by a guard test**
([`src/__guards__/dependencyDirection.lint.test.js`](../src/__guards__/dependencyDirection.lint.test.js)):
a dependency-free Vitest lint (the same pattern as the design-system guard) that
scans every source file's cross-layer imports and fails CI on any arrow not in
the allow-list above. Adding a new cross-layer arrow is therefore a deliberate
act: whitelist it in the guard **and** justify it here.

## Testing conventions

The test layout is itself load-bearing and follows a few deliberate rules:

- **Tests are co-located with their source.** A module's `*.test` sits beside it,
  and when a module moves folders its test moves with it in the same change, with
  import paths updated. This keeps the layer a test belongs to obvious and keeps
  every refactor step green.
- **Guard tests live under** **[`src/__guards__/`](../src/__guards__/), visibly
  distinct from behaviour tests.** These are *architectural* checks, not unit
  tests: the dependency-direction lint (above) and the design-system token lint.
  Grouping them under `__guards__/` signals "this asserts a structural invariant,
  not a feature."
- **A cross-cutting test with no single source file homes with the layer it most
  asserts.** `crossTeam.test.js` spans the adapter + rules but chiefly exercises
  `EligibilityChecker` / `validateEventAssignments` / `explainSwap`, so it lives
  in `evaluation/` rather than a separate `__integration__/` folder — a single
  cross-cutting test does not justify its own layer.
- **The Vitest harness is fixed.** `src/test/setup.js` is referenced by
  `vitest.config.js`'s `setupFiles`; it must not move without updating that
  config in the same change.
- **Test data uses schema constants.** Fixtures build on `rosterSchema.js`
  constants (per [`../AGENTS.md`](../AGENTS.md)) rather than hard-coded field
  names, so a schema change can't silently rot the fixtures.

## Generation pipeline overview

Generation is a deterministic, seeded pipeline (details and scoring weights in
[`../src/generation/README.md`](../src/generation/README.md);
binding rules in [generation.md](generation.md) and [understudy.md](understudy.md)):

1. **Phase 0 — understudy seeding**: schedule trainee shadowing early, base-role-centric with promotion lookahead.
2. **Phase 0.5 — promotion planning**: backtrack to reserve later real-role slots for as many unlocked trainees as possible (pinned so local search won't undo them).
3. **Phase 1 — greedy construction**: fill slots (understudy slots before real roles) using weighted scorers.
4. **Phase 2 — local search**: hill-climb the whole-roster objective `scoreRoster` (fairness, spread, day/role preferences, consecutive-weekend avoidance, empty slots), never moving locked/pinned/pre-existing slots.

Every soft goal that biases Phase 1 must also be a term in `scoreRoster`, or Phase 2 can undo it (see [generation.md](generation.md)).

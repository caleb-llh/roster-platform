# Glossary — the shared vocabulary

This file is the **single owner of term definitions** for Roster Platform. Other
specs name a concept and link here rather than re-defining it. When two files
describe the same word differently, that is a conflation bug — reconcile it by
pointing both at the entry below.

Two tables below — **nouns** (the things) and **verbs** (the functions that move
between them). Both are meant to be **expanded** as the vocabulary grows: add a
row, keep the columns. The governing rule is:

> **A verb is named after the noun (stage) it produces.** `toState` produces a
> `State`; `assembleStateWithExternal` produces a `State with external`;
> `selectRosterDocument` produces a `document`. If you rename a noun, its verbs
> move with it.

The guiding CS distinction, applied throughout:

> **state = a derived, in-memory value computed from a document; it is *local*,
> never persisted. The authoritative, persisted thing is the *document*.**

So "state" here is deliberately the **derived/local** side, and the word carries
no persistence. The persisted/authoritative base is always "the committed
document" (or, in prose, just "the document"). We never call the committed
document "the state", and we never call the derived `State` "a snapshot."

## The pipeline (how the nouns compose)

```
committed document  ──assembleEffectiveDocument──▶  effective document  ──toState──▶  State  ──assembleStateWithExternal──▶  State with external
   (persisted)              (⋈ draft events)         (committed ⋈ draft)             (derived/local)    (⋈ externalAssignments)       (engine input)
```

- Only the **committed document** is persisted. Everything to its right is
  derived in memory from it, never stored. Session memoizes the derived stages
  (one `effectiveStateWithExternal`) so they recompute only when a source input changes — but
  they remain derivations, not state that is held or mutated in place.
- The **effective document** is still a *document* (same shape) — it is the
  committed document with the uncommitted `draft` overlaid onto its `events`.
  Its events slice is `effectiveEvents`.
- `State` is the adapter's output for **whatever document it is handed** — it is
  a 1:1 cast and knows nothing about drafts. Casting the committed document and
  casting the effective document both produce a `State`; which one you get
  depends on which document you pass in.
- The session's memoized `effectiveStateWithExternal` value is the **one place** that
  walks the whole pipeline: `assembleEffectiveDocument` → `toState` →
  `assembleStateWithExternal`.

## Noun taxonomy (what is made of which)

The nouns form a composition tree. "⊃" reads "is composed of / contains"; a
leaf is a primitive the layer above is built from.

```
tenant document                         (nested multi-team source; selectRosterDocument picks one)
  └─ committed document   (flat)        the persisted base
       ├─ members
       ├─ events          ⊃ event ⊃ { date, slots: [ slot ⊃ assignment ⊃ {memberId, role} ] }
       ├─ roles
       ├─ roster period   (YAML key `roster_period`)
       └─ constraints / preferences

effective document        = committed document, with events ← effectiveEvents
  └─ draft                ⊃ draftEvents + undo/redo stack      (the overlaid events)

State                     = toState(«a document»)             (derived/local engine input)
  ├─ members / activeMembers
  ├─ events
  ├─ roles / roleColorMap
  ├─ rosterConstraints / rosterPreferences   (resolved)
  ├─ memberConstraints / memberPreferences
  └─ rosterPeriod

State with external       = State  +  externalAssignments
  └─ externalAssignments  ⊃ { memberId: [ date, … ] }         (read-only cross-team relation)

generator scratch         ⊃ WorkingRoster + AssignmentCounters  (transient, dropped at flush)
```

Relationships in words:

- A **tenant document** contains many **committed documents** (one per
  team×roster); `selectRosterDocument` picks and flattens one.
- An **effective document** *is a* committed document (same shape) with its
  `events` swapped for the draft's `effectiveEvents` — so anything built from a
  document (e.g. `State`) can be built from either.
- A **State** *is derived from* a document and shares the document's `events`
  and `roles`, but adds resolved/normalized fields (`activeMembers`,
  `roleColorMap`, merged constraints). It is **not** a document and cannot be
  persisted.
- A **State with external** *is a* State plus one extra relation; it is the only
  noun the engine actually consumes.
- **generator scratch** is spun up *from* a State during one `generateRoster`
  call and never escapes it.

## Nouns

| Noun | Definition | Constituents | Persisted or derived? | Owner |
| :--- | :--- | :--- | :--- | :--- |
| **committed document** | The one authoritative base: the saved roster document (YAML in local mode, JSON rows in Supabase). In prose, "the document." What CS would call "the persisted value." | `members`, `events`, `roles`, roster period, constraints/preferences (flat or nested-tenant shape) | **persisted** | Provider |
| **draft** | The uncommitted write buffer: `draftEvents` plus the undo/redo stack — where edits accumulate before commit. | `draftEvents`, undo/redo stack | pending (not yet persisted) | Session |
| **effective document** | The committed document with the `draft` overlaid onto its events: `{ ...committed, events: effectiveEvents }`. Still a *document* (same shape), just reflecting unsaved edits. | committed document ⋈ draft; events slice = `effectiveEvents` | derived | Session (memoized) |
| **State** | The derived, **local** engine input produced by `toState(document)`: a 1:1 cast of *whatever document is passed in* into the shape the engine/validators/stats consume. Recomputed from its inputs (memoized by Session); never persisted. Casts either the committed or the effective document — it does not itself know which. | `members`, `activeMembers`, `events`, `roles`, `roleColorMap`, resolved `rosterConstraints`/`rosterPreferences`, `memberConstraints`/`memberPreferences`, `rosterPeriod` | derived / local | nobody (pure function output) |
| **State with external** | A `State` with the cross-team `externalAssignments` relation attached: `{ ...State, externalAssignments }`. The complete engine input. | a `State` + `externalAssignments` | derived / local | nobody (pure function output) |
| **externalAssignments** | A read-only relation of a person's load on *other* teams: `{ memberId: ['YYYY-MM-DD', …] }`. A declared join input to the engine input, not part of the base. | `{ memberId: [date, …] }` | derived (point-in-time copy) | derived by `deriveExternalAssignments` |
| **generator scratch** | The generator's private, reversible work-area during one `generateRoster` call. Dropped at the flush seam. | `WorkingRoster` + `AssignmentCounters` | derived (transient) | the generator, internally |
| **event** | One day's roster entry: a date and the positional slot array that covers it. The domain record the engine, validators, and stats operate on. | `{ date, slots: [slot…] }` | part of a document | — |
| **edit** | The unit the undo/redo stack records: a whole-`events`-array snapshot captured before a mutation lands in the draft. Undo/redo swap entire snapshots, not individual events — so one logical edit (even a multi-event generation) is one reversible step. | a cloned `events` array | pending (lives in the draft's undo/redo stack) | Session ([`useDraftHistory`](../src/session/useDraftHistory.js)) |
| **assignment** | A member placed into a slot (a `{ memberId, role }` filling). | `memberId`, `role` | part of an event | — |
| **slot** | One fillable position in an event's `slots` array (a role to be covered). | a role (optionally a filled `memberId`) | part of an event | — |
| **command** | A named, **rejectable** domain action over a `State with external` (`assign`, `swap`, `removeSlot`, …) that returns a verdict + proposed `nextEvents` without itself persisting. Borrowed from CQRS: a *command* is an intent that may be refused (an infeasible swap is `ok: false`), unlike CRUD `saveEvents` which just writes. | `(state, args) → { ok, nextEvents, verdict, logEntry }` | pure function (no persistence) | the Session command surface |
| **roster** | ⚠️ **Was overloaded — three senses.** Senses 2 and 3 now have distinct canonical names in code and data (`slots`, `roster_period`); only sense 1 still uses the bare word "roster." See the breakdown below. | — | — | — |

The three senses of **roster** and the canonical name each now carries:

| # | Sense | What it is | Canonical name | Code touchpoint |
| :-- | :--- | :--- | :--- | :--- |
| 1 | **the schedule / entity** (dominant) | The whole roster being built — one team's full schedule of events, with its members, roles, period, and constraints. This is the thing [`selectRosterDocument`](../src/state/tenantResolver.js) picks out of a tenant by `rosterId`, and the `document` the pipeline casts. | **"roster"** (keeps the bare word) | `rosterId`, `teams[].rosters[]` (nested shape), the flat `document` |
| 2 | **the per-event slot array** | The positional array on a *single* event — the list of fillable slots that cover one day: `event.slots = [ { role, member_id }, … ]`. Each element is a **slot** (a position, filled or empty), not an assignment. Indexed positionally (`roleIndex`), which is why `assign`/`swap` address slots by `(eventDate, roleIndex)`. | **`slots`** (code + YAML) | `event.slots`, `slots[idx]` in [commands.js](../src/session/commands.js) |
| 3 | **the time *period*** | The scheduling window the roster spans: the `{ start_date, end_date }` block, top-level in a flat document or per-roster inside a tenant's `teams[].rosters[]`. | YAML key **`roster_period`**; `rosterPeriod` on the `State` | [`rosterSchema.js`](../src/schema/rosterSchema.js) `YAML_FIELDS.ROSTER_PERIOD: 'roster_period'` |

**Why the collision was 2 vs 3, and how it was resolved.** On disk the clash was
real: both senses were literally the YAML key `roster:`, disambiguated only by
*shape* — nested under an event it was the slot array (2); a `{ start_date,
end_date }` block it was the period (3). Prose qualifiers alone could not fix a
clash that lived in the persisted data, so both were given distinct canonical
keys (`slots`, `roster_period`). Sense 1 was deliberately **left** as the bare
"roster": it is the product's dominant user-facing term (a meta-name like
`roster_term` is something no user or domain expert says), and it was never part
of the collision.

To avoid breaking existing user files, the rename is absorbed at the load
boundary by a permanent back-compat shim,
[`normalizeDocument`](../src/state/normalizeDocument.js): it rewrites any legacy
`roster:` key — by shape — into `slots` / `roster_period` once, at parse time, so
the entire interior (adapter, validators, engine, read model) only ever sees the
canonical names. It is pure and idempotent, runs at every ingest point (both
providers' import/replace paths and the Supabase DB load), and is kept
permanently. The write path needs no transform: the in-memory object already
holds canonical names, so [`yamlExport`](../src/lib/yamlExport.js) emits them
directly. One site that is *not* this sense stays as `roster:` — the Supabase
`roster:rosters(...)` PostgREST join alias in
[useSupabaseProvider.js](../src/data/useSupabaseProvider.js) names sense 1.

The DB analogy (expanded in
[architecture.md](architecture.md#the-state-model-one-base-everything-else-derived)):
committed document = durable heap; draft = buffer pool + WAL; effective document
= heap with WAL applied in-memory; `State` = a materialized view recomputed per
query; generator scratch = a session temp table.

## Verbs

Each verb is named after the noun it produces. Four verb shapes are in use:

- **`to*`** — a pure, 1:1 shape **cast** (one input → one output of the named
  stage). No combining, no picking.
- **`assemble*`** — **combine** several inputs into the named stage.
- **`select*`** — **pick one** out of a collection.
- **`derive*`** — **compute** a value (a fold/projection, not a cast).

| Symbol | Shape | Produces | Role |
| :--- | :--- | :--- | :--- |
| [`selectRosterDocument(tenant, { teamId, rosterId })`](../src/state/tenantResolver.js) | `select*` (pick one) | `document` (flat) | Picks one roster out of a nested-tenant document and flattens it to the flat `document` shape `toState` consumes. Flat input passes through unchanged. |
| [`assembleEffectiveDocument(document, effectiveEvents)`](../src/state/derivedState.js) | `assemble*` (combine) | `document` (effective) | Combines a committed document with the draft's `effectiveEvents` into the effective document (`{ ...document, events: effectiveEvents }`). Produces a *document* (hence `...Document`). Null document passes through. |
| [`toState(document)`](../src/state/derivedState.js) | `to*` (cast) | `State` | The adapter / anti-corruption boundary: casts a flat roster document into the `State` the engine reads. Knows nothing of drafts, tenants, or external load. |
| [`deriveExternalAssignments(document, { teamId })`](../src/state/tenantResolver.js) | `derive*` (compute) | `externalAssignments` | Folds every other team's rosters into the read-only `{ memberId: [dates] }` relation. A declared join input, not part of the base. |
| [`assembleStateWithExternal(state, { externalAssignments })`](../src/state/derivedState.js) | `assemble*` (combine) | `State with external` | Combines a finished `State` (from `toState`) with the cross-team `externalAssignments` (from `deriveExternalAssignments`) into the complete engine input. A pure COMBINE of two already-made nouns — it takes a **`State`**, not a document, and does **not** cast or know about drafts/tenants. |
| [`effectiveStateWithExternal`](../src/session/useSession.js) | memoized value (composes the pipeline) | `State with external` | The session's single memoized value — the **one place** the whole pipeline is walked (`assembleEffectiveDocument` → `toState` → `assembleStateWithExternal`), memoized on its three source inputs so it recomputes only when one changes. The command it feeds decides the mutation; this value itself mutates nothing. |

Note on `assemble*`: both `assemble*` verbs are consistently "combine two
inputs." `assembleEffectiveDocument` combines a document + draft events into a
*document*; `assembleStateWithExternal` combines a `State` + `externalAssignments`
into a *State with external*. Each is named after the noun it produces.
`toState` is the only *cast* (one document in, one `State` out);
`selectRosterDocument` is the only *pick-one*; `deriveExternalAssignments` is the
only *compute*.

## Retired / discouraged words

- **"snapshot" as a synonym for the derived `State`** — retired. The pure value
  the core reads is a `State` (from `toState`); never call it a "snapshot."
  - *Still fine* — "snapshot" in its plain dictionary sense of **a frozen copy
    captured at a moment**, where that is exactly what is meant: e.g. the
    `externalAssignments` **snapshot** (a read-only, point-in-time copy of a
    member's load on other teams), or contrasting a *live-recomputed* read model
    against a *frozen generation snapshot*. The word is only banned as a
    stand-in for the engine's input `State`.
- **"effective state" as a noun** — do **not** use it. The committed ⋈ draft
  merge is the **effective document** (a document stage), not a "state" stage.
  There is no "effective state" noun: the derived stages are `State` (any
  document cast) and `State with external`. The *memoized value* that happens to
  compose draft-overlay + cast + external is named
  `effectiveStateWithExternal` because it *is* a `State with external`
  built from the *effective* document — "effective" qualifies the document it
  starts from, not a state noun.
- **"state" as a name for the persisted base** — in prose, the persisted base is
  "the committed document" (or "the document"). "State" is reserved for the
  *derived/local* engine input. Plain lowercase "state" for genuinely generic
  mutable data (React component state, a generator's internal scratch "private
  state") is fine — it is only *document-vs-State* confusion that is banned.

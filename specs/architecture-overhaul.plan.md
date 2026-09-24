# Architecture overhaul (COMPLETE — living migration doc)

> **Status: complete (steps 1–11 + follow-on landed; the graph is enforced).**
> This is a *target* architecture
> plus the **living record** of an incremental refactor toward it — see the
> [Migration progress log](#migration-progress-log-living) for what has landed
> and what debt is outstanding. It does **not** describe the full current on-disk
> structure — for that, see the [Module map](architecture.md#module-map) in
> [architecture.md](architecture.md). Nothing here is binding until it lands as
> code; each move is a mechanical, green-per-step refactor per
> [`../AGENTS.md`](../AGENTS.md). This file owns the *target layer model, its
> data flow, the folder layout, and the migration state*; when a piece is built,
> the owning behaviour spec (generation.md, data-layer.md, permissions.md…)
> remains the authority for that piece's rules — this doc links to them, it does
> not restate them.

## Why this exists

The dependency graph is already healthy (acyclic: no util imports a component,
`schema/` imports nothing). Several things are *not* explicit yet:

1. **Folder names don't match concerns.** `src/utils/` is a grab-bag holding
   several layers (generic helpers, the domain rules, the adapter, evaluation).
2. **The code mixes concern-pairs** the model should separate:
   provider-vs-session-state, *generating* vs *evaluating*, and — inside single
   files — *vocabulary* vs *policy* (e.g. `understudy.js`).
3. **Some concerns sit in the wrong folder.** `useDraftHistory.js` (a *session*
   concern) lives under `data/` (the *provider* layer).
4. **Names don't reflect layer or vocabulary.** Paths don't announce a module's
   layer, and symbols don't announce their verb-kind (CRUD vs. command vs.
   transform). The overhaul is a **renaming** as much as a re-foldering.

This doc names the layers, states the one data-flow rule (**the core is a pure
function of a single State snapshot**), fixes the naming so **folders/files
reflect layers and function/variable names reflect each layer's vocabulary**, and
gives the target folders — so the refactor has a target and future changes have a
place (and a name) to belong.

## The mental model: a rule engine over shared state

Take a step back. Strip away UI, storage, and integrations and what remains is a
**rule engine**:

- a **vocabulary** everything is written in (Schema),
- a body of **facts** — the current roster + derived counts (State),
- a **rule base** — what's legal (the `CONSTRAINTS` registry) and what's good (the
  `SCORERS` registry) (Rules); **both are already registries today** — the
  overhaul *relocates* them into `rules/`, it does not invent them,
- an **inference step** that applies the rules to the facts (Evaluation),
- an **agent** that mutates the facts searching for a high-scoring, legal set
  (Generation).

That is the whole domain core. Everything else (Presentation, Storage,
Integrations, Authorization) is *periphery* that feeds it, persists it, or shows
it.

### Schema is orthogonal, not "the bottom of a stack"

The key correction over earlier drafts: **Schema is not a layer *below* Rules
with State above it. Schema is the shared vocabulary that Rules *and* State are
both written in.** It is a *foundation both stand on*, side by side — a T-shape,
not a tower.

This is already true in code: `constraints.js` imports `CONSTRAINT_KEYS`;
`derivedState.js`/`assignmentTracker.js` import `YAML_FIELDS` / `isMemberIncluded`.
Rules and State each depend on Schema **independently**; neither depends on the
other. That independence is *why* the same rule can judge state built two
different ways (generator's live tracker vs. validator's whole-roster scan).

Schema holds **definitional** facts about the data shape (field names, enum keys,
`isMemberIncluded` = "is this record an active member?") — NOT policy. Policy
("enforce availability?", "cap per month") is a Rule. The test for what belongs
in Schema vs. Rules: *is it a fact about what the data IS (Schema), or a
togglable judgement about what's ALLOWED/GOOD (Rules)?*

## The domain core

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
              │                            │
              │   ┌────────────────────────┴──────┐
              └──▶│         EVALUATION            │  inference: apply RULES to STATE
                  │   verdict = Rules ⋈ State     │  → { violations, score }
                  │   (pure; owns neither input)  │  ▲
                  └───────────────┬───────────────┘  │ queries
                                  │                   │
                                  │            ┌──────┴───────────┐
                                  └───────────▶│    GENERATION    │  the agent:
                                               │  mutate STATE →  │  propose → apply
                                               │  Evaluate → keep │  → evaluate →
                                               │  or revert       │  keep/revert
                                               └──────────────────┘
```

The triangle is the crux: **Generation manipulates State; Evaluation reads
(Rules, State); Rules and State both speak Schema.** Nobody points "up."

### Data flow, precisely

```
   document ──adapter──▶ STATE ─────────┐
                          ▲             ▼
   GENERATION ──mutates──┘        EVALUATION(RULES, STATE) ──▶ { violations, score }
        ▲                                                              │
        └──────────────── keep / revert ◀─────────────────────────────┘
```

- **Adapter** turns a raw document (flat, or nested tenant) into `State`. It is a
  *behaviour that produces State*, so it belongs **with State**, not as a separate
  "domain model" layer. (Earlier drafts over-split this: the "domain model" is
  just *Schema types* + *the adapter*. There is no third thing.)
- **Rules** never run anything. They are inert, declarative descriptors
  (`{ key, kind, enabled, check }` for constraints; `{ key, weight, score }` for
  scorers). Pure, and they read only Schema.
- **Evaluation** is a pure function of `(Rules, State)`. It owns neither: a
  consumer hands it State (or a `ctx` that reads State) and it returns a verdict.
  This is the "one authority, many consumers" seam (see [generation.md](generation.md)):
  the generator's eligibility check and the manual-swap check and the whole-roster
  validator are all the **same Evaluation** over **different State**.
- **Generation** is the only agent that *mutates* State. It loops: propose a
  placement → apply to State → Evaluate → keep if legal & better, else revert.

### The one rule that fixes every boundary question

> **The domain core is a pure function of a single State snapshot.**

Everything the core does is `f(Rules, State) → verdict` or `g(State, seed) →
State'`. It has **no notion of** *time* (previous versions, draft-vs-committed),
*persistence* (documents, backends), or *who is asking* (UI, bot, cron). Those
three concerns live **outside** the core:

- **Time** → the **Session** layer (draft/commit, undo/redo).
- **Persistence** → the **Provider** layer (documents).
- **Callers** → the **Command surface** (UI, integrations are peers).

The single exception that belongs *to* the core is the **adapter**, because it
*defines* what a valid State is (below).

### Document vs. Adapter vs. State — three things, not one

A recurring question is whether the document/adapter should be "relegated to the
provider layer". No — there are **three** distinct things, and ownership follows
the *dependency arrow, not physical proximity to loading*:

| Thing | What it is | Owner | Why |
| --- | --- | --- | --- |
| **Document** | the serialized roster (YAML text / DB rows) | **Provider** | a persistence/wire format |
| **Adapter** | pure transform `document → State` (and `State → document` write-back) | **Core (inbound port, `state/`)** | its *output contract is the core's State*; it is the anti-corruption boundary |
| **State** | in-memory working shape the core operates on | **Core** | what Rules/Evaluation/Generation read |

**The adapter is the core's inbound port (anti-corruption layer).** If it were
relegated to the provider, every backend (local, Supabase, a future import tool)
would have to re-know the core's State shape — leaking the core's contract into
each backend. Instead the provider's job ends at "here is a *parsed document*";
the adapter turns any valid document into State.

**Adapters are NOT storage-backend-specific.** Verified in the code: the adapter
branches only on `isTenantShape(data)` — the document's *shape* (flat vs.
nested-tenant) — and contains **zero** `supabase`/`provider` conditionals. Both
providers hand it the same document shapes. The dividing line:

> **Shape-mapping (flat ⇄ nested) is core-side; byte-serialization (YAML text vs.
> SQL rows) is provider-side.** The adapter is the former, so it belongs to the
> core. A provider may *serialize* differently; it must still produce the same
> document *shapes* the adapter understands.

(Write-back — `withRosterEvents`, `tenantSelection`, roster enumeration — is the
adapter's `State → document` direction; it too is shape-mapping, sitting at the
core↔provider seam, distinct from the provider's actual persistence. There is no
full `toDocument(State) → document` — see the naming table's adapter note.)

**One provider per backend; ONE shared adapter for all of them.** A common
mistake would be to give each backend its *own* adapter. Don't:

- **Provider = per backend** — `useLocalRosterProvider` vs. `useSupabaseRosterProvider`
  differ because *byte-serialization* differs (file read/write vs. SQL rows).
- **Adapter = one, shared** — because shape-mapping is backend-agnostic (verified:
  the adapter branches only on `isTenantShape`, never on the backend). Per-backend
  adapters would each re-implement flat/nested→State and inevitably **drift** —
  precisely the `active`/`include` class of bug. Keeping exactly one adapter is
  what makes local and Supabase *provably equivalent* to the core.

```
   local  provider ─┐
                     ├─▶  document (shared SHAPES) ─▶ ONE adapter ─▶ State ─▶ core
   supabase provider─┘
```

> A provider's whole job is to emit/accept documents in the **shapes the single
> adapter already understands**. It never speaks State.

**The adapter is itself founded on Schema.** Its *output* is State, and State is
defined in Schema's vocabulary — you cannot produce State without speaking
`YAML_FIELDS`/member shape (verified: `derivedState.js` already imports schema
helpers). So the adapter sits *on* Schema exactly as Rules and State do (the
T-shape) — which is another reason it belongs to the core: its output contract is
Schema-/core-defined, not provider-defined.

### The command surface — one vocabulary, many callers

Because the core doesn't care *who* is asking, all actors (UI clicks, bot
commands, cron jobs) call the **same** small, uniform set of operations. Model
State as the resource and actions as verbs on it — REST-*ish* in spirit
(a CQRS split of **queries** vs **commands**), not literal HTTP:

| Verb | Kind | Effect |
| --- | --- | --- |
| `read` / `query` | query | derived read-model (e.g. "who's on duty") — no mutation |
| `validate` | query | run Evaluation without mutating |
| `generate` | command | produce a candidate State (create-like) |
| `assign` / `unassign` / `swap` | command | mutate a placement (update-like) — **each gated by Evaluation** |
| `commit` | command | persist the draft (Session → Provider handoff) |
| `undo` / `redo` / `revert` | command | Session history ops (see below) |

> **Guard-rail: a command *vocabulary*, not an HTTP API.** Keep it CQRS-flavoured
> because (a) commands carry rule-*verdicts* — a `swap` can be **rejected** by
> Evaluation, which is not a clean REST PUT — and (b) reads come from a derived
> read-model, not the write resource. The value is *uniformity across callers*
> (so "UI vs bot" is irrelevant), **not** HTTP semantics. Do not build an
> in-process REST router.

### Each layer has a vocabulary fit to its nature

The vocabulary gets **more REST/CRUD-like closer to storage, and more
command-like closer to the domain** — because storage *is* plain resource CRUD
while the domain is *behaviour that carries verdicts*. These are the same
principle (fit the vocabulary to the layer), not a contradiction:

| Layer | Vocabulary style | Verbs | Why |
| --- | --- | --- | --- |
| **Command surface** (session) | **commands + queries** (CQRS) | `generate` · `assign`/`unassign`/`swap` · `validate`/`query` · `commit` · `undo`/`redo` | actions carry rule-*verdicts*; a command can be **rejected**. Not plain CRUD. |
| **Provider** (storage) | **CRUD / REST** | `load` · `save` · `list` · `select` · `subscribe` | persistence *is* plain resource CRUD on the *document* — no verdicts. Formalize `RosterProvider` as this contract so local/Supabase are provably interchangeable. |
| **Adapter** (core inbound port) | **two pure fns** (no verbs) | `toState(document) → State` · (reverse) `withRosterEvents(document, sel, events) → document` | a *transform*, not an actor. Giving a pure function CRUD verbs miscasts it. **No full `toDocument(State) → document` exists — deliberately:** nothing reconstructs a whole document from State (the raw document stays the source of truth; only *events* round-trip, via `withRosterEvents`), so building the mirror-image `toDocument` would be a function with no consumer. The forward transform is a full `document → State`; the reverse is the narrow events-only `withRosterEvents`. |

So: **DO use a CRUD vocabulary at the provider; do NOT force HTTP-REST on the
command surface.** Both follow from "fit the vocabulary to the layer's nature."

### Naming mandate: folders/files reflect *layers*; symbols reflect *vocabulary*

This overhaul is as much a **renaming** as a re-foldering. Two rules, enforced
per-change (extend [`../AGENTS.md`](../AGENTS.md)'s isolated-vs-shared check):

1. **Folders and filenames reflect the layer a module belongs to.** A file's path
   should announce its layer: rules live in `rules/`, the judge in `evaluation/`,
   the agent in `generation/`, persistence in `data/`, the time layer in
   `session/`. No more `utils/` grab-bag; if you can't name the layer a file
   belongs to, that's a smell to resolve, not a file to drop in `utils/`.
2. **Function and variable names reflect the layer's vocabulary** (the tables
   above). A provider method is CRUD (`loadDocument`, `saveDocument`), a session
   op is a command/query (`generateDraft`, `requestSwap`, `commitDraft`,
   `undo`), an adapter fn is a transform (`toState` and the reverse
   `withRosterEvents`), a rule is a
   descriptor (`{ key, kind, check }`). Avoid cross-vocabulary names — e.g. don't
   call a session command `saveEvents` (that's CRUD leaking up) or a provider
   `applySwap` (that's a command leaking down). The name should tell you which
   layer you're in.

Concrete renames this implies (examples, not exhaustive; do them as the owning
files move): `updateEvents` → a session command — **done as `stageEvents`** (not
`applyDraftEdit`, which stays the internal `useDraftHistory` transition, so the
surface command and the internal transition don't share a name); the YAML-editor
edit `replaceData` → the command **`stageDocument`**;
`generateRoster` stays the pure-core producer but the *click handler* becomes the
session command `generateDraft`; provider `load`/`save`/`refreshSchema` keep CRUD
names; the adapter's `toState`/`resolveState` (was `getDerivedState`/`resolveDerivedState`) + `resolveTenant` read as `toState`-family
transforms. Record each rename's rationale in the naming-decisions section.

### Integrations split: read-model consumers vs. command-surface actors

"Integrations" is two different things and must not be lumped:

- **Outbound / read integrations** — reminder cron that reads the roster and
  messages people, calendar *export*, "who's on duty" bot queries. They consume a
  **committed read-model** (via the provider); they never touch the live core.
  → periphery.
- **Inbound / write integrations** — a bot command "swap me out Tuesday",
  "regenerate next month". These are **actors issuing domain commands**, exactly
  like a UI click, and **must go through the command surface** so the same
  Evaluation gate applies. They are **peers of the UI**, not a special path into
  the core. → they call the command surface; they do not reach into internals.

This *strengthens* "one authority, many consumers": the consumers of Evaluation
now include bots — same rules, more callers.

### Session layer: where draft/commit + undo/redo sit

Draft/commit and undo/redo are **neither core nor storage** — they are the
**Session** layer, because they are about **editing sessions over time**, not
about whether a roster is legal:

- The core is **timeless**: `(Rules, State) → verdict` has no "previous version".
- **Undo/redo** = a *history of States*; **draft-vs-committed** = *which State is
  authoritative yet*. Both are temporal/workflow concerns the Session owns.
- **Commit** is the *handoff*: Session promotes draft State → asks the Provider to
  persist the resulting document. That is the **only** moment storage is touched;
  draft edits never hit storage.
- If the core knew about "commit", Evaluation would need to know draft-vs-committed
  and stop being pure — losing the reuse across UI/bot/validator.

Two history scopes exist today and must not be conflated: `useDraftHistory.js`
(edit history) vs. the draft→commit boundary. Both are Session concerns.
`useDraftHistory.js` lives under `session/`, and the draft/commit + undo/redo
overlay is owned by [`useSession.js`](../src/session/useSession.js), which
**wraps** a provider. The providers are **pure CRUD** (`saveEvents`,
`replaceDocument`) with no draft state; `useRosterData` composes
`useSession(provider)`. Session detects a "new committed document" (import /
clear / roster or team switch / background load) by the provider's `originalData`
reference changing and resets the draft then — a `saveEvents` commit leaves
`originalData` untouched, so the history stacks survive a commit.

### Generation runs *on* the Session's State — it doesn't live there

The generator-the-algorithm is pure — `(State, Rules, seed) → candidate State` —
and stays in the **core**. Only the *act of running it as a user action*
("regenerate next month": deciding when, capturing the result as a new draft,
pushing it onto the undo stack) is a **Session** concern. The Session calls
*down* into Generation and files the result into history; Generation never reaches
*up* into the Session. (Same relationship Evaluation has with its callers.)

**Worked example — this is already how the code behaves.** Clicking *Generate*
today does exactly what the model prescribes, which is the strongest evidence the
split is real:

```
click Generate → generateRoster(...)   [pure CORE: produces candidate events]
              → updateEvents(result)   [SESSION: lands in DRAFT + pushes undo snapshot]
              → NOT persisted until you click Commit  [commitDraft(): Session→Provider]
```

The handler comment says it outright — *"Generation is non-destructive — it lands
in the draft and is fully undoable (Ctrl/Cmd+Z)"* (`App.jsx` `handleGenerateRoster`),
and undo/redo *"navigate the draft history and NEVER touch committed state"*
(`App.jsx` `handleUndo`). So generated placements are **drafted, fully undoable,
and only committed on an explicit separate action** — the pure core produced
them; the Session decided they were a draft. The refactor only *moves*
`updateEvents`/history/`commitDraft` from `App.jsx` into a named `session/`
module and renames them to session-command vocabulary (see naming mandate); the
behaviour is unchanged.

### Why Evaluation and Rules are different (not the same layer)

They are as different as **a law book and a courtroom**:

| | **Rules** | **Evaluation** |
| --- | --- | --- |
| Is | a *library of definitions* (data + pure fns) | a *process* that runs them |
| Knows about | one `placement` + a supplied `ctx` | the whole roster; builds the `ctx` |
| State | stateless | walks state, aggregates results |
| Output | per-rule verdict / score | aggregate `{ violations, score }` |
| Analogy | the law | the judge applying the law |

A rule like `once-per-week` only asks `ctx.weeklyCount(...)`; it has no idea
where that count came from. Evaluation is what *computes* the count and feeds it
in. Same rule, different evaluators → the reuse that keeps generate/validate/swap
consistent.

**`ctx` IS the Rules↔Evaluation contract — name it, protect it.** The uniform
counting interface (`currentRoster` / `weeklyCount` / `monthlyCount` /
`overlappingEvents`, per [generation.md](generation.md)) is the literal edge of
the triangle: **Evaluation *supplies* `ctx`; Rules *consume* it.** It is the seam
that lets one rule run **tracker-backed** (the generator's live
`assignmentTracker`) or **scan-backed** (the validator's whole-roster pass) — and
it is *also* where cross-team load folds in (a `ctx` that counts external
assignments too). Whoever owns `ctx` owns the contract: it lives at the
**Evaluation** boundary, is defined once, and Rules must depend on *nothing else*
about State. A refactor that lets a rule reach past `ctx` into raw State breaks
the "same rule, many evaluators" property — treat `ctx`'s shape as an invariant.

> **Guard-rail: this is a rule-engine *shape*, not a rule-engine *implementation*.**
> The value is the *separation* (Rules ⋈ State → verdict), which already exists in
> the code. Do **not** build a Rete network, a rules DSL, or a runtime "solver
> service" everything calls into. The core is a small, pure, typed library of a
> dozen descriptors — not a framework.

### Adding rules: two senses of "customizable"

A rule engine's promise is "easy to add rules." This architecture delivers that —
but keep two senses distinct, because only one of them should ever become code:

| Sense | What it means | How this design supports it | Status |
| --- | --- | --- | --- |
| **Developer-extensible** | add a new rule *type* in code | drop one descriptor in the `rules/` registry (`{ key, kind, check }` for a constraint; `{ key, weight, score }` for a scorer) and **every** consumer — generator, validator, swap — picks it up via "one authority, many consumers" | **both** ✅ today (`CONSTRAINTS` **and** `SCORERS` are registries); **step 2** only unifies them under one `rules/` home + a shared `defineRule`/`defineScorer` factory |
| **Data-tunable** | toggle/tune existing rules per roster | `enabled` flags + values (caps, weights) are **data in the document**, read via `getConstraintValue`; users tune *parameters*, not logic | ✅ today |

> **Guard-rail: do NOT add a third sense — a user-facing rules DSL** where users
> author arbitrary new rule *logic* at runtime. That is the Rete/DSL trap above.
> "Customizable" = a code-extensible registry + data-tunable parameters. A dozen
> well-named, parameterized descriptors beat a mini-language. Both registries
> already exist; **step 2 unifies their home and factory, it does not build
> scoring from scratch.**

### Two kinds of "validation" — do not conflate them

There are **two** validators in this system and they belong to **different
layers**. The plan's `evaluation/` layer is *not* their shared home:

| | **Document validation** (`validators.js`) | **Roster Evaluation** (`assignmentValidator`, `eligibilityChecker`, `swapPolicy`) |
| --- | --- | --- |
| Question | "is this **document** well-formed?" (roles resolve, dates parse, handles valid) | "is this **placement** legal / how good?" (rule verdicts) |
| Operates on | a raw/parsed **document** | **State** + **Rules** |
| Output | `data.warnings` (display-only, stripped before save) | `{ violations, score }` |
| Layer | **Domain model / State** (shape integrity, on the way in) | **Evaluation** (the judge) |

`validators.js` (`runAllValidators` + its 9 checks) is **document-shape
integrity**, adjacent to the adapter — it validates what the adapter is about to
turn into State. It is *not* rule-Evaluation and must not be folded into
`evaluation/`. Target home: alongside the adapter in `state/` (e.g.
`state/documentValidation.js`), still feeding `data.warnings` via the provider
contract. (See [data-layer.md](data-layer.md) for the `data.warnings` contract.)

## The periphery

The domain core is wrapped by five concerns that don't belong inside it:

| Concern | Role | Depends on the core how |
| --- | --- | --- |
| **Presentation** | Views + design-system foundation. Renders verdicts; lets humans override. | Reads State + Evaluation output; issues edits. |
| **Read-model** | Aggregate *views* of the current roster for humans (stats, availability heatmap, distribution). Recomputed live from State. | Reads State (and shares counting *primitives* with Rules) — but **never routes through the placement registry** (see bright line below). |
| **Application / Session** | Roster selection, draft/commit, undo/redo — the runtime *conduit* wiring UI ↔ Storage ↔ core, and the **command surface** all actors call. **A conduit, not the core.** | Holds the live draft State; invokes Generation/Evaluation; hands verdicts back. |
| **Storage / Providers** | Local in-memory + Supabase, behind the `RosterProvider` contract. | Persists the *document* State is built from. |
| **Integrations (aux)** | Two kinds: **read** (cron reminders, calendar export, "who's on duty" bot) consume the committed read-model; **write** (bot commands) are actors on the command surface. | Read kind: via provider read-model. Write kind: via the command surface (peer to UI). |

And two **cross-cutting** concerns that deliberately span layers:

- **Authorization** — `(actor, action, target)`; the permission-role vs.
  team-role invariant (must not be conflated). Spans Storage (RLS is the real
  authority), the document model (tenant scoping), and Presentation (which
  controls render). Owned by [permissions.md](permissions.md) — **not** folded
  into the data/session layer, because it cuts across all of them.
- **Platform / lib** — genuinely generic helpers with no domain knowledge (date,
  colour, export). Depended on by anyone; depends on nothing. This is the `lib/`
  that stops `utils/` from re-forming as a grab-bag.

### Read-model vs. Evaluation — a bright line, not adjacency

Both "read State and compute something", so they look adjacent — but they answer
**different questions** and must not share the placement registry:

> **Evaluation** answers *"is this placement legal / good?"* → per-rule verdicts,
> routed through the `CONSTRAINTS`/`SCORERS` registries.
> **Read-model** answers *"what does the current roster look like?"* → human-facing
> aggregates (per-member counts, availability heatmap, distribution).

They **share counting *primitives*** (both tally assignments) but the read-model
**must NOT route through the placement registry** — [generation.md](generation.md)
calls that a *category error*, and the availability heatmap is a deliberate
**non-consumer** of the rules. Two invariants hold the line:

- **Read-model is recomputed live from State, never a stored snapshot**
  ([data-layer.md](data-layer.md): "statistics are real-time"). A refactor must
  not cache/persist it.
- **Read-model reads State; it never mutates it and never emits verdicts.** If a
  "stat" starts deciding legality, it belongs in Evaluation, not the read-model.

Target home: its own periphery folder (`readmodel/`), *not* inside `evaluation/`
(different question) and *not* in `lib/` (it knows the domain). This resolves the
earlier "decide in step 8" waffle for `rosterStats`/`availabilityUtils`/
`distributionUtils`.

### Full picture

```
        ┌───────────────── PRESENTATION ─────────────────┐
        │            views + design tokens               │
        └───────────────────────┬────────────────────────┘
                                 │ calls command surface
        ┌──────────── APPLICATION / SESSION ──────────────┐
        │  command surface (query/generate/swap/commit…)  │
        │  draft/commit · undo/redo   ← the "time" layer  │   conduit, not core
        └───────┬─────────────────────────────┬───────────┘
                │ commit → persist             │ generate / evaluate / mutate
        ┌───────▼────────┐            ┌────────▼───────────────────────┐
        │   STORAGE /    │  document  │        DOMAIN CORE             │
        │   PROVIDERS    │──adapter──▶│  Generation ⇄ State ──────────┐│
        │ local│supabase │  (in-port) │  Evaluation = Rules ⋈ State   ││
        └───────┬────────┘            │  all speaking  Schema         ││
                │                      └───────────────────────────────┼┘
                │                              reads State (live) │     │
                │                       ┌──────────────────────────────▼─┐
                │                       │  READ-MODEL  stats · heatmap ·  │
                │                       │  distribution (NOT via registry)│
                │                       └─────────────────────────────────┘
        ┌───────▼───────────────────────────────┐
        │  INTEGRATIONS (aux)                    │
        │   read  → committed read-model (via provider)
        │   write → command surface (peer to UI)│
        └───────────────────────────────────────┘

   AUTHORIZATION  ── cross-cuts Storage (RLS) · document model · Presentation
   PLATFORM/lib   ── date · colour · export : used by any layer, depends on none
```

## Target folder layout

```
src/
  schema/        # THE VOCABULARY — field/enum names + definitional predicates.
                 #   Zero imports. Rules AND State both depend on it.
                 #   + understudy *vocabulary* (isUnderstudyRole, baseRoleOf,
                 #     understudySlotRole, normalizeMemberRoles, UNDERSTUDY_SUFFIX)
  config/        # tunable defaults (rosterDefaults)

  # ── domain core ──────────────────────────────────────────────
  rules/         # constraints + scorers registries (declarative, pure)
                 #   an instance of the "policy-registry pattern" (see below);
                 #   authz/ is a SEPARATE instance — same shape, no shared base
                 #   from utils/constraints.js, constraintPrimitives.js,
                 #        rosterGenerator/scorers.js
                 #   + understudy *policy* (isPromotedForRole, canFillSlotRole,
                 #     countUnderstudySessionsBefore, UNDERSTUDY_MIN_SESSIONS)
  state/         # the facts + the ADAPTER (core's inbound port) that builds them.
                 #   Owns EXACTLY the State shape + its transforms — nothing else.
                 #   from utils/derivedState.js, tenantResolver.js,
                 #        rosterGenerator/rosterState.js, assignmentTracker.js
                 #   (shape-mapping only — NOT byte-serialization)
                 #   state/documentValidation.js  # doc-shape gate on the way IN
                 #        (from validators.js) — a distinct sub-concern, NOT the
                 #        State transform and NOT rule-Evaluation
  evaluation/    # inference: apply rules to state (the JUDGE)
                 #   from utils/assignmentValidator.js, swapPolicy.js,
                 #        rosterGenerator/eligibilityChecker.js
  generation/    # the AGENT: search/optimize by mutating state
                 #   from rosterGenerator/index.js, localSearch.js, rng.js,
                 #        understudySeeding.js, promotionPlanning.js  (phases)

  # ── periphery ────────────────────────────────────────────────
  readmodel/     # human-facing aggregate VIEWS of State (recomputed live)
                 #   from utils/rosterStats.js, availabilityUtils.js,
                 #        distributionUtils.jsx
                 #   reads State; shares counting primitives with rules/ but does
                 #   NOT route through the placement registry (category error)
  data/          # storage PROVIDERS + the RosterProvider contract (pure backends;
                 #   byte-serialization lives here — YAML text / SQL rows)
  session/       # command surface + draft/commit + undo/redo (the "time" layer)
                 #   from data/useDraftHistory.js (moved out of data/),
                 #        hooks/useRosterData.js
                 #   FUTURE split (triggered): session/commands (stateless surface,
                 #     authz+rule pre-check) + session/store (draft + history)
  hooks/         # useAuth and other React glue
  components/    # presentation UI (views, panels, modals, shared primitives)
  design/        # presentation vocabulary: designSystem.js (glass tokens),
                 #   colorUtils.js (functional role/day palette + date formatting)
                 #   from utils/statsTheme.js (renamed), utils/colorUtils.js
  integrations/  # read: cron/calendar-export/bot-query (read-model consumers)
                 # write: bot commands (actors on the session command surface)
                 #   telegram.js lives here (read-only today; write path future)

  # ── cross-cutting ────────────────────────────────────────────
  lib/           # generic helpers: calendarUtils, dataExport
                 # (authorization has no single folder by design — it lives in
                 #  supabase/ RLS + provider permission flags; see permissions.md)

  App.jsx, main.jsx   # composition root (wires session → core → providers)
```

> **Understudy is not a folder — split it by *kind*.** Today `understudy.js` is
> imported by **11 modules across every layer** (validators, adapter, constraints,
> swapPolicy, availability, 4 generator files, assignmentValidator, EventsView),
> which looks "cross-cutting" only because the one file **mixes three kinds** of
> thing. Split them and each part sits neatly in exactly one layer:
>
> | Understudy export | Kind | Target layer |
> | --- | --- | --- |
> | `isUnderstudyRole`, `baseRoleOf`, `understudySlotRole`, `normalizeMemberRoles`, `UNDERSTUDY_SUFFIX` | **definitional** (facts about role naming) | **Schema** — pure vocabulary; legitimizes the many importers |
> | `canFillSlotRole`, `isRoleCapable`, `isPromotedForRole`, `countUnderstudySessionsBefore`, `UNDERSTUDY_MIN_SESSIONS` | **policy / derivation** (judgements & thresholds) | **Rules** (the promotion gate; applied by Evaluation) |
> | seeding / promotion steps | **generation phases** | **Generation** (`understudySeeding`, `promotionPlanning`) |
>
> The same *definitional-vs-policy* test used for `isMemberIncluded` applies:
> "is this member understudy-capable?" is a fact (Schema); "is this member
> *promoted yet*?" and "how many sessions are required" are policy (Rules).
> [understudy.md](understudy.md) remains the authority for the feature's rules.
>
> **A second, orthogonal axis: scope/derivation (do not lose it).** Beyond
> *kind*, understudy data splits by **where it lives and whether it is stored**
> ([understudy.md](understudy.md)): **declaration** is team-scoped *stored* data
> (a member is an understudy for role X); **progress** (sessions served) is
> **roster-derived, never stored**; **promotion** (has crossed the threshold) is
> a **generation outcome, never stored** — it is recomputed, not persisted. This
> is a load-bearing invariant: a refactor must **not** "helpfully" add a stored
> `promoted`/`sessionsServed` field. The kind-split above must carry this axis —
> the Rules-layer promotion gate *derives* promotion from `ctx`; it does not read
> a stored flag.

## Naming decisions (and rejected alternatives)

- **"Evaluation" not "scheduler engine".** It *judges*; it does not schedule.
  Calling the judge a "scheduler" invited confusion with the generator.
- **"Generation" not "generator/scheduler engine" ambiguity.** Generation is the
  thing that actually schedules (produces a roster).
- **No "domain model" layer.** It collapses into Schema (types) + the adapter
  (a State-producing behaviour). A separate layer was double-counting.
- **Schema is orthogonal, not the stack floor.** Rules and State both sit on it;
  it is not "under" the rules in a linear tower.
- **Authorization stays cross-cutting**, not a sub-item of the data layer —
  it spans storage/model/UI and is owned by [permissions.md](permissions.md).
- **`rules/` is the domain heart but not the dependency sink.** Arrows point
  *into* it via the `ctx` seam; it imports only Schema. Keep it that way.
- **`ctx` is the Rules↔Evaluation contract**, owned at the Evaluation boundary.
  Rules read State *only* through `ctx`; its shape is an invariant (it's what lets
  one rule run tracker-backed or scan-backed, and where cross-team load folds in).
- **Read-model is a distinct periphery layer**, not part of Evaluation and not
  `lib/`. It answers "what does the roster look like?" (live aggregates), never
  "is this legal?"; it must not route through the placement registry, and it is
  recomputed live, never stored.
- **Adapter belongs to the core, not the provider.** It is the inbound
  anti-corruption port; it maps document *shapes*, not backend bytes. Relegating
  it to providers would leak the core's State contract into every backend.
- **Draft/commit + undo/redo are a `session/` layer, not core or storage.** The
  core is timeless; "time" (history, draft-vs-committed) is a Session concern.
  `useDraftHistory.js` moves out of `data/`.
- **A command surface, not a REST API.** Uniform verbs so UI/bot/cron are
  interchangeable callers; CQRS-flavoured (commands carry verdicts), not HTTP.
- **Rules & Authz share the "policy-registry pattern", not a base type.** Same
  `(subject, ctx) → verdict` shape, separate instances (`rules/`, `authz/`); a
  shared base is deferred to a *third* instance with matching types. See
  "Resolved: the policy-registry pattern".
- **`session/` split is endorsed but sequenced.** Extract `session/` as one layer
  first; split into `session/commands` (stateless, authz+rule pre-check) +
  `session/store` (draft+history) when authz-at-the-surface or a write-integration
  lands. Don't split into an anemic pass-through.
- **Understudy splits by kind** (vocabulary→Schema, policy→Rules, phases→
  Generation) rather than living as one cross-cutting file.
- **One shared adapter, one provider per backend.** Per-backend adapters would
  re-implement shape-mapping and drift; a single adapter keeps backends provably
  equivalent to the core.
- **Vocabulary fits the layer.** Provider = CRUD (`load`/`save`/`list`/`select`);
  session command surface = CQRS (`generate`/`swap`/`commit`); adapter = pure
  transforms (`toState`/`toDocument`). Storage is CRUD, the domain carries
  verdicts — so REST fits the provider, not the command surface.
- **Folders/files name the layer; symbols name the vocabulary.** The path tells
  you the layer; the identifier tells you the layer's verb-kind. No `utils/`
  grab-bag; no cross-vocabulary names (`saveEvents` on the session, `applySwap`
  on a provider).
- **"Customizable" = registry + data params, never a runtime rules DSL.**

## Resolved: the policy-registry pattern & the session split

Two refinements that were open are now **decided** (both refine, neither reverses,
the model):

### 1. Rules & Authorization share a *pattern*, not a *core*

Both are pure `(subject, ctx) → verdict` descriptor sets read from a registry, so
they *rhyme*. The decision is the **middle** of three positions:

| Position | Meaning | Verdict |
| --- | --- | --- |
| A. Shared implementation | one `PolicyRegistry` base both extend | ❌ over-coupling |
| **B. Shared pattern, separate instances** | both *follow* the shape; implemented independently | ✅ **chosen** |
| C. Unrelated | treat as having nothing in common | ❌ loses a real teaching aid |

**Why B, not A:** the two domains **change for different reasons** (a new
scheduling constraint vs. a new permission tier) and their types will **diverge** —
Rules' verdict is `{code, params}`/score with a counting-heavy `ctx`
(`weeklyCount`, `overlappingEvents`); Authz's verdict is `boolean(+reason)` with
an identity `ctx` (`actor`, `claimed_user_id`, tenant scope). A shared base would
degrade to a lowest-common-denominator type or grow unions serving neither. With
only **two** instances, a shared abstraction is premature (rule-of-three). The
teaching value A reached for is captured **for free** by naming the pattern — no
coupling incurred.

> **Named convention — the "policy-registry pattern".** *A set of pure
> `(subject, ctx) → verdict` descriptors + a registry that consumers read from.*
> Instances: `rules/` (scheduling) and `authz/` (access). **Instances do NOT
> share a base type or module** — they share the shape only. A reader should
> recognize the idiom; the compiler should not link them.
>
> **Revisit trigger:** only if a **third** instance appears (e.g. a notification
> policy) *and* all three genuinely share verdict + `ctx` types — then consider a
> thin `defineRegistry` *factory* (still not a base class). Two instances:
> pattern-only.

### 2. Split `session/` — endorsed, sequenced (not big-bang)

The Session layer carries **two natures** — a *stateless* **command surface**
(`generate`/`swap`/`commit`/`validate`: request → core with authz+rule
pre-checks → verdict) and a *stateful* **session store** (draft State + undo/redo
history). That stateless-vs-stateful seam is the same one separating Evaluation
from State in the core, so the split is principled.

**For:** the command surface is trivially testable (input → verdict, mocked
store); the **write-integration path** needs the command surface but **not** React
undo/redo, so fusing them makes a bot drag in history machinery it can't use; the
two change on different axes; and `useDraftHistory.js` *already is* the store half
sitting alone — it's the command surface that's smeared into `App.jsx`.

**Against:** for a single (UI-only) caller today it adds a boundary whose payoff is
latent; done too early it risks an **anemic pass-through** (a file that only
forwards calls); and `commit` spans both halves, so the handoff owner must be
defined or chatty coupling returns.

> **Decision:** the split is **endorsed but sequenced.** Step 6 extracts
> `session/` as *one* layer first; **then** split it into `session/commands`
> (stateless surface — the home of the authz/rule pre-check) and `session/store`
> (draft + history) **when the first trigger lands: authz-enforcement-at-the-
> command-surface *or* the first write-integration** (whichever is first). The
> authz pre-check wants to be a stateless surface concern *anyway*, so it must not
> be tangled in the history stack — that trigger alone justifies the split.
> Guard-rail: don't split into a pass-through; the surface earns its keep only
> when it holds real logic (authz + rule-verdict → apply/reject).

## Suggested refactor order (each step green)

Highest payoff first; every step keeps `npx vitest run` + `npm run build` green
and updates the owning spec:

1. **✅ DONE — Extract `rules/`** (move constraints + primitives; no behaviour change).
   Establishes the core's home and its "imports only Schema" boundary.
2. **✅ DONE — Unify the two rule registries under `rules/`.** `CONSTRAINTS` and `SCORERS`
   are *both already registries* (`scorers.js` holds `SCORERS`, consumed by
   per-candidate scoring **and** whole-roster `evaluateState`). This step *moves*
   `SCORERS` next to `CONSTRAINTS` and adds a shared `defineRule`/`defineScorer`
   factory + a conformance test — it does **not** build scoring from scratch.
   (Update [generation.md](generation.md).)
3. **✅ DONE — Extract `state/`** (adapter + rosterState + tracker together, plus
   document-validation renamed to `state/documentValidation.js`). Names the
   working-memory concern; deletes the "domain model" ambiguity.
4. **✅ DONE — Split `evaluation/` from `generation/`** inside today's `rosterGenerator/`.
   Separates judge from agent. (`assignmentValidator`, `swapPolicy`, and
   `eligibilityChecker` now live in `evaluation/`; the generator imports the judge.)
5. **✅ DONE — Split `understudy.js` by kind**: vocabulary → `schema/understudyRoles.js`,
   policy → `rules/understudyPolicy.js`, leaving seeding/promotion phases in `generation/`.
   Cleared steps 1/3/4's residual coupling. Updated [understudy.md](understudy.md).
6. **✅ DONE — Extract `session/` and lift it above the provider**: moved
   `useDraftHistory.js` out of `data/` into `session/` (git mv), then completed the
   **full inversion**: added [`useSession.js`](../src/session/useSession.js) which
   **wraps** a provider and owns the draft/commit + undo/redo overlay plus the
   `updateEvents`/`replaceData` command surface. Providers are now **pure CRUD** —
   they expose `saveEvents`/`replaceDocument` and no longer touch drafts; Session
   sits *above* Provider and calls `saveEvents` on commit. `useRosterData` composes
   `useSession(provider)`, so the UI's flat surface is unchanged. **Defer** the
   internal `session/commands` vs. `session/store` split until authz-at-the-surface
   or the first write-integration lands (see "Resolved: the session split").
7. **✅ DONE — Formalize the `RosterProvider` CRUD contract**: split the contract
   into `PROVIDER_KEYS` (pure CRUD storage surface) + `SESSION_KEYS` (draft/history
   + edit commands the Session adds), with `ROSTER_PROVIDER_KEYS = [...PROVIDER_KEYS,
   ...SESSION_KEYS]` as the full composed surface. The conformance test renders
   *both real providers* and asserts each returns exactly `PROVIDER_KEYS`, plus
   asserts `useSession(provider)` returns exactly `ROSTER_PROVIDER_KEYS` — so both
   the backends and the Session composition are *provably* correct. The structural
   simplification (lifting the draft group off the provider surface) is done as part
   of the step-6 Session inversion above. The adapter's `toState`/`toDocument`
   transform rename rides along with step 9. (Recorded in [architecture.md](architecture.md), which owns the provider contract.)
8. **✅ Tidy periphery** (sub-committed): **8a ✅** promoted
   `rosterGenerator/` → top-level `src/generation/` (a module, not a util). **8b ✅**
   moved the read-model views (`rosterStats`, `availabilityUtils`, `distributionUtils`)
   → `src/readmodel/`. **8c-i ✅** moved generic helpers (`calendarUtils`, `dataExport`)
   → `src/lib/`. **8c-ii ✅** resolved the misnamed `statsTheme` — it's the
   design-system token module, not a stat — renaming it to `designSystem` and moving it
   (with `colorUtils`, its lint guard, and both tests) to a new `src/design/` folder.
   **8d ✅** moved `telegram.js` → `src/integrations/` (file move; it's a read-only
   integration today, so there was no write path to split — the future bot **write**
   path routing through the session command surface stays foreshadowed).
9. **◑ (rides along) Vocabulary rename pass** (folds through every step above, not a separate
   big-bang): as each file moves to its layer folder, rename its symbols to the
   layer's vocabulary (provider→CRUD, session→command/query, adapter→transform,
   rule→descriptor). Do it *per moved file* so each stays green; record notable
   renames in the naming-decisions section. **Landed so far:** the adapter transforms
   (`getDerivedState`/`resolveDerivedState` → `toState`/`resolveState`); the Session
   commands (`updateEvents` → `stageEvents`, `replaceData` → `stageDocument`). **Two
   deliberate non-renames** (recorded so they're not "fixed" later): (a) the provider
   write ops keep `saveEvents`/`replaceDocument` rather than collapsing to the table's
   idealized `saveDocument` — they save *different scopes* (events-only vs. non-event
   doc), so a single `save*` name would be *less* accurate, not more; the table's
   `load`/`save` are style guidance, and these already read as CRUD. (b) The per-action
   domain **commands** the table lists (`assign`/`unassign`/`swap`) are **not** created
   here: today the UI computes `nextEvents` and funnels it through the single
   `stageEvents` command, so there is no `assign`/`swap` to rename *to*. Splitting
   `stageEvents` into evaluation-gated per-action commands (target model, §"The command
   surface") is a **behaviour change** (a command becomes *rejectable* by Evaluation) and
   is therefore **out of scope for this structural overhaul** — see the follow-on note
   below.
10. **✅ (done) Enforce the graph**: a dependency-free Vitest guard
    ([`src/__guards__/dependencyDirection.lint.test.js`](../src/__guards__/dependencyDirection.lint.test.js))
    that fails CI on an arrow pointing the wrong way (e.g. `rules/` importing `evaluation/`,
    or the core importing `session/`/`data/`). Chosen over `dependency-cruiser` to match
    the repo's existing guard precedent (the design-system lint) — no new tooling. The
    allowed-arrows matrix lives in [architecture.md](architecture.md) ("Dependency direction").

11. **✅ (done — the one behaviour change) Per-action command surface.** The
    target model (§"The command surface — one vocabulary, many callers") wants the
    Session to expose domain commands (`assign`/`addSlot`/`removeSlot`/`swap`/
    `clearGenerated`/`bulkClear`/`generate`), each carrying an Evaluation **verdict**,
    so a UI click and an inbound bot command are true peers through one gate. Before
    this step the domain mutations lived in `App.jsx` handlers that compute `nextEvents`
    and funnel through the generic `stageEvents`; nothing carried a verdict at the
    command layer. This step moves the pure mutation into `session/commands.js` and
    surfaces a verdict. **Decisions (locked with the user):**
    - **Per-action commands** (not a generic `stageEvents` escape hatch) — one command
      per user action, so the gate attaches to a named action.
    - **Warn-still-apply gate** for the actions that had *no* gate before (assign / addSlot
      / removeSlot / clearGenerated / bulkClear): the command still applies, but returns a
      **warning** verdict (reusing `validateEventAssignments` — the one authority — over the
      affected events) that the UI surfaces as a notice. This **preserves the intentional
      manual-override freedom** (a coordinator may knowingly place an unavailable member)
      while making the rule verdict visible. It is a real behaviour change: those edits now
      produce a warning where before they were silent.
    - **`swap` keeps its existing HARD reject** (`explainSwap`): a swap that violates
      feasibility is still blocked with a reason, exactly as before — not downgraded to a
      warning, since that behaviour predates this step and users rely on it.
    - Commands are **pure** (`(state, args) → { nextEvents, verdict, logEntry }`); `useSession`
      derives `state` from `toState({ ...provider.data, events: effectiveEvents })` +
      `provider.externalAssignments`, wires the result to `applyDraftEdit`, and returns the
      verdict/logEntry so App.jsx surfaces warnings + logs. Confirmation-dialog staging and
      toast wording stay in the UI (view concerns), not in the command.
    See [session.md](session.md) for the command contract.

> Historical note: this step was originally deferred as a post-overhaul follow-on
> ("pure structure/renaming; every step behaviour-preserving"). It was later pulled
> into the overhaul by explicit user decision — hence it is the single documented
> behaviour-changing step (see *Explicitly OUT of scope*).

Steps 1–2 alone deliver most of the clarity; 3–10 are follow-ons. Step 9 is not a
standalone commit — renaming rides along with each file's move so the tree never
goes red.

## Migration progress log (living)

> This section is the **running record** of the overhaul. Update it in the same
> change as each step: mark the step above (✅/▶/⬜), add a row here with the
> commit, the green baseline it left behind, and any *residual debt* the step
> knowingly deferred. The debt column is the important one — it is how a later
> step knows what it must clean up.

| Step | Status | Commit | Tests after | Residual debt carried forward |
| --- | --- | --- | --- | --- |
| 1 — extract `rules/` | ✅ done | `b8191d9` | 392 pass | ~~`rules/` imports understudy vocabulary from `../utils/understudy`~~ **cleared by step 5** (vocabulary → `schema/understudyRoles.js`). Enforced by **step 10**. |
| 2 — unify registries | ✅ done | `b8151d4` | 400 pass (+8 conformance) | none new. `defineRule`/`defineScorer` are identity validators by design (no machinery). |
| 3 — extract `state/` | ✅ done | `be74f5f` | 400 pass | ~~adapter + `documentValidation` import understudy vocabulary from `../utils/understudy`~~ **cleared by step 5** (now import `schema/understudyRoles.js`). The AGENTS-mandated `rosterSchema.js` test-data constants are honoured. |
| 4 — split evaluation/generation | ✅ done | `b9c012a` | 400 pass | ~~`evaluation/` imports understudy from `../utils/understudy`~~ **cleared by step 5** (now `schema/understudyRoles.js` + `rules/understudyPolicy.js`). `scoreRoster` (the whole-roster objective, renamed from `evaluateState` in the step-11 follow-on tidy) still lives inside `generation/index.js`. **Step 8a decision:** it stayed put during the `rosterGenerator/`→`generation/` rename — it is a *private* local-search objective (not an exported judge), tightly coupled to the generator's scoring internals, so hoisting it into `evaluation/` would mean exporting + untangling it, i.e. scope creep beyond a folder move. Deferred: fold it into `evaluation/` only if/when it needs to be reused outside the generator. The name `scoreRoster` reads as the objective function it is (an evaluation-vocabulary transform, not a stateful actor). |
| 5 — split `understudy.js` by kind | ✅ done | `d59f896` | 400 pass (24 files) | **debt-clearing step.** `understudy.js` split: vocabulary → `schema/understudyRoles.js`, policy → `rules/understudyPolicy.js` (policy imports vocab — correct Rules→Schema direction). Old `utils/understudy.js`+test deleted; test split to match. No `utils/understudy` importers remain, so steps 1/3/4's coupling is gone. `UNDERSTUDY_SUFFIX` stays vocabulary-internal (no external importer). Seeding/promotion **phases** already live in `generation/` and were untouched. |
| 6 — extract `session/` | ✅ done | `5626b91`; lift `159a55f` | 404 pass (25 files) | ~~**Deferred debt:** draft/undo/commit still called *inside* both providers, so Session not yet above Provider.~~ **RESOLVED by the Session lift** (`159a55f`): added `session/useSession.js` which wraps a provider and owns the draft/commit + undo/redo overlay + the edit commands (`stageEvents`/`stageDocument`, renamed from `updateEvents`/`replaceData` in the step-9 command rename); providers are now pure CRUD (`saveEvents`/`replaceDocument`), and `useRosterData` composes `useSession(provider)`. Session sits *above* Provider as the model prescribes. Internal `commands`/`store` split still deferred (see Resolved). |
| 7 — provider CRUD contract | ✅ done | `073861e`; split `159a55f` | 404 pass (25 files) | ~~**Deferred debt (from step 6):** the `draft/session` key group still lives on the provider surface.~~ **RESOLVED by the Session lift** (`159a55f`): the contract is now split into `PROVIDER_KEYS` (pure CRUD) + `SESSION_KEYS` (draft/history + edit commands), `ROSTER_PROVIDER_KEYS = [...PROVIDER_KEYS, ...SESSION_KEYS]`. Conformance test asserts each provider returns exactly `PROVIDER_KEYS` and `useSession(provider)` returns exactly `ROSTER_PROVIDER_KEYS`. The adapter-rename half landed with step 9. |
| 6/7 — Session lift (inversion) | ✅ done | `159a55f` | 404 pass (25 files, +1 composition) | The structural inversion both prior steps deferred. Providers → pure CRUD; `useSession` composes the draft/command surface above them. **Judgment call:** the draft-reset that used to happen synchronously inside `applyDoc`/`importData`/`selectRoster` is now a single `useEffect` in `useSession` keyed on the provider's `originalData` reference (the one signal common to all load/import/clear/select paths *and* the only one available for the provider-internal background `loadRosters`). Trade-off: a one-tick lag between a new document loading and the draft resetting, vs. the old synchronous reset — acceptable because a fresh load rarely coexists with a live draft, and it unifies all reset paths through one mechanism. A future `specs/session.md` should own the Session command-surface + draft/commit contract in full (currently split across [data-layer.md](data-layer.md) + [architecture.md](architecture.md)). |
| 8 — tidy periphery | ✅ done | 8a `127ec27`; 8b `a779dc6`; 8c-i `cf44783`; 8c-ii `a7efdb7`; 8d `872817f` | 403 pass (25 files) | **Sub-committed** (too big for one commit). **8a:** `rosterGenerator/` → `src/generation/`. **8b:** read-model views → `src/readmodel/`. **8c-i:** the *genuinely generic* helpers `calendarUtils` + `dataExport` (leaf, no relative imports) → `src/lib/`; 4 importers rewired. **8c-ii:** `statsTheme.js` is the **misnamed design-system** token module → renamed to `designSystem.js` and rehomed with `colorUtils` (role-colour palette = colour policy) + the lint guard + both tests into a new `src/design/` folder; ~20 importers rewired (14 `statsTheme`, 6 `colorUtils`), lint-guard internal path/allowlist refs fixed, [design-system.md](design-system.md) + [architecture.md](architecture.md) + this plan updated. **8d:** `telegram.js` (root) → `src/integrations/` (git mv; no relative imports, one importer `main.jsx` rewired) — it's a **read-only** integration today (viewport/theme mirroring), so there was no write path to split; the future bot write path (actor on the session command surface) stays foreshadowed in [architecture.md](architecture.md). **8c decision:** `bulkClear` **stays** in `utils/` — it's *domain* (roster/slot shape, produces one draft edit + undo step), a session-command helper bound for `session/` when the command surface lands, not a `lib/` generic. |
| 9 — vocabulary rename | ⬜ rides along (in progress) | 9-adapter `d437eae` | 403 pass (25 files) | not a standalone commit. **Pulled forward:** the `state/` adapter + `documentValidation` now name their inbound param `document` (not `data`), so the Document→State boundary reads in the code. **Adapter transform rename (this commit):** `getDerivedState` → `toState`, `resolveDerivedState` → `resolveState` (the naming table prescribes the verb-free `toState`-family; `resolveState` names the aggregator that adds the cross-team `externalAssignments`). `resolveTenant` keeps its name (it's the tenant-flatten half, already a transform verb). Rewired App.jsx (2 call sites) + the full `derivedState.test.js` suite (~50) + comment refs in `tenantResolver.js`/`rosterDefaults.js`/`availabilityUtils.test.js`; updated [data-layer.md](data-layer.md) + [multi-tenant.md](multi-tenant.md). *Lesson (earlier):* a blind `data`→`document` also rewrote a user-facing error string (`'YAML data is empty or invalid'`); reverted — renames must not change display text. |
| 9 — session command rename | ⬜ rides along (in progress) | 9-commands `ac31edf` | 404 pass (25 files) | Session edit commands renamed to command vocabulary: `updateEvents` → `stageEvents`, `replaceData` → `stageDocument` ([useSession.js](../src/session/useSession.js), `SESSION_KEYS` + typedef in [providerContract.js](../src/data/providerContract.js), 7 call sites + 2 comments in App.jsx, [architecture.md](architecture.md) / [data-layer.md](data-layer.md) / [events-ui.md](events-ui.md)). Chose `stageEvents` over `applyDraftEdit` so the *surface command* doesn't collide with the internal `useDraftHistory` transition of that name. **Deliberately NOT renamed:** provider `saveEvents`/`replaceDocument` (they save different scopes — a single `saveDocument` would be *less* accurate, and they already read as CRUD). **Deferred as behaviour change:** splitting `stageEvents` into evaluation-gated per-action commands (`assign`/`swap`/…) — that is the post-overhaul follow-on, not a rename (see the follow-on note above §step 10). |
| 10 — enforce the graph | ✅ done | `5d92b65` | 417 pass (27 files) | the CI gate that makes all above debt un-reintroducible. Dependency-free Vitest guard ([`__guards__/dependencyDirection.lint.test.js`](../src/__guards__/dependencyDirection.lint.test.js)): default-deny allow-list of cross-layer arrows, keyed by source layer; fails on any arrow not whitelisted. Verified it *catches* a `rules/`→`evaluation/` regression (temporary probe, reverted). Matrix + rationale recorded in [architecture.md](architecture.md) ("Dependency direction"). **Reconciled two under-specified arrows during authoring** (real, pre-existing, healthy): `state/assignmentTracker` → `rules` (reuses `getWeekKey`) and `readmodel/distributionUtils` → `design` (chart views use tokens) — added to the allow-list with notes. Chose the guard-test pattern over `dependency-cruiser` (no new tooling; matches the design-system lint precedent). **Residual debt:** none. The overhaul is complete. |
| 11 — per-action command surface | ✅ done | `e54e6db` | 415 pass (26 files, +11 commands.test) | **The one behaviour change.** Pulled in by explicit user decision. Pure per-action commands ([`session/commands.js`](../src/session/commands.js)): `assign`/`addSlot`/`removeSlot`/`swap`/`clearGenerated`/`bulkClear`, each `(state, args) → { ok, reason, nextEvents, verdict:{warnings}, logEntry, ... }`. Wired in [`useSession.js`](../src/session/useSession.js) via `runCommand(fn)` (permission-gate → apply to draft → return verdict), with a `{ preview }` mode that computes-without-applying for the confirmation-staged actions (swap/removeSlot/clearGenerated/bulkClear) — replacing an earlier apply-then-undo hack. App.jsx handlers now call the commands and surface `verdict.warnings` via a new amber toast; the confirmation-dialog staging + log prose stay in the UI. Contract: 6 new keys added to `SESSION_KEYS` + typedef ([providerContract.js](../src/data/providerContract.js)); conformance test asserts them. **Gate policy** (see [session.md](session.md)): warn-still-apply for the previously-ungated actions (preserves intentional manual override; makes the verdict visible via the shared `validateEventAssignments`); `swap` keeps its pre-existing hard reject (`explainSwap`). New spec [session.md](session.md) owns the command surface + gate policy; [specs/README.md](README.md) map + planned-spec list updated. **Residual debt:** ~~`state/` vocabulary tidy (`writeBackEvents` actor verb, missing `toDocument` export, private-judge naming)~~ **cleared by the 11-follow-on tidy** (`9ae2d6b`, next row). Step 10's CI graph gate landed after this (see the step-10 row). |
| 11-follow-on — state/ + generator tidy | ✅ done | `9ae2d6b` | 415 pass (26 files) | The step-11 residual debt, closed. (a) reverse events transform `writeBackEvents` → `withRosterEvents` ([tenantResolver.js](../src/state/tenantResolver.js) + provider call site + tests): a pure `(document, selection, events) → document`, matching the forward `toState`, not an I/O actor verb. (b) private generator objective `evaluateState` → `scoreRoster` ([generation/index.js](../src/generation/index.js) + README + specs + CONTRIBUTING); reads as the objective function it is, location stays inside `generation/`. (c) **decision recorded:** there is no full `toDocument(State) → document` — deliberately; nothing reconstructs a whole document from State (the raw document is the source of truth, only *events* round-trip), so building it would be a consumer-less function = over-engineering. Captured in the adapter naming table, write-back note, and naming-mandate example. **Residual debt:** none new. Step 10's CI graph gate landed next (see the step-10 row). |
| bulkClear follow-on — home the last `utils/` domain helper | ✅ done | `f72d571` | 417 pass (27 files) | The `bulkClear` "→ `session/` later" note (module map row) closed. Split rather than moved wholesale: `buildBulkClear` (domain) → [`session/bulkClear.js`](../src/session/bulkClear.js); the shared `slotKey` (`date#roleIndex`) primitive → [`lib/slotKey.js`](../src/lib/slotKey.js), because the guard forbids `components → session` and `EventsView` needs `slotKey` — so it is a domain-free leaf, not session-domain. Deduped `rosterDiff`'s local `slotKey` copy into the same primitive. Guard allow-list gained two justified arrows: `session → lib` and `utils → lib` (both consume `slotKey`). **Residual debt:** none. |
| audit A1 — dissolve `utils/` | ✅ done | `5250881` | 417 pass (27 files) | The last file in `utils/` rehomed, folder deleted. `rosterDiff.js` + `rosterDiff.test.js` → `readmodel/` (a pure read-only diff *view* of State); `crossTeam.test.js` → `evaluation/` (it asserts evaluation behaviour — resolves the long-standing "cross-cutting test with no single source file" note in the tests-migration plan). Guard: added `'lib'` to `readmodel` (`rosterDiff` uses `slotKey`); removed the `utils` allow-list entry and the now-dead `utils` arrows on `session` + `components` (no `../utils` import remains anywhere). Rewired App.jsx + `crossTeam.test.js`'s own-layer imports. Updated architecture.md (module map + dep table + guard comment) + data-layer.md link. **Residual debt:** none — `utils/` no longer exists, so it can never re-form as a grab-bag. |
| audit A2 — home the availability judge | ✅ done | `518707a` | 417 pass (28 files) | `getAvailableMembersForEvent` moved out of `rules/constraintPrimitives.js` into new [`evaluation/availableMembers.js`](../src/evaluation/availableMembers.js) — it is an evaluation *judge* (composes the role-capability rules + the `availability` descriptor), not a leaf primitive. Its 4 cross-layer imports (`understudyRoles`/`understudyPolicy`/`constraints`/`rosterSchema`) were used ONLY by it, so `constraintPrimitives.js` is now a **true dependency-light leaf** (imports nothing cross-layer); its header docstring says so and points to the new home. Its test suite (11 cases) split out to `evaluation/availableMembers.test.js` (+1 file, test count preserved). **Guard re-check (as the A2 task required):** `EventsView` used to reach this function in `rules/` (allowed); now it's in `evaluation/`, so added `'evaluation'` to the `components` allow-list — a natural extension (components already reach `rules`/`schema`, and the picker UI needs the availability judge). Updated architecture.md (dep table), generation.md + events-ui.md (path/test refs). **Residual debt:** none. |
| audit A3 — extract the export engine | ✅ done | `62440eb` | 427 pass (29 files) | `EventsView.jsx`'s untested tabular export engine → new [`readmodel/rosterTable.js`](../src/readmodel/rosterTable.js) (pure `buildExportColumns`/`buildExportHeader`/`buildExportRows`/`toCSV`/`toTSV`; member labelling injected via a `memberLabel` callback so the projection is prop-free), with a 10-case suite (+10 tests, +1 file → the total also gains from the split). Generic `copyText` → [`lib/clipboard.js`](../src/lib/clipboard.js). `EventsView` keeps only the download / clipboard-write / `alert` side effects. **Deviated from the finding's "→ `lib/`":** the engine is a roster-aware read-only *view* (reads understudy-slot vocabulary from `schema`, orders columns) — it belongs in `readmodel/` beside `rosterStats`/`distributionUtils`/`rosterDiff`, not the domain-free `lib/`; only `copyText` (no roster knowledge) went to `lib/`. **Guard:** no change — `components → readmodel`, `readmodel → schema`, `components → lib` are all already allowed. Updated architecture.md (readmodel + lib module rows) + events-ui.md (export section ref). **Residual debt:** none new; the N8 rename of `dataExport.js`/`distributionUtils.jsx` and the C8 in-view parsing items remain open in their own backlog rows. |
| audit N1 — kill the lying `hasGenerated` flag | ✅ done | `d940ec6` | 427 pass (29 files) | The provider `hasGenerated` state field (noun lied — set on every `saveEvents`, so "something committed" not "generated") was read by **nobody**: the only `hasGenerated` outside `data/` is `EventsView`'s *local* recompute from `s.isGenerated`, a different value. Rather than rename dead surface to `hasCommitted`, **deleted** it (AGENTS no-dead-code bias): removed the `useState` + all 4 set-sites + the return field from both `useLocalRosterProvider` and `useSupabaseRosterProvider`, the `RosterProvider` typedef `@property`, `PROVIDER_KEYS`, and architecture.md's provider State list. The provider-conformance test (asserts the exact `PROVIDER_KEYS`) stayed green, proving both backends still match the shrunk contract. **Residual debt:** none — the misleading flag is gone from the contract entirely. |
| audit N2 — drop the mislabeled `PREFERRED_ROLES` key | ✅ done | `758a601` | 427 pass (29 files) | `MEMBER_PREF_FIELDS.PREFERRED_ROLES` (key said `PREFERRED_ROLES`, value was `'roles'`) was referenced nowhere, so — like N1 — **dropped** it from the `MEMBER_PREF_FIELDS` catalog in [`schema/rosterSchema.js`](../src/schema/rosterSchema.js) rather than renaming to `ROLES` (renaming an unused key just keeps dead surface). Also removed the stale `MEMBER_PREF_FIELDS` import from [`evaluation/assignmentValidator.js`](../src/evaluation/assignmentValidator.js) (imported, never used). Bounded scope: `MEMBER_NAME`/`MAX_ASSIGNMENTS` are likewise unused but left alone (only `PREFERRED_DAY` is read, in App.jsx) — noted for a future sweep, not force-fit here. **Residual debt:** two still-unused `MEMBER_PREF_FIELDS` keys, out of N2's scope. |
| audit N3 — disambiguate the two "promoted" predicates | ✅ done | `9f59eee` | 427 pass (29 files) | `EligibilityChecker.canBePromotedTo` → **`isEligibleForPromotion`** in [`evaluation/eligibilityChecker.js`](../src/evaluation/eligibilityChecker.js): it is a look-ahead *eligibility* probe (could this trainee plausibly perform the role, ignoring the understudy gate), which read confusingly next to `isPromotedForRole` (current-state: has completed enough sessions). Renamed only the eligibility method; `isPromotedForRole` (widely used in evaluation/rules, name accurate) is untouched. Updated the single call site ([`generation/understudySeeding.js`](../src/generation/understudySeeding.js)), the `generation/README.md`, and `understudy.md`. No test referenced the method by name, so no test change. **Residual debt:** none. |
| audit N4 — end the "State" noun collision | ✅ done | `babd214` | 427 pass (29 files) | `state/rosterState.js` → **`state/workingRoster.js`** and the exported class `RosterState` → **`WorkingRoster`** (both moved via `git mv`; the class rename touches ~15 sites). The finding proposed a file rename only, but the class carries the *same* colliding "State" noun — a `workingRoster.js` still exporting `RosterState` would be a fresh defect — so file and symbol were renamed together, fully resolving the clash with the adapter's `toState`/State vocabulary (a *different* "State": the document→engine-input transform). The header docstring now records *why* it is `WorkingRoster` (the engine's mutable working memory), not `RosterState`. Sole consumer [`generation/index.js`](../src/generation/index.js) rewired (`new WorkingRoster` + 3 comments); comment refs in [`localSearch.js`](../src/generation/localSearch.js) / [`eligibilityChecker.js`](../src/evaluation/eligibilityChecker.js) / [`promotionPlanning.js`](../src/generation/promotionPlanning.js), `generation/README.md`, and [`specs/generation.md`](generation.md) updated. Guard/tests unchanged (rename only). **Residual debt:** none. |
| audit N5 — split the swap "preview" homonym | ✅ done | `65b38da` | 427 pass (29 files) | The `swap` command returned a result field named `preview` (the before/after payload the confirmation dialog renders as a card) while `runCommand`'s **input** call-mode flag on the *same* command is `{ preview }` — one word carrying two meanings (compute-without-applying vs. the rendered card). Renamed the **result field** `preview` → **`previewCard`** in [`session/commands.js`](../src/session/commands.js), the object spread in [App.jsx](../src/App.jsx) (`...result.previewCard`) + its comment, and [`commands.test.js`](../src/session/commands.test.js). The `{ preview }` input flag keeps its name (it names the call mode, and every destructive command shares it). Updated [session.md](session.md) (result-shape example + preview-mode section, with a note recording *why* the two are distinct). Rename only; guard/tests unchanged. **Residual debt:** none. |
| audit N6 — split the `SharedComponents` grab-bag | ✅ done | `e65fe18` | 427 pass (29 files) | `components/SharedComponents.jsx` (7 importers) bundled three unrelated concerns behind a name that "says nothing". **Split by concern** (user decision — the finding offered rename *or* split): presentational glass primitives (`ModalHeader`/`ModalCloseButton`/`StatTile`/`GlassFab`/`IssueSummary`/`ErrorDisplay`) → [`components/glassPrimitives.jsx`](../src/components/glassPrimitives.jsx); the portaled hover/tap overlay → [`components/HoverCard.jsx`](../src/components/HoverCard.jsx); the DOM-generic outside-click hook `useClickOutside` → [`lib/useClickOutside.js`](../src/lib/useClickOutside.js) — it has no roster/design knowledge, so it is a domain-free leaf, **and** it is the shared home the still-open **B5** (dedup the ×4 inline `useClickOutside` copies) will point those copies at. Rewired all 7 importers (App.jsx, EventsView, MembersView, YamlDrawer, AdminModal, RosterSlotPill, DesignSystem) + the two doc-comments (`MemberCard.jsx`, `DesignSystem.jsx`); updated the owning spec [design-system.md](design-system.md) (primitives home, MemberCard rationale, IssueSummary + HoverCard refs). **Guard:** unchanged — `components → lib`/`design` are already allowed, so the guard *passing* validates the new `HoverCard`/`glassPrimitives`/`useClickOutside` arrows. Split only (no behaviour change); tests unchanged. **Residual debt:** none new; B5 (inline `useClickOutside` copies) remains open in its own row. |
| audit N7 (+ B2) — split `availabilityUtils` + extract the shared slate ramp | ✅ done | `1da781a` | 433 pass (30 files, +6 slateRamp) | `readmodel/availabilityUtils.js` held two concerns: bench-depth **data** (`computeAvailabilityByRole`) and a heatmap **colour ramp** (`availabilityCellColor` + a slate-215 ramp duplicated across two sibling charts — the deferred **B2**). Data half `git mv`'d to [`readmodel/benchDepth.js`](../src/readmodel/benchDepth.js) (test split alongside); colour half moved beside its sole consumer `AvailabilityHeatmap` in [`distributionUtils.jsx`](../src/readmodel/distributionUtils.jsx). Because a faithful ramp extraction had to touch all three duplicating sites, **B2 was folded into this commit** (user chose "do full B2 ramp extraction now"): new leaf token [`design/slateRamp.js`](../src/design/slateRamp.js) owns the *only* shared thing — `SLATE_HUE = 215` + the light→deep hsla interpolation (`slateRampColor`, clamped, alpha-lerped) — while each chart keeps its **own** light/deep endpoints (deliberately different per visual: heatmap cells, distribution bars, spacing dots). Rewired `availabilityCellColor`, distributionUtils' `mixStatSlate`/`tintTowardsLight`/legend swatch, and QualityMetrics' spacing dots onto the token; rewired the `computeAvailabilityByRole` importer ([App.jsx](../src/App.jsx)) + specs ([events-ui.md](events-ui.md) owns the heatmap-colour rationale, [generation.md](generation.md), [architecture.md](architecture.md)). **Guard:** unchanged — `readmodel → design` and `components → design` are already allowed; the guard passing validates the new token arrows. Split + dedupe (no behaviour change — the per-chart output colours are byte-identical). **Residual debt:** none; B2 is now ✅ in the structural table. |
| audit N8 — name the two vague modules for what they produce | ✅ done | `2ef1b77` | 433 pass (30 files) | Two over-broad "Utils"/product-vague module names, both **renamed** (user chose "rename both", not split): `lib/dataExport.js` → **[`lib/yamlExport.js`](../src/lib/yamlExport.js)** (it does exactly one thing — serialize roster data to a YAML string + download it; "data" named nothing about the format), sole importer [`EventsView.jsx`](../src/components/EventsView.jsx) rewired; and `readmodel/distributionUtils.jsx` → **[`readmodel/rosterStatsCharts.jsx`](../src/readmodel/rosterStatsCharts.jsx)** (+ its test). The latter is not *just* distribution — it produces the roster-stats **charts** and their helpers (bell-curve distribution, concern gradients, `availabilityCellColor`, and the `BellCurveChart` / `AvailabilityHeatmap` components), so the new name names the product, not one shape. A true *split* of that mixed module was deliberately **not** done here (it stays a possible future structural item) — the user scoped N8 as a pure rename. Rewired importers ([QualityMetrics.jsx](../src/components/QualityMetrics.jsx), [RosterStatsPanel.jsx](../src/components/RosterStatsPanel.jsx)) + the two `benchDepth.js` cross-ref comments; updated specs ([architecture.md](architecture.md) module table, [events-ui.md](events-ui.md) heatmap ref). Historical plan refs to the old names (migration steps 8b/8c) left as record. **Guard:** unchanged (rename only — same layers). Rename only; no behaviour change. **Residual debt:** none. |
| audit N9 — one convention for the two member-accessor names | ✅ done | `12e83f1` | 433 pass (30 files) | `getMemberDisplay` and `getMemberName` read like synonyms but mean different things: name-only short label vs. **full** presentational label ("Name - telegram" / "Unassigned"). The full label is what the rest of the app already calls a `memberLabel` (the [`rosterTable.js`](../src/readmodel/rosterTable.js) export-projection param and the [`RosterSlotPill`](../src/components/RosterSlotPill.jsx) prop), so `getMemberDisplay` → **`getMemberLabel`** in its sole home [`EventsView.jsx`](../src/components/EventsView.jsx) (def + 2 uses), aligning the accessor to that canonical term and making the pair read as `Label` (full) vs `Name` (short), not two words for the same thing. `getMemberName` kept as-is. **Guard/tests:** unchanged (local rename). Rename only; no behaviour change. **Residual debt:** the name-only `getMemberName` is inline-duplicated 3× (App.jsx, EventsView.jsx, rosterStatsCharts.jsx) with near-identical `name || id` logic — a *dedup*, not a naming fix, so logged as new structural item **B10** below rather than force-fit into N9. |
| C6 — use the shared slot-key primitive in `bulkClear` | ✅ done | `5f1d467` | 436 pass (31 files, +3 slotKey) | `bulkClear` (session/commands.js) hand-parsed the slot key with `String(k).split('#')[0]` despite the shared [`lib/slotKey.js`](../src/lib/slotKey.js). Added the inverse [`dateOfSlotKey`](../src/lib/slotKey.js) beside `slotKey` (with a doc-comment on why it lives there) + a new `slotKey.test.js` locking the format/round-trip, and rewired `bulkClear` to `[...selectedSlots].map(dateOfSlotKey)`. The `#`-delimited format now has exactly one reader/writer. **Guard:** unchanged (`session → lib` already allowed). No behaviour change. |
| B10 — dedup the name-only member accessor | ✅ done | `1607236` | 440 pass (32 files, +4 memberLookup) | `getMemberName` was re-implemented inline 3× (App.jsx, EventsView.jsx, rosterStatsCharts.jsx) with near-identical `name || id` logic (surfaced by N9). Extracted one shared [`memberNameById(members, id)`](../src/readmodel/memberLookup.js) in `readmodel` (a member-list projection, importable by both components and readmodel) with the fallback contract documented once — `name || id`, and `null`/absent id → `null` (an empty slot has no name) — + a `memberLookup.test.js`. Rewired the 3 call sites. **Not touched:** the sibling `nameOf`/`nameOfIn` (session, `'—'` fallback) and swap-policy (`'someone'` fallback) variants — they have *deliberately different* contracts, so folding them in would change behaviour; left as-is. **Guard:** unchanged (`components → readmodel` and same-layer `readmodel → readmodel` already allowed). No behaviour change (the three call sites' inputs already converged on the same result). |
| B5 — dedup the single-ref outside-click hook | ✅ done | `f194e23` | 440 pass (32 files) | Three single-ref inline `mousedown`/`contains` outside-click effects (EventsView's add-role picker + card menu, RosterSlotPill's picker) re-implemented the shared [`lib/useClickOutside`](../src/lib/useClickOutside.js) by hand. Replaced them with `useClickOutside(ref, onOutside, active)` (the `active` flag carries each site's open-state guard). **HoverCard deliberately left as-is:** it excludes *two* refs (trigger + portaled panel) — a genuinely different contract that the single-ref hook can't express without a signature change; folding it in would be scope creep, so it keeps its own effect (noted in the hook's doc-comment). **Guard:** unchanged (`components → lib` already allowed). No behaviour change. |
| B1 — move date formatting out of `design` into `lib` | ✅ done | `6a43249` | 440 pass (32 files) | `formatDate`/`formatDateRange` lived in [`design/colorUtils.js`](../src/design/colorUtils.js) — but formatting a date is a **calendar** concern, not colour policy. Moved both (+ their two `describe` blocks, from `colorUtils.test.js` into `calendarUtils.test.js`) to [`lib/calendarUtils.js`](../src/lib/calendarUtils.js), rewired the 4 importers (App.jsx, EventsView.jsx, ChangeReviewPanel.jsx, rosterStatsCharts.jsx), and updated [architecture.md](architecture.md) (moved the "date formatting" note from the `design` row to the `lib` row). **Behaviour preserved verbatim:** the functions still `new Date(str)`-parse (UTC) rather than the local `parseDayKey` calendarUtils uses for day keys — a doc-comment flags the difference and why it's fine (these only feed short human labels). **Guard:** unchanged (`components → lib` and `readmodel → lib` already allowed). Move only; no behaviour change. |
| C2 — drop the `_currentRoster` instance-state round-trip | ✅ done | `090a211` | 440 pass (32 files) | `EligibilityChecker.isEligible` stashed the per-call `currentRoster` on the shared instance (`this._currentRoster = currentRoster`) so the ctx method `currentRoster()` could read it back for the registry descriptors — a set-then-read round-trip on shared mutable state (invisible coupling; two concurrent `isEligible` calls on one checker would clobber each other's roster). Replaced with a per-call ctx: `_ctxFor(currentRoster)` returns `Object.create(this)` (prototype-linked, so the whole counting interface — `weeklyCount`/`monthlyCount`/`overlappingEvents`/… — is inherited unchanged) with a local `currentRoster: () => roster` closure. The loop now passes `ctx` to `constraint.enabled(ctx)`/`constraint.check(..., ctx, ...)` instead of `this`; the `this._currentRoster` field is gone. The `ctx.currentRoster(placement)` contract the descriptors depend on is preserved exactly. **Guard/tests:** unchanged (internal refactor). No behaviour change. |
| B9 — dedup the byte-identical provider `logAction` | ✅ done | `d526e79` | 440 pass (32 files) | Both providers had a byte-identical `logAction`. Extracted the factory [`appendActionLog(setActionLog)`](../src/data/providerContract.js) beside `LOCAL_PERMISSIONS` (the action log is a purely-local, never-persisted UI concern, so the append is identical in every mode) and rewired both providers (`useLocalRosterProvider`, `useSupabaseRosterProvider`) to `const logAction = appendActionLog(setActionLog)`. **`replaceDocument` deliberately NOT unified** (user decision): the audit's "Supabase drops warnings" was **stale** — both re-attach `warnings` today (Supabase via the `withWarnings`→`doc` spread, local via the inline `hasWarnings` spread); the only real differences are Supabase's `canEditRoster` gate + `withWarnings` helper (genuine per-provider concerns), so it stays specialised. Corrected the stale note in the B9 backlog row. **Guard:** unchanged (`data → data` same-layer). No behaviour change. |
| B4 — extract the whole-roster objective out of `generation/index.js` | ✅ done | `5d0267a` | 445 pass (33 files, +5 scoreRoster) | `generation/index.js` bundled the whole-roster quality **objective** (`scoreRoster` + its private `countConsecutiveWeekendViolations`) with orchestration + the final report. The objective had earned a second reader (Phase-2 local search *and* the final `calculateRosterQuality` report), the exact trigger the step-4/11 follow-on note named, so extracted it verbatim to [`generation/scoreRoster.js`](../src/generation/scoreRoster.js) + a focused [`scoreRoster.test.js`](../src/generation/scoreRoster.test.js) locking the objective contract (1000/empty-slot, day/role pref weights, consecutive-weekend gating). `index.js` now imports it and dropped the now-unused `SCORING_WEIGHTS`/`areConsecutiveWeekends`/`PREFERENCE_KEYS`/`isPreferenceEnabled` imports; updated `generation/README.md` (file-tree + a `scoreRoster` section distinguishing the whole-roster objective from the per-candidate `ScoringEngine`). **Guard:** unchanged (all deps already within `generation`/`rules`/`schema`). No behaviour change (verbatim move — same objective, same weights). |
| B8 — cross-reference the two document-validation halves | ✅ done | `1ea4f92` | 445 pass (33 files) | Document validation is split across `state/documentValidation.js` (`runAllValidators` — the flat shape: members/roles/events/dates/constraints) and `state/tenantResolver.js` (`validateTenantRosters` — the nested-tenant invariant: a team's rosters must not overlap in time), with no pointer between them, so a reader saw only whichever half they landed in. Added a reciprocal cross-reference doc-comment on each (naming the other half + noting the provider load path runs BOTH and merges their warnings). Deliberately **not consolidated**: they validate genuinely different shapes and already share the merge site (the provider), so merging the functions would conflate two concerns — a cross-ref is the right fix. Comment-only; no behaviour/test change. |
| C8 — the residual readability smells | ✅ done | `81b2896` | 445 pass (33 files) | Cleared the C8 bundle. **Conditional hooks:** replaced the `useRosterData` dispatcher (conditional `useLocalRosterProvider()`/`useSupabaseRosterProvider()` calls) with an App-level **component split** — `LocalApp`/`ProductionApp` wrappers each call exactly one provider hook + `useSession` unconditionally, so no hook is conditional and the unused provider never mounts (no spurious Supabase RPCs). Deleted the now-dead `hooks/useRosterData.js`; tightened the guard's `hooks` allowance `['data','session']`→`['data']` (only `useAuth` remains, reads `data/`); updated `architecture.md` + `CONTRIBUTING.md` + `providerContract.js` prose. **Prose parse:** `getAlgorithmDescription` now returns structured `{ intro, sections }`; the modal consumes it directly (parse loop removed) and the hover card flattens via `algorithmDescriptionText` — the structure is the single source of truth. **Fake generationResult:** `calculateDistribution`/`QualityMetrics` take `fairnessMetrics`+`assignedRoles` directly (off the live `stats`); `RosterStatsPanel` no longer fabricates a `generationResult` envelope. **~~Deferred~~ (now done, `1db45e2`):** the duplicated modal *chrome* — extracted a `ModalShell` primitive (backdrop + centered `glassModal` panel + `ModalHeader` + scroll body + optional footer) into `glassPrimitives.jsx` and routed `AdminModal` + `AlgorithmDescriptionModal` through it (the latter had hand-rolled its own backdrop/header/footer; per user's "unify look" choice its header now uses the shared close button + moves the intro into the body). `YamlDrawer` stays a drawer (shares only `ModalHeader`, not the shell). Added a `ModalShell` entry to the `DesignSystem.jsx` living page + `design-system.md`. **Guard:** green (App is a root file; `hooks` allowance tightened). No behaviour change. User chose the component-split over documenting the conditional hook. |
| C8-follow-on — extract the shared `ModalShell` chrome | ✅ done | `1db45e2` | 445 pass (33 files) | The C8 "deferred" item. `AlgorithmDescriptionModal` hand-rolled its own backdrop + header + footer, drifting from `AdminModal`/`YamlDrawer` (which already share `ModalHeader`). Extracted a `ModalShell` primitive ([`glassPrimitives.jsx`](../src/components/glassPrimitives.jsx)) — fixed backdrop (click-to-close) + centered `glassModal` panel + `ModalHeader` + scrollable body + optional `footer`, with a `size` prop for panel width — and routed both `AdminModal` (`size="md"`) and `AlgorithmDescriptionModal` (`size="lg"`, footer via prop) through it. Per the user's **"unify look"** choice, `AlgorithmDescriptionModal` adopts the shared header: the big round `×` becomes the shared `ModalCloseButton` svg and its intro subtitle moves from under the title into the body (a lead paragraph). Minor UX gain: it now also closes on backdrop-click (previously it didn't) — consistent with the other modals. `YamlDrawer` deliberately **stays a drawer** (side-slide + grab handle), sharing only `ModalHeader`, not the shell. Added a `ModalShell` token to the `DesignSystem.jsx` living page and to `design-system.md`. **Guard:** green (`glassPrimitives` → `design` already allowed). No behaviour change beyond the noted backdrop-click. |


**Baseline before the overhaul:** 392 tests, `npm run build` green (commit `5bb41c8`).

## Post-overhaul readability audit (living backlog)

> The layer graph is now correct and enforced. This backlog is the output of a
> **read-only, per-directory audit** (one pass per `src/` layer) checking that
> **file names, symbol names, and code boundaries** still read cleanly for a
> newcomer. These are *not* graph violations (the guard is green) — they are
> naming/placement/readability debts that a fresh reader trips over. Each item is
> a candidate follow-on; land them the same way as the overhaul steps (one green
> commit each, spec updated in the same change). Ranked by reader-impact.
> **Nothing here is authorized to implement yet** — this is the task list.
>
> **Verified-clean during the audit (do NOT "fix" — the names are load-bearing):**
> `canFillSlotRole` vs `isRoleCapable` (distinct concepts, correctly named);
> the unified `CONSTRAINTS`/`SCORERS` registries (conformance-tested);
> `getWeekKey` single-sourced; no core→session/data imports; the
> `toState`/`resolveState`/`withRosterEvents`/`scoreRoster` transform vocabulary;
> provider-contract keys match reality (`providerContract.test.jsx`).

### High — structural / boundary (a reader lands in the wrong layer)

| # | Finding | Fix | Owning spec |
| --- | --- | --- | --- |
| A1 | ✅ **done** (`utils/` dissolved). ~~Only `rosterDiff.js` (+ its `crossTeam.test.js`) remained.~~ `rosterDiff.js` (+ `rosterDiff.test.js`) → `readmodel/` (pure read-only diff *view* of State); `crossTeam.test.js` → `evaluation/` (asserts evaluation behaviour). `utils/` deleted. | Landed: `git mv` the three files; added `'lib'` to `readmodel`'s allow-list (`rosterDiff` consumes `slotKey`); removed the `utils` allow-list entry **and** the now-dead `utils` arrows from `session` + `components`; rewired App.jsx import + `crossTeam.test.js`'s own-layer imports; updated architecture.md (module map + dep table + guard) and data-layer.md link. | [architecture.md](architecture.md) module map + guard |
| A2 | ✅ **done** (`getAvailableMembersForEvent` rehomed). ~~It's a UI/evaluation judge misfiled in the "leaf primitives" file, forcing it to import `constraints.js`/`understudyPolicy.js`.~~ Moved to [`evaluation/availableMembers.js`](../src/evaluation/availableMembers.js) (+ its 11-case suite → `availableMembers.test.js`); `constraintPrimitives.js` is now a true dependency-light leaf (imports nothing cross-layer). | Landed: extracted the function + its 4 cross-layer imports into the new file; stripped them from `constraintPrimitives.js` (+ header docstring rewrite); repointed `EventsView` import. **Guard re-check:** added `'evaluation'` to the `components` allow-list (the picker UI reaches the judge; components already reach `rules`/`schema`). Updated architecture.md dep table + generation.md/events-ui.md refs. | [generation.md](generation.md) |
| A3 | ✅ **done** (`EventsView` export engine extracted). ~~~860-line view mixed the view, an *untested* tabular export engine, and a generic `copyText`.~~ Export engine → [`readmodel/rosterTable.js`](../src/readmodel/rosterTable.js) (`buildExportColumns`/`buildExportHeader`/`buildExportRows`/`toCSV`/`toTSV`), with 10 unit tests; `copyText` → [`lib/clipboard.js`](../src/lib/clipboard.js). | Landed: the pure builders moved out (member labelling injected via a `memberLabel` callback so the projection is prop-free); `EventsView` keeps only the browser download / clipboard-write / `alert` glue. **Refinement of the finding:** the engine went to `readmodel/`, not `lib/` — it is a roster-aware read-only *view* (reads the understudy-slot vocabulary from `schema`, orders columns), so it belongs beside `rosterStats`/`distributionUtils`/`rosterDiff`, not in the domain-free `lib/`. Only the truly generic `copyText` went to `lib/`. No guard change (component→readmodel, readmodel→schema, component→lib all already allowed). Updated architecture.md (readmodel + lib module rows) + events-ui.md (export section ref). | [events-ui.md](events-ui.md) |

### Medium/Low — the rename backlog, as a verb–noun table

The renames all reduce to the same defect: **the symbol's verb (its action-kind)
or noun (the thing it names) doesn't match what it actually does or the layer it
lives in.** This is the concrete, per-symbol application of the
[Naming mandate](#naming-mandate-foldersfiles-reflect-layers-symbols-reflect-vocabulary)
and the [per-layer verb table](#each-layer-has-a-vocabulary-fit-to-its-nature)
above. Read each row as: *current* verb+noun → *what it truly is* → *proposed*
verb+noun. Land as symbol-only renames (one green commit each).

| # | Current name | Verb (is) | Noun (is) | The mismatch | → Proposed verb·noun |
| --- | --- | --- | --- | --- | --- |
| N1 | ✅ **done** — **deleted**. ~~`hasGenerated` (provider): noun lies (set on every `saveEvents`, means "something committed") and near-dead.~~ Verified zero readers (the only `hasGenerated` outside `data/` is `EventsView`'s *local* recompute from `s.isGenerated`, unrelated to this field), so per AGENTS' no-dead-code bias it was **deleted** — from both providers (state + set-sites + return), the `providerContract` typedef, `PROVIDER_KEYS`, and the architecture.md State list. The conformance test (asserts exact `PROVIDER_KEYS`) stays green, proving both backends still match. | `hasGenerated` (provider) | `has` (state predicate) | `Generated` | **noun lies**: set on *every* `saveEvents`, so it means "something committed", not "a roster was generated" — and it's near-dead (`EventsView` recomputes locally from `s.isGenerated`, line ~313). | `hasCommitted` — or **delete** (verified no consumer relies on the "generated" meaning). |
| N2 | ✅ **done** — **dropped** (key unused) + stale import removed. ~~`MEMBER_PREF_FIELDS.PREFERRED_ROLES` = `'roles'`: noun ≠ value, plus a stale unused import.~~ The `PREFERRED_ROLES` key was referenced nowhere (no `pref['roles']` access exists), so — like N1 — it was **dropped** from `MEMBER_PREF_FIELDS` rather than renamed to `ROLES`. Also removed the stale `MEMBER_PREF_FIELDS` import from `evaluation/assignmentValidator.js` (imported, never used). *(Noted but out of N2's bounded scope: `MEMBER_NAME`/`MAX_ASSIGNMENTS` keys are also currently unused — only `PREFERRED_DAY` is read, in App.jsx.)* | `MEMBER_PREF_FIELDS.PREFERRED_ROLES` = `'roles'` | (constant key) | `PREFERRED_ROLES` | **noun ≠ value**: the key says `PREFERRED_ROLES` but the field is `'roles'`; also a **stale import** in `evaluation/assignmentValidator.js` (imported, unused). | `ROLES` (match the value) — or drop if unused; remove the stale import. |
| N3 | ✅ **done** — renamed the eligibility probe. `EligibilityChecker.canBePromotedTo` → **`isEligibleForPromotion`** (it's a look-ahead *eligibility* probe: could this trainee plausibly perform the role, ignoring the understudy gate), disambiguating it from `isPromotedForRole` (current-state: has completed enough sessions). Only the eligibility method was renamed; `isPromotedForRole` (widely used, name accurate) stays. Updated the call site (`understudySeeding.js`), the generation/README, and understudy.md. | `canBePromotedTo` / `isPromotedForRole` | `canBe`/`is` (predicates) | both say `Promoted` | **one noun, two meanings** of "promoted" (eligibility vs. current-state). | disambiguate one — e.g. `isEligibleForPromotion` vs. `isPromotedForRole`. |
| N4 | ✅ **done** — renamed **both** file and class. `state/rosterState.js` → **`state/workingRoster.js`** and the exported class `RosterState` → **`WorkingRoster`** (`git mv` for the file + its test). The finding proposed a file rename only, but the *class* carries the same colliding "State" noun (~15 uses), so a `workingRoster.js` that still exported `RosterState` would be a fresh defect — renamed both so file and symbol align and the collision with the adapter's `toState`/State vocabulary is fully resolved. Header docstring records *why* the name is `WorkingRoster` (the engine's mutable working memory) and not `RosterState`. Rewired the sole consumer (`generation/index.js`) + comment refs (`localSearch.js`, `eligibilityChecker.js`, `promotionPlanning.js`), `generation/README.md`, and `specs/generation.md`. | `rosterState.js` | (module) | `State` | **noun collides** with the adapter's `toState`/State vocabulary (a different "State"). | `workingRoster.js`. |
| N5 | ✅ **done** — renamed the result field. The `swap` command returned a `preview` object (the before/after card the confirmation dialog renders) while `runCommand`'s call-mode input flag on the *same* command is `{ preview }` — one word, two meanings (input flag vs. output payload). Renamed the **result field** `preview` → **`previewCard`** ([`session/commands.js`](../src/session/commands.js) + the spread in [App.jsx](../src/App.jsx) + [`commands.test.js`](../src/session/commands.test.js) + [session.md](session.md)); the `{ preview }` input flag keeps its name (it *is* the call mode). | `swap` result field `preview` | (result field) | `preview` | **noun collides** with the call-mode `{ preview }` input flag on the same command. | rename the result field (e.g. `previewEvents`). |
| N6 | ✅ **done** — **split by concern**. `SharedComponents.jsx` (7 importers) mixed three unrelated things under a grab-bag name, so it was split: the presentational glass primitives (`ModalHeader`/`ModalCloseButton`/`StatTile`/`GlassFab`/`IssueSummary`/`ErrorDisplay`) → [`components/glassPrimitives.jsx`](../src/components/glassPrimitives.jsx); the portaled overlay → [`components/HoverCard.jsx`](../src/components/HoverCard.jsx); the DOM-generic outside-click hook → [`lib/useClickOutside.js`](../src/lib/useClickOutside.js) (domain-free leaf — this is also the shared home the still-open **B5** will point the ×4 inline copies at). Rewired all 7 importers + the two doc-comments (`MemberCard.jsx`, `DesignSystem.jsx`) and the owning spec [design-system.md](design-system.md). Guard unchanged (`components → lib`/`design` already allowed; the guard *passing* validates the new arrows). | `SharedComponents.jsx` | (module) | `SharedComponents` | **noun says nothing** — a grab-bag name, not its contents. | name for its actual contents (or split). |
| N7 | ✅ **done** — **split + folded in B2**. `availabilityUtils.js` held two concerns: bench-depth **data** (`computeAvailabilityByRole`) and a heatmap **colour ramp** (`availabilityCellColor` + a slate-215 ramp duplicated in two sibling charts — the deferred **B2**). The data half was `git mv`'d to [`readmodel/benchDepth.js`](../src/readmodel/benchDepth.js) (its test split alongside), and the colour half moved next to its sole consumer `AvailabilityHeatmap` in [`distributionUtils.jsx`](../src/readmodel/distributionUtils.jsx). Because a faithful ramp extraction had to touch all three duplicating sites, **B2 was done in the same commit** (the user chose "do full B2 ramp extraction now"): a new [`design/slateRamp.js`](../src/design/slateRamp.js) owns the one shared thing — `SLATE_HUE = 215` and the light→deep hsla interpolation (`slateRampColor`) — while each chart keeps its **own** light/deep endpoints (deliberately different per visual). Rewired `availabilityCellColor`, distributionUtils' `mixStatSlate`/`tintTowardsLight`/legend swatch, and QualityMetrics' spacing dots onto the token; rewired the `computeAvailabilityByRole` importer (App.jsx) + specs (events-ui.md, generation.md, architecture.md). Guard unchanged (`readmodel`/`components` → `design` already allowed; the guard passing validates the new arrows). | `availabilityUtils.js` | (module) | `…Utils` (+ two concerns) | **noun over-broad** *and* conflates bench-depth **data** with a heatmap **colour ramp**. | data half → `benchDepth.js`; ramp → the shared token (see B2). |
| N8 | ✅ **done** — renamed both (user scoped as pure rename, no split): `dataExport.js` → [`lib/yamlExport.js`](../src/lib/yamlExport.js) (names the format it produces); `distributionUtils.jsx` → [`readmodel/rosterStatsCharts.jsx`](../src/readmodel/rosterStatsCharts.jsx) (produces the roster-stats charts + helpers, not just "distribution"). A split of the mixed charts module was deliberately deferred. See the progress log. | `distributionUtils.jsx`, `dataExport.js` | (modules) | `…Utils` / vague | **noun over-broad** — "Utils" names the shape, not the product. | name for what they produce. |
| N9 | ✅ **done** — picked the convention off the *existing* vocabulary. The two accessors are genuinely different: `getMemberName` is a **name-only** short label (`name || id`), while `getMemberDisplay` is the **full presentational label** ("Name - telegram", or "Unassigned") — which is exactly what the export projection ([`rosterTable.js`](../src/readmodel/rosterTable.js) `memberLabel` param) and [`RosterSlotPill`](../src/components/RosterSlotPill.jsx) (`memberLabel` prop) already call a **label**. So `getMemberDisplay` → **`getMemberLabel`** (EventsView, its sole home — def + 2 uses), aligning the accessor with the canonical `memberLabel` term and making the pair read as a deliberate `Label` (full) vs `Name` (short) distinction rather than two synonyms. `getMemberName` kept. Local rename only; no dedup of the 3 inline `getMemberName` copies (that is a separate structural item, not a naming fix). | `getMemberDisplay` / `getMemberName` | `get` | `Display`/`Name` | **verb+noun inconsistent** across two very similar accessors. | pick one convention. |

> **Not renames — kept in the structural list below** because they need a *move*,
> a *dedupe*, or a *split*, not a new name: B1 (`formatDate` → `lib/`), B2 (shared
> slate ramp), B4 (`generation/index.js` grab-bag → extract objective), B5
> (inline `useClickOutside` ×4), B8 (split validation cross-ref), B9 (provider
> `logAction`/`replaceDocument` duplication + warnings divergence), C2
> (`_currentRoster` instance round-trip), C6 (`bulkClear` hand-parses the slot
> key → `parseSlotKey` in `lib/slotKey.js`), C8 (opportunistic: stale header in
> `documentValidation.js`; conditional provider-hook calls in `useRosterData`
> (Rules-of-Hooks smell, safe); `AlgorithmDescriptionModal` parses prose into
> sections in-view + duplicated modal chrome; `RosterStatsPanel` fabricates a
> fake `generationResult` for `QualityMetrics`).

### Medium — structural (moves / dedupes / splits, not renames)

| # | Finding | Fix |
| --- | --- | --- |
| B1 | ✅ **done**. Moved `formatDate`/`formatDateRange` (+ their tests) from `design/colorUtils.js` to [`lib/calendarUtils.js`](../src/lib/calendarUtils.js) — formatting a date is a calendar concern, not colour policy. Rewired the 4 importers (App, EventsView, ChangeReviewPanel, rosterStatsCharts); updated [architecture.md](architecture.md). Behaviour preserved verbatim (the functions still `new Date(str)`-parse; a doc-comment flags that this differs from calendarUtils' local `parseDayKey`, kept as-is since these only feed short labels). | Move to `lib/calendarUtils.js` (its natural home). |
| B2 | ✅ **done** (folded into **N7**). **Concern→HSL slate ramp (hue 215) duplicated 3×** — `QualityMetrics.jsx`, `readmodel/distributionUtils.jsx`, `readmodel/availabilityUtils.js`. Extracted the one genuinely-shared thing to [`design/slateRamp.js`](../src/design/slateRamp.js) — `SLATE_HUE = 215` + the light→deep hsla interpolation (`slateRampColor`) — and pointed all three sites at it. Endpoints stay **per chart** on purpose (each visual's light/deep {s,l,a} differ deliberately); the duplication was the hue + lerp, not the endpoints. See the N7 row for the full move. | Extract one shared ramp (design token) and reuse. |
| B4 | ✅ **done** (`5d0267a`). Extracted the whole-roster objective `scoreRoster` (+ its private `countConsecutiveWeekendViolations`) from `generation/index.js` into [`generation/scoreRoster.js`](../src/generation/scoreRoster.js) — it had earned a second reader (Phase-2 local search + the final `calculateRosterQuality` report), the trigger the step-4/11 note named. Added a focused [`scoreRoster.test.js`](../src/generation/scoreRoster.test.js) locking the objective contract (empty-slot 1000 penalty, day/role pref weights, consecutive-weekend gating). `index.js` now imports it and dropped the now-unused `SCORING_WEIGHTS`/`areConsecutiveWeekends`/`PREFERENCE_KEYS`/`isPreferenceEnabled` imports; updated `generation/README.md` (file-tree + new `scoreRoster` component section distinguishing it from the per-candidate `ScoringEngine`). | Extract the objective (`scoreRoster`) to its own module *within* `generation/` (per the step-4/11-follow-on note, only when it earns a second reader — this is that trigger). |
| B5 | ✅ **done**. Replaced the 3 single-ref inline outside-click effects (EventsView's add-role picker + card menu, RosterSlotPill's picker) with the shared [`lib/useClickOutside`](../src/lib/useClickOutside.js). HoverCard was deliberately **left** — it excludes *two* refs (trigger + portaled panel), a different contract than the single-ref hook. | Replace the inline copies with the shared hook. |
| B8 | ✅ **done** (`1ea4f92`). The two document-validation halves — flat-shape `documentValidation.runAllValidators` and tenant-shape `tenantResolver.validateTenantRosters` — sit in the same `state/` dir but neither pointed at the other, so a reader chasing "where is X validated" saw only half. Added a reciprocal cross-reference doc-comment on each (naming the other half + noting the provider load path runs BOTH and merges their warnings). **Not consolidated** — they validate genuinely different shapes (flat vs nested tenant) and already share the *merge* site (the provider); merging the functions would conflate two concerns, so a cross-ref is the right fix, not a move. Comment-only; no behaviour/test change. | Add a cross-ref (or consolidate) so a reader finds both halves. |
| B9 | ✅ **done** (`d526e79`). `logAction` was byte-identical across both providers; extracted the factory [`appendActionLog(setActionLog)`](../src/data/providerContract.js) (the append is a purely-local, never-persisted UI concern) and rewired both providers to it. **`replaceDocument` left per-provider** — the audit note's "Supabase drops warnings" was **stale/incorrect**: both re-attach `warnings` (Supabase via `withWarnings`→`doc` spread, local via the inline `hasWarnings` spread). Their only real differences are Supabase's `canEditRoster` permission gate and its `withWarnings` helper — genuine per-provider concerns, not a divergence to reconcile, so `replaceDocument` stays specialised. | Extract the shared helper; the "warnings divergence" turned out not to exist — only `logAction` was truly shared. |
| B10 | ✅ **done**. Extracted [`memberNameById(members, id)`](../src/readmodel/memberLookup.js) (name-only, `name || id`, null-in→null-out) + a test, and rewired the 3 inline copies (App.jsx, EventsView.jsx, rosterStatsCharts.jsx) to it. The `nameOf`/`nameOfIn`/swap-policy variants with *different* fallbacks (`'—'`, `'someone'`) were deliberately left alone — different contracts, not this duplication. | Extract one shared name-only accessor and reuse (decide the null/`id`-fallback contract once). |
| C2 | ✅ done (`090a211`) — **`_currentRoster` instance-state round-trip in `eligibilityChecker.js`** — a set-then-read on `this`. | Pass explicitly instead of stashing on the instance. |
| C6 | ✅ **done**. `bulkClear` hand-parsed the slot key (`String(k).split('#')[0]`) despite the shared `lib/slotKey.js`. Added [`dateOfSlotKey`](../src/lib/slotKey.js) beside `slotKey` (the inverse for the date half) + a `slotKey.test.js`, and used it in [`commands.js`](../src/session/commands.js) `bulkClear`. The `#`-delimited format now lives in one place. | Add `parseSlotKey`/`dateOfSlotKey` to `lib/slotKey.js` and use it. |
| C8 | ✅ **done** (`81b2896`). All four smells addressed: (1) ~~stale header comment in `documentValidation.js`~~ — resolved in B8. (2) **conditional provider-hook calls** — replaced the `useRosterData` dispatcher (which called `useLocalRosterProvider()`/`useSupabaseRosterProvider()` conditionally) with a **component split**: App now renders `LocalApp`/`ProductionApp` wrappers, each unconditionally calling exactly one provider hook + `useSession`, so no hook is ever conditional and the unused provider's mount effects (e.g. Supabase network RPCs) never run. The now-dead `hooks/useRosterData.js` was deleted; the guard's `hooks` allowance tightened to `['data']` (only `useAuth` remains, reading `data/`). (3) **`AlgorithmDescriptionModal` prose parsing** — `getAlgorithmDescription` now returns **structured** `{ intro, sections:[{icon,title,items}] }`; the modal consumes it directly (no more string split/re-parse) and the hover card flattens it via `algorithmDescriptionText`, so the structure is the single source of truth (no serialize→re-parse round-trip). (4) **`RosterStatsPanel` fake `generationResult`** — `calculateDistribution` + `QualityMetrics` now take `fairnessMetrics` + `assignedRoles` directly (read off the live `stats`), so the panel no longer fabricates a `generationResult`-shaped wrapper. **Remaining (deferred, not chased):** the duplicated modal *chrome* (backdrop/header/footer shared across AlgorithmDescriptionModal / AdminModal / YamlDrawer) — a shared-modal-shell extraction touching other modals, out of scope for this readability pass. | Address opportunistically when touching those files. |

## Full scope coverage (nothing silently left out)

The layer model above covers the domain code; this table accounts for **every**
part of the repo so nothing is missed during migration. Items already placed
above are cross-referenced; newly-accounted items are called out.

### In `src/`

| Path | Layer / disposition | Notes |
| --- | --- | --- |
| `App.jsx`, `main.jsx`, `index.css` | Presentation + composition root | `main.jsx`/`index.css` are bootstrap; leave at root. `App.jsx` shrinks as `session/` extracts. |
| `components/`, `config/` | Presentation; config → stays (or `config/` folded near `schema/`) | design tokens are presentation foundation. |
| `schema/` | Schema (leaf) | + understudy *vocabulary* (step 5). |
| `utils/constraints*.js` | → `rules/` (step 1) | |
| `utils/derivedState.js`, `tenantResolver.js` | → `state/` (adapter) (step 3) | |
| **`validators.js`** | → `state/documentValidation.js` | **newly accounted** — document validation ≠ Evaluation (see the two-validators table). |
| `utils/assignmentValidator.js`, `swapPolicy.js` | → `evaluation/` (step 4) | |
| `utils/availabilityUtils.js`, `rosterStats.js`, `distributionUtils.jsx` | **→ `src/readmodel/` (step 8b ✅ done)** | live aggregate views of State; share counting primitives with `rules/` but do **not** route through the placement registry. |
| `utils/calendarUtils.js`, `colorUtils.js`, `dataExport.js`, `bulkClear.js` | `calendarUtils`,`dataExport` **→ `src/lib/` (8c-i ✅)**; `colorUtils` **→ `src/design/` (8c-ii ✅)**; `bulkClear` **→ `src/session/` (post-overhaul follow-on ✅)**, split: `buildBulkClear` (domain) → `session/bulkClear.js`, and the shared `slotKey` primitive → `lib/slotKey.js` | `buildBulkClear` IS domain (roster/slot shape, one draft edit + undo) — a session-command helper, not generic — so it lives in `session/`. But `slotKey` (`date#roleIndex`) is a domain-free leaf shared by the UI, the diff, and the command, so it lives in `lib/` (the guard forbids `components → session`; deduped `rosterDiff`'s local copy too). `colorUtils`'s role-colour palette is design-system (colour policy). |
| `utils/statsTheme.js` (+ `designSystem.lint.test.js`) | **→ `src/design/designSystem.js` (8c-ii ✅, renamed)** | misnamed — it's the app-wide design-system token module, not a stat. Renamed on the move; owns the glass/typography/z-index tokens (see [design-system.md](design-system.md)). |
| `rosterGenerator/` | **→ `src/generation/` (step 8a ✅ done)** + `evaluation/` split (steps 4–5) | |
| `data/` | Storage/Providers (+ `useDraftHistory.js` → `session/`) | steps 6–7. |
| `hooks/useRosterData.js` | → `session/`; `useAuth.js` stays `hooks/` | |
| `telegram.js` (root) | **→ `src/integrations/telegram.js` (step 8d ✅ done)** | read-only integration today; write-path split foreshadowed (see architecture.md). |
| **`src/test/setup.js`** | test harness — **stays**, path preserved | **newly accounted** — see migration plan; `vitest.config.js` `setupFiles` must keep resolving. |

### Outside `src/` (previously unmapped)

| Path | Disposition |
| --- | --- |
| **`supabase/migrations/`** | **Authorization lives here** (RLS is the real authority). The overhaul does **not** move it, but the Authorization cross-cutting concern must *link* to it (owned by [permissions.md](permissions.md)). **newly accounted.** |
| **`public/` sample YAMLs** | Fixtures / demo documents. Keep; ensure they stay in the *document shapes* the single adapter understands. **newly accounted.** |
| **`vite.config.js`, `vitest.config.js`, `tailwind.config.js`, `postcss.config.js`, `index.html`** | Build/test config. Folder moves change import paths — see migration plan (consider path aliases). **newly accounted.** |
| **`README.md`, `CONTRIBUTING.md`** | Describe structure; update when folders change. `AGENTS.md` gets the naming-mandate + spec-per-step rules. **newly accounted.** |

### Explicitly OUT of scope

`todo.md`, `local/` (gitignored inputs), `dist/` (build output), `node_modules/`.

Steps 1–10 are pure structure/renaming — every one is behaviour-preserving and
green. **Step 11 (per-action command surface) is the one deliberate exception:**
it was pulled into the overhaul by explicit decision and *does* change behaviour
(new warn-verdicts on manual edits). It is called out as such in its own step and
progress row; the "behaviour-preserving" guarantee applies to steps 1–10.

## Specs & tests migration plan

The code refactor is only a third of the effort. Per [`../AGENTS.md`](../AGENTS.md)
the spec and tests move *in the same change* as the code. Two migrations run in
lockstep with the 10 code steps.

### A. Specs migration

**Principle:** specs are organized by **concern**, code by **layer** — they need
not be 1:1, but every layer must have an owning spec, and no fact may live in two.

| Overhaul step | Owning spec to update | What changes |
| --- | --- | --- |
| 1 `rules/` extract | [generation.md](generation.md) (rules authority) + [architecture.md](architecture.md) module map | record the `rules/` home + "imports only Schema" invariant |
| 2 unify rule registries | [generation.md](generation.md) | `SCORERS` already exists; document the shared `rules/` home + `defineRule`/`defineScorer` factory + hard/soft symmetry |
| 3 `state/` + doc-validation | [data-layer.md](data-layer.md) | adapter=inbound port; the two-validators distinction; `data.warnings` |
| 4 evaluation/generation split | [generation.md](generation.md) | judge vs. agent boundary |
| 5 understudy split | [understudy.md](understudy.md) | vocabulary/policy/phases split by layer |
| 6 `session/` | [session.md](session.md) | draft/commit/undo (deferred to [data-layer.md](data-layer.md)) + command surface + gate policy — **created at step 11** |
| 7 provider CRUD contract | [data-layer.md](data-layer.md) | `RosterProvider` = CRUD; one shared adapter |
| 8 readmodel/integrations/lib | **new `specs/integrations.md`** (planned) + [architecture.md](architecture.md) | read-model bright line (live, non-registry); read vs. write integrations; lib boundary |
| 10 graph enforcement | [architecture.md](architecture.md) | the dependency-direction rule as an enforced invariant |

Spec housekeeping the overhaul must also do:
- **Retire this file** once built: fold its now-true parts into `architecture.md`
  and delete the `.plan.md`, per the README's plan-doc convention.
- **Update [specs/README.md](README.md)** — the map of which file owns what.
  `session.md` has been **created (step 11)** and moved into the map;
  `integrations.md` remains foreshadowed in the README's "Planned specs" note.
  When it is created, move it from that note into the map, and remove this plan's
  entry when it retires.
- **Move code-level detail beside code**, not in specs: e.g. `rosterGenerator`'s
  internals README travels with the folder to `generation/README.md`.

### B. Tests migration

**Principle:** tests are **co-located** with their source (verified: 20 of 22 sit
beside their module). When a module moves folders, **its `.test` moves with it**
in the *same* commit, and its import paths update. This keeps every step green.

Tests needing special handling (not a simple co-move):

1. **`src/test/setup.js` + `vitest.config.js`** — the harness. **Do not move
   `setup.js`**; if it ever moves, update `setupFiles: './src/test/setup.js'` in
   the same commit. Verify after *every* step that the config still resolves.
2. **`crossTeam.test.js`** — a cross-cutting test with **no single source file**
   (spans adapter + rules). **✅ resolved (audit A1):** homed in `evaluation/`
   beside the layer it most asserts (`EligibilityChecker`/`validateEventAssignments`/
   `explainSwap`) — its imports of `state/assignmentTracker` + `schema` stay
   relative. No `src/__integration__/` folder was needed for a single test.
3. **`designSystem.lint.test.js`** — an **architectural guard**, not a unit test.
   It's the *precedent* for step 10's dependency-cruiser guard. Group such guards
   (design-tokens, dependency-direction) under `src/__guards__/` or similar so
   "guard tests" are visibly distinct from behaviour tests.
4. **`useDraftHistory.test.js`** — moves with `useDraftHistory.js` from `data/`
   into `session/` (step 6).
5. **Test data** must use **schema constants** (`rosterSchema.js`), per
   `../AGENTS.md` — the schema move (if any) must not break fixtures.

### C. Per-step green checklist (applies to every step 1–10)

Each step is one logical commit that must satisfy, in order:
1. move code file(s) to the layer folder;
2. move the co-located `.test` file(s) with them; update all import paths;
3. rename symbols to the layer vocabulary (step 9 rider);
4. update the **owning spec** (table A) + the module map + README if the map changed;
5. `npx vitest run` (all green) **and** `npm run build` (succeeds);
6. confirm `vitest.config.js` still resolves `setupFiles` and picks up the moved tests.

No step lands red; if a move can't stay green atomically, it's too big — split it.

# Architecture overhaul (IN PROGRESS — living migration doc)

> **Status: in progress (steps 1–8 landed).** This is a *target* architecture
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

(Write-back — `writeBackEvents`, `tenantSelection`, roster enumeration — is the
adapter's `State → document` direction; it too is shape-mapping, sitting at the
core↔provider seam, distinct from the provider's actual persistence.)

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
| **Adapter** (core inbound port) | **two pure fns** (no verbs) | `toState(document) → State` · `toDocument(State) → document` | a *transform*, not an actor. Giving a pure function CRUD verbs miscasts it. |

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
   `undo`), an adapter fn is a transform (`toState`/`toDocument`), a rule is a
   descriptor (`{ key, kind, check }`). Avoid cross-vocabulary names — e.g. don't
   call a session command `saveEvents` (that's CRUD leaking up) or a provider
   `applySwap` (that's a command leaking down). The name should tell you which
   layer you're in.

Concrete renames this implies (examples, not exhaustive; do them as the owning
files move): `updateEvents` → a session command (`applyDraftEdit`/`stageEvents`);
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
9. **⬜ (rides along) Vocabulary rename pass** (folds through every step above, not a separate
   big-bang): as each file moves to its layer folder, rename its symbols to the
   layer's vocabulary (provider→CRUD, session→command/query, adapter→transform,
   rule→descriptor). Do it *per moved file* so each stays green; record notable
   renames in the naming-decisions section.
10. **⬜ (Optional) Enforce the graph**: a `dependency-cruiser` rule set that fails
    CI on an arrow pointing the wrong way (e.g. `rules/` importing `evaluation/`,
    or the core importing `session/`/`data/`).

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
| 4 — split evaluation/generation | ✅ done | `b9c012a` | 400 pass | ~~`evaluation/` imports understudy from `../utils/understudy`~~ **cleared by step 5** (now `schema/understudyRoles.js` + `rules/understudyPolicy.js`). `evaluateState` (whole-roster judge) still lives inside `generation/index.js`. **Step 8a decision:** it stayed put during the `rosterGenerator/`→`generation/` rename — it is a *private* local-search objective (not an exported judge), tightly coupled to the generator's scoring internals, so hoisting it into `evaluation/` would mean exporting + untangling it, i.e. scope creep beyond a folder move. Deferred: fold it into `evaluation/` only if/when it needs to be reused outside the generator. |
| 5 — split `understudy.js` by kind | ✅ done | `d59f896` | 400 pass (24 files) | **debt-clearing step.** `understudy.js` split: vocabulary → `schema/understudyRoles.js`, policy → `rules/understudyPolicy.js` (policy imports vocab — correct Rules→Schema direction). Old `utils/understudy.js`+test deleted; test split to match. No `utils/understudy` importers remain, so steps 1/3/4's coupling is gone. `UNDERSTUDY_SUFFIX` stays vocabulary-internal (no external importer). Seeding/promotion **phases** already live in `generation/` and were untouched. |
| 6 — extract `session/` | ✅ done | `5626b91`; lift `3bba88a` | 404 pass (25 files) | ~~**Deferred debt:** draft/undo/commit still called *inside* both providers, so Session not yet above Provider.~~ **RESOLVED by the Session lift** (`3bba88a`): added `session/useSession.js` which wraps a provider and owns the draft/commit + undo/redo overlay + the `updateEvents`/`replaceData` commands; providers are now pure CRUD (`saveEvents`/`replaceDocument`), and `useRosterData` composes `useSession(provider)`. Session sits *above* Provider as the model prescribes. Internal `commands`/`store` split still deferred (see Resolved). |
| 7 — provider CRUD contract | ✅ done | `073861e`; split `3bba88a` | 404 pass (25 files) | ~~**Deferred debt (from step 6):** the `draft/session` key group still lives on the provider surface.~~ **RESOLVED by the Session lift** (`3bba88a`): the contract is now split into `PROVIDER_KEYS` (pure CRUD) + `SESSION_KEYS` (draft/history + edit commands), `ROSTER_PROVIDER_KEYS = [...PROVIDER_KEYS, ...SESSION_KEYS]`. Conformance test asserts each provider returns exactly `PROVIDER_KEYS` and `useSession(provider)` returns exactly `ROSTER_PROVIDER_KEYS`. The adapter-rename half landed with step 9. |
| 6/7 — Session lift (inversion) | ✅ done | `3bba88a` | 404 pass (25 files, +1 composition) | The structural inversion both prior steps deferred. Providers → pure CRUD; `useSession` composes the draft/command surface above them. **Judgment call:** the draft-reset that used to happen synchronously inside `applyDoc`/`importData`/`selectRoster` is now a single `useEffect` in `useSession` keyed on the provider's `originalData` reference (the one signal common to all load/import/clear/select paths *and* the only one available for the provider-internal background `loadRosters`). Trade-off: a one-tick lag between a new document loading and the draft resetting, vs. the old synchronous reset — acceptable because a fresh load rarely coexists with a live draft, and it unifies all reset paths through one mechanism. A future `specs/session.md` should own the Session command-surface + draft/commit contract in full (currently split across [data-layer.md](data-layer.md) + [architecture.md](architecture.md)). |
| 8 — tidy periphery | ✅ done | 8a `127ec27`; 8b `a779dc6`; 8c-i `cf44783`; 8c-ii `a7efdb7`; 8d `872817f` | 403 pass (25 files) | **Sub-committed** (too big for one commit). **8a:** `rosterGenerator/` → `src/generation/`. **8b:** read-model views → `src/readmodel/`. **8c-i:** the *genuinely generic* helpers `calendarUtils` + `dataExport` (leaf, no relative imports) → `src/lib/`; 4 importers rewired. **8c-ii:** `statsTheme.js` is the **misnamed design-system** token module → renamed to `designSystem.js` and rehomed with `colorUtils` (role-colour palette = colour policy) + the lint guard + both tests into a new `src/design/` folder; ~20 importers rewired (14 `statsTheme`, 6 `colorUtils`), lint-guard internal path/allowlist refs fixed, [design-system.md](design-system.md) + [architecture.md](architecture.md) + this plan updated. **8d:** `telegram.js` (root) → `src/integrations/` (git mv; no relative imports, one importer `main.jsx` rewired) — it's a **read-only** integration today (viewport/theme mirroring), so there was no write path to split; the future bot write path (actor on the session command surface) stays foreshadowed in [architecture.md](architecture.md). **8c decision:** `bulkClear` **stays** in `utils/` — it's *domain* (roster/slot shape, produces one draft edit + undo step), a session-command helper bound for `session/` when the command surface lands, not a `lib/` generic. |
| 9 — vocabulary rename | ⬜ rides along (in progress) | 9-adapter `d437eae` | 403 pass (25 files) | not a standalone commit. **Pulled forward:** the `state/` adapter + `documentValidation` now name their inbound param `document` (not `data`), so the Document→State boundary reads in the code. **Adapter transform rename (this commit):** `getDerivedState` → `toState`, `resolveDerivedState` → `resolveState` (the naming table prescribes the verb-free `toState`-family; `resolveState` names the aggregator that adds the cross-team `externalAssignments`). `resolveTenant` keeps its name (it's the tenant-flatten half, already a transform verb). Rewired App.jsx (2 call sites) + the full `derivedState.test.js` suite (~50) + comment refs in `tenantResolver.js`/`rosterDefaults.js`/`availabilityUtils.test.js`; updated [data-layer.md](data-layer.md) + [multi-tenant.md](multi-tenant.md). *Lesson (earlier):* a blind `data`→`document` also rewrote a user-facing error string (`'YAML data is empty or invalid'`); reverted — renames must not change display text. |
| 10 — enforce the graph | ⬜ optional | — | — | the CI gate that makes all above debt un-reintroducible. |

**Baseline before the overhaul:** 392 tests, `npm run build` green (commit `5bb41c8`).

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
| `utils/calendarUtils.js`, `colorUtils.js`, `dataExport.js`, `bulkClear.js` | `calendarUtils`,`dataExport` **→ `src/lib/` (8c-i ✅)**; `colorUtils` **→ `src/design/` (8c-ii ✅)**; `bulkClear` **stays** (domain → `session/` later) | `bulkClear` IS domain (roster/slot shape, one draft edit + undo) — a session-command helper, not generic. `colorUtils`'s role-colour palette is design-system (colour policy). |
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
Behaviour changes of any kind are out of scope — **this overhaul is pure
structure/renaming; every step is behaviour-preserving and green.**

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
| 6 `session/` | **new `specs/session.md`** (or a section in data-layer) | draft/commit/undo + command surface — **currently unspecified**; needs a home |
| 7 provider CRUD contract | [data-layer.md](data-layer.md) | `RosterProvider` = CRUD; one shared adapter |
| 8 readmodel/integrations/lib | **new `specs/integrations.md`** (planned) + [architecture.md](architecture.md) | read-model bright line (live, non-registry); read vs. write integrations; lib boundary |
| 10 graph enforcement | [architecture.md](architecture.md) | the dependency-direction rule as an enforced invariant |

Spec housekeeping the overhaul must also do:
- **Retire this file** once built: fold its now-true parts into `architecture.md`
  and delete the `.plan.md`, per the README's plan-doc convention.
- **Update [specs/README.md](README.md)** — the map of which file owns what. The
  two future specs (`session.md`, `integrations.md`) are already **foreshadowed**
  in the README's "Planned specs" note; when each is created, move it from that
  note into the map, and remove this plan's entry when it retires.
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
   (spans adapter + rules). It can't "travel with" one module. Decide a home for
   *cross-layer* tests: either a top-level `src/__integration__/` (tests that
   exercise multiple layers) or keep beside the layer it most asserts (Rules).
   Flag it explicitly so it isn't orphaned.
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

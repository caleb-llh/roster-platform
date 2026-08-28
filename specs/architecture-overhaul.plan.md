# Architecture overhaul (DESIGN — not yet built)

> **Status: proposal.** This is a *target* architecture, written to guide an
> incremental refactor. It does **not** describe the current on-disk structure —
> for that, see the [Module map](architecture.md#module-map) in
> [architecture.md](architecture.md). Nothing here is binding until it lands as
> code; each move is a mechanical, green-per-step refactor per
> [`../AGENTS.md`](../AGENTS.md). This file owns the *target layer model, its
> data flow, and the folder layout*; when a piece is built, the owning behaviour
> spec (generation.md, data-layer.md, permissions.md…) remains the authority for
> that piece's rules — this doc links to them, it does not restate them.

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

This doc names the layers, states the one data-flow rule (**the core is a pure
function of a single State snapshot**), and gives the target folders — so the
refactor has a target and future changes have a place to belong.

## The mental model: a rule engine over shared state

Take a step back. Strip away UI, storage, and integrations and what remains is a
**rule engine**:

- a **vocabulary** everything is written in (Schema),
- a body of **facts** — the current roster + derived counts (State),
- a **rule base** — what's legal (constraints) and what's good (scorers) (Rules),
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
**`useDraftHistory.js` currently lives under `data/` (provider layer) — the
overhaul moves it to the Session layer** (`hooks/` or a `session/` module),
leaving `data/` as pure providers.

### Generation runs *on* the Session's State — it doesn't live there

The generator-the-algorithm is pure — `(State, Rules, seed) → candidate State` —
and stays in the **core**. Only the *act of running it as a user action*
("regenerate next month": deciding when, capturing the result as a new draft,
pushing it onto the undo stack) is a **Session** concern. The Session calls
*down* into Generation and files the result into history; Generation never reaches
*up* into the Session. (Same relationship Evaluation has with its callers.)

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

> **Guard-rail: this is a rule-engine *shape*, not a rule-engine *implementation*.**
> The value is the *separation* (Rules ⋈ State → verdict), which already exists in
> the code. Do **not** build a Rete network, a rules DSL, or a runtime "solver
> service" everything calls into. The core is a small, pure, typed library of a
> dozen descriptors — not a framework.

## The periphery

The domain core is wrapped by four concerns that don't belong inside it:

| Concern | Role | Depends on the core how |
| --- | --- | --- |
| **Presentation** | Views + design-system foundation. Renders verdicts; lets humans override. | Reads State + Evaluation output; issues edits. |
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
        │   PROVIDERS    │──adapter──▶│  Generation ⇄ State            │
        │ local│supabase │  (in-port) │  Evaluation = Rules ⋈ State    │
        └───────┬────────┘            │  all speaking  Schema          │
                │                      └────────────────────────────────┘
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
                 #   from utils/constraints.js, constraintPrimitives.js,
                 #        rosterGenerator/scorers.js
                 #   + understudy *policy* (isPromotedForRole, canFillSlotRole,
                 #     countUnderstudySessionsBefore, UNDERSTUDY_MIN_SESSIONS)
  state/         # the facts + the ADAPTER (core's inbound port) that builds them
                 #   from utils/derivedState.js, tenantResolver.js,
                 #        rosterGenerator/rosterState.js, assignmentTracker.js
                 #   (shape-mapping only — NOT byte-serialization)
  evaluation/    # inference: apply rules to state (the JUDGE)
                 #   from utils/assignmentValidator.js, swapPolicy.js,
                 #        rosterGenerator/eligibilityChecker.js
  generation/    # the AGENT: search/optimize by mutating state
                 #   from rosterGenerator/index.js, localSearch.js, rng.js,
                 #        understudySeeding.js, promotionPlanning.js  (phases)

  # ── periphery ────────────────────────────────────────────────
  data/          # storage PROVIDERS + the RosterProvider contract (pure backends;
                 #   byte-serialization lives here — YAML text / SQL rows)
  session/       # command surface + draft/commit + undo/redo (the "time" layer)
                 #   from data/useDraftHistory.js (moved out of data/),
                 #        hooks/useRosterData.js
  hooks/         # useAuth and other React glue
  components/    # presentation + design-system foundation
  integrations/  # read: cron/calendar-export/bot-query (read-model consumers)
                 # write: bot commands (actors on the session command surface)
                 #   from telegram.js (root, today)

  # ── cross-cutting ────────────────────────────────────────────
  lib/           # generic helpers: calendarUtils, colorUtils, dataExport
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
- **Adapter belongs to the core, not the provider.** It is the inbound
  anti-corruption port; it maps document *shapes*, not backend bytes. Relegating
  it to providers would leak the core's State contract into every backend.
- **Draft/commit + undo/redo are a `session/` layer, not core or storage.** The
  core is timeless; "time" (history, draft-vs-committed) is a Session concern.
  `useDraftHistory.js` moves out of `data/`.
- **A command surface, not a REST API.** Uniform verbs so UI/bot/cron are
  interchangeable callers; CQRS-flavoured (commands carry verdicts), not HTTP.
- **Understudy splits by kind** (vocabulary→Schema, policy→Rules, phases→
  Generation) rather than living as one cross-cutting file.

## Suggested refactor order (each step green)

Highest payoff first; every step keeps `npx vitest run` + `npm run build` green
and updates the owning spec:

1. **Extract `rules/`** (move constraints + primitives; no behaviour change).
   Establishes the core's home and its "imports only Schema" boundary.
2. **Promote scorers to a registry** (`{ key, weight, score }`) mirroring
   constraints, with a `defineConstraint`/`defineScorer` factory + a conformance
   test. Makes hard/soft symmetric. (Update [generation.md](generation.md).)
3. **Extract `state/`** (adapter + rosterState + tracker together). Names the
   working-memory concern; deletes the "domain model" ambiguity.
4. **Split `evaluation/` from `generation/`** inside today's `rosterGenerator/`.
   Separates judge from agent.
5. **Split `understudy.js` by kind**: vocabulary → `schema/`, policy → `rules/`,
   leaving seeding/promotion phases in `generation/`. Update [understudy.md](understudy.md).
6. **Extract `session/`**: move `useDraftHistory.js` out of `data/`, and define
   the uniform command surface (query/generate/swap/commit/undo) the UI calls.
   Leaves `data/` as pure providers.
7. **Tidy periphery**: `lib/` for generic helpers; `integrations/` split into
   read-model consumers vs. command-surface actors (telegram write path routes
   through the session command surface).
8. **(Optional) Enforce the graph**: a `dependency-cruiser` rule set that fails
   CI on an arrow pointing the wrong way (e.g. `rules/` importing `evaluation/`,
   or the core importing `session/`/`data/`).

Steps 1–2 alone deliver most of the clarity; 3–8 are follow-ons.

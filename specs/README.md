# Specs — the binding specification

This folder is the **binding specification** for Roster Platform. It records the
non-obvious behaviour of the system and, crucially, *why* it works the way it
does, so that future changes don't silently regress a decision that was made
deliberately.

> **Changing any behaviour described here requires updating the relevant spec
> file in the same change.** This is not optional — see [`../AGENTS.md`](../AGENTS.md)
> for the mandatory feedback loop (code → tests → spec → verify).

The spec is authoritative. When code and a spec disagree, that is a bug in one
of them — reconcile it, don't ignore it. Before changing generation,
eligibility, scoring, the data structure, the draft/commit model, or the
understudy feature, re-read the relevant file below.

## Map

| File | Covers |
| --- | --- |
| [architecture.md](architecture.md) | System architecture and **off-repo context** you can't learn from the code alone: the dual-mode data layer, the provider contract, the Supabase **data model**, OAuth setup, GitHub Pages deployment, the env-var mode switch, and a high-level generation-pipeline overview. (Authorization has its own file — see permissions.md.) |
| [permissions.md](permissions.md) | The **authorization model** in one place: the `(actor, action, target)` principle, the **permission-role vs. team-role** invariant (governance vs. schedulable capability — must not be conflated), the current per-roster RBAC (client flags → RLS policies, DB-is-authority invariant), and the planned tenant-scoped `can(action, target)` model with its action matrix. |
| [data-layer.md](data-layer.md) | The `event.roster` positional-array data structure, the draft/commit model (separate from undo/redo history), inline change review, and why roster statistics are recomputed live rather than read from a generation snapshot. |
| [generation.md](generation.md) | The generation algorithm's binding rules: generated-vs-locked slots, "generation only fills empty slots" (default) + `optimizeExisting`, consecutive-weekend avoidance as a Phase-2 objective term, the removed availability scorer, the **hard-constraint registry ("one authority, many consumers")** — the `CONSTRAINTS` list every consumer (generator, validator, swap, dropdown) reads instead of re-owning the rules — and determinism. Scoring weights and internals live in [`../src/utils/rosterGenerator/README.md`](../src/utils/rosterGenerator/README.md). |
| [understudy.md](understudy.md) | The understudy/promotion feature end-to-end: the model, the two role-capability rules that must not be conflated, the understudy hard-constraint *domain rules* (min-sessions, cap=1, two-sided gate — enforced via the shared `CONSTRAINTS` registry, see generation.md), and the promotion-aware seeding and backtracking-planner phases. |
| [design-system.md](design-system.md) | The look-and-feel spec: the `statsTheme.js` token module, the named z-index scale, the `HoverCard` popup primitive, sticky-chrome stacking, the colour policy, the no-emoji rule, and the UI's calibrated typographic decisions. |
| [events-ui.md](events-ui.md) | Events-view interaction spec: bulk-clear semantics + how select mode is entered, the three selection scales, why there's no drag-marquee, export column order, manual swap validation, and why generation runs immediately with no confirm gate/result modal. |
| [multi-tenant.md](multi-tenant.md) | **Phases 0–2 built; Phase 3 (Supabase persistence) planned.** The tenant → team → roster hierarchy, tenant-level member registry, cross-team-aware constraints (global unavailability, cross-team caps, clash detection, per-team overrides), the compatibility seam that keeps the generation engine unchanged, a feature-by-feature impact analysis, and the phased delivery plan. (Its RBAC half lives in permissions.md.) |
| [members-editing.plan.md](members-editing.plan.md) | **PLANNING (not built).** Feature plan for inline-editable member cards (mirroring EventsView), and the constraints it must respect. Defers scope/storage to multi-tenant.md and authorization to permissions.md. |
| [architecture-overhaul.plan.md](architecture-overhaul.plan.md) | **IN PROGRESS (living migration doc; steps 1–2 landed).** Target layer model *and* the running record of an incremental refactor toward it — carries a **Migration progress log** tracking each step's commit and residual debt. Covers: the rule-engine framing (Schema vocabulary; Rules ⋈ State → Evaluation; Generation mutates State), why Schema is orthogonal to both Rules and State, the `ctx` Rules↔Evaluation seam, the two-kinds-of-validation distinction (doc-shape vs. roster-verdict), the live **read-model** bright line, the periphery (presentation/storage/integrations) + cross-cutting authorization & lib, the target folder layout, naming decisions, the resolved policy-registry-pattern and session-split decisions, a full-scope coverage map, a specs/tests migration plan, and a green-per-step refactor order. Links to the owning behaviour specs rather than restating them. It **foreshadows two future specs** — see the note below. |

### Planned specs (not yet created)

The [architecture-overhaul.plan.md](architecture-overhaul.plan.md) refactor will,
as it lands, introduce two new spec files that this map does not yet list because
they do not yet exist:

- **`session.md`** — will own the draft/commit/undo model and the command surface
  (currently unspecified; created at overhaul step 6).
- **`integrations.md`** — will own the read-model bright line and the read-vs-write
  integrations split (created at overhaul step 8).

When either file is created, add it to the map above and remove it from this list.
When the overhaul completes, `architecture-overhaul.plan.md` folds into
[architecture.md](architecture.md) and is deleted, per the plan-doc convention.

## How to read a Design Decision

Each entry states **what** the decision is and **why** — including the
rationale a naive alternative was rejected, and any invariant a past bug
revealed (e.g. "locked slots must never move"). Keep entries concise and link
to the code by name. Add a new entry when behaviour is non-obvious/surprising, a
magic number has a reason that must not be tuned away, a bug fix revealed an
invariant, or two similar-looking concepts must not be conflated.

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

## Binding specs are timeless — status lives in plans

A binding spec (every file here that is **not** a `*.plan.md`) describes the
system in **present tense, as it is**. It carries no status framing — no
"Phase 2 ✅ landed", no "not yet built", no "IN PROGRESS", no status blockquote.
That framing rots the moment work moves and reads as a migration narrative
rather than a description of the system.

- **Unbuilt / sequenced work** lives in a `*.plan.md` (that is what plan docs are
  for; status belongs there).
- **Completed migration records** live in `specs/history/` — kept for the *why*,
  clearly labelled non-binding.
- **When a phase or plan lands**, fold its decisions into the owning spec as
  plain present-tense behaviour and let the sequencing drop away. A plan doc
  retires by folding its durable parts into the owning spec and deleting itself.

## Map

| File | Covers |
| --- | --- |
| [architecture.md](architecture.md) | System architecture and **off-repo context** you can't learn from the code alone: the dual-mode data layer, the provider contract, the Supabase **data model**, OAuth setup, GitHub Pages deployment, the env-var mode switch, and a high-level generation-pipeline overview. (Authorization has its own file — see permissions.md.) |
| [permissions.md](permissions.md) | The **authorization model** in one place: the `(actor, action, target)` principle, the **permission-role vs. team-role** invariant (governance vs. schedulable capability — must not be conflated), the current per-roster RBAC (client flags → RLS policies, DB-is-authority invariant), and the planned tenant-scoped `can(action, target)` model with its action matrix. |
| [data-layer.md](data-layer.md) | The `event.roster` positional-array data structure, the draft/commit model (separate from undo/redo history), inline change review, and why roster statistics are recomputed live rather than read from a generation snapshot. |
| [session.md](session.md) | The **Session command surface**: the pure per-action commands (`assign`/`addSlot`/`removeSlot`/`swap`/`clearGenerated`/`bulkClear`) that express every domain mutation once, the **warn-still-apply vs. swap-hard-reject gate policy**, the compute-without-applying `preview` mode for confirmation-staged actions, and the pure-command / hook-wiring / UI separation of concerns. (The draft/commit + undo/redo model it sits on top of lives in data-layer.md.) |
| [generation.md](generation.md) | The generation algorithm's binding rules: generated-vs-locked slots, "generation only fills empty slots" (default) + `optimizeExisting`, consecutive-weekend avoidance as a Phase-2 objective term, the removed availability scorer, the **hard-constraint registry ("one authority, many consumers")** — the `CONSTRAINTS` list every consumer (generator, validator, swap, dropdown) reads instead of re-owning the rules — and determinism. Scoring weights and internals live in [`../src/generation/README.md`](../src/generation/README.md). |
| [understudy.md](understudy.md) | The understudy/promotion feature end-to-end: the model, the two role-capability rules that must not be conflated, the understudy hard-constraint *domain rules* (min-sessions, cap=1, two-sided gate — enforced via the shared `CONSTRAINTS` registry, see generation.md), and the promotion-aware seeding and backtracking-planner phases. |
| [design-system.md](design-system.md) | The look-and-feel spec: the `designSystem.js` token module, the named z-index scale, the `HoverCard` popup primitive, sticky-chrome stacking, the colour policy, the no-emoji rule, and the UI's calibrated typographic decisions. |
| [events-ui.md](events-ui.md) | Events-view interaction spec: bulk-clear semantics + how select mode is entered, the three selection scales, why there's no drag-marquee, export column order, manual swap validation, and why generation runs immediately with no confirm gate/result modal. |
| [integrations.md](integrations.md) | The **read-vs-write integrations split**: read (outbound) integrations consume a committed roster at the periphery and never touch the core; write (inbound) integrations are actors that must issue domain commands through the [session.md](session.md) command surface, as peers of the UI. Telegram theme/viewport mirroring is today's read-only integration. |
| [multi-tenant.md](multi-tenant.md) | **Phases 0–2 built; Phase 3 (Supabase persistence) planned.** The tenant → team → roster hierarchy, tenant-level member registry, cross-team-aware constraints (global unavailability, cross-team caps, clash detection, per-team overrides), the compatibility seam that keeps the generation engine unchanged, a feature-by-feature impact analysis, and the phased delivery plan. (Its RBAC half lives in permissions.md.) |
| [members-editing.plan.md](members-editing.plan.md) | **PLANNING (not built).** Feature plan for inline-editable member cards (mirroring EventsView), and the constraints it must respect. Defers scope/storage to multi-tenant.md and authorization to permissions.md. |
| [specs-cleanup.plan.md](specs-cleanup.plan.md) | **PLANNING.** The post-overhaul specs/code cleanup plan (todo.md#L3-5): fixes spec↔code path drift, creates `integrations.md`, retires the architecture-overhaul plan into a history archive, and makes the binding specs timeless. Retires itself when done. |
| [history/architecture-overhaul.history.md](history/architecture-overhaul.history.md) | **History (non-binding).** The completed architecture-overhaul migration record — the reasoning behind each decision and the step-by-step log. Its durable architecture is now authoritative in [architecture.md](architecture.md); kept only for the *why*. |

## How to read a Design Decision

Each entry states **what** the decision is and **why** — including the
rationale a naive alternative was rejected, and any invariant a past bug
revealed (e.g. "locked slots must never move"). Keep entries concise and link
to the code by name. Add a new entry when behaviour is non-obvious/surprising, a
magic number has a reason that must not be tuned away, a bug fix revealed an
invariant, or two similar-looking concepts must not be conflated.

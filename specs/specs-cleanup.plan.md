# Specs & code cleanup after the architecture overhaul (plan)

> **Status: PLANNING (not started).** This is the plan for todo.md#L3-5 —
> "cleanup code/specs bloat after the architecture overhaul." It is a
> *documentation/readability* pass, not a behaviour change. Nothing here is
> authorized to implement yet; it is the task list for review. When it lands,
> this file retires like any `*.plan.md` (fold the durable decision into the
> owning spec, delete the plan).

## Why this exists

The overhaul (and its full N/B/C/A readability backlog) is **complete** — every
row in [architecture-overhaul.plan.md](architecture-overhaul.plan.md)'s progress
log is ✅, the layer graph is enforced by the CI guard, and tests are 445/33
green. But the *specs* still read as if the overhaul is mid-flight, and a few
concrete references drifted. The todo item asks three questions; the assessment
below answers each, then the plan closes the gaps.

The guiding constraint (from the todo and AGENTS): **remove no essential
information.** Make the specs *timeless* (describe the system as it is) rather
than *sequential* (a narrative of how it was migrated). The migration narrative
has value as history, but it should not be the front-and-centre framing a
newcomer hits.

## Assessment (read-only findings)

### Q1 — Readability: do namings and boundaries reflect the architecture?

**Code: yes.** The layer folders (`schema/rules/evaluation/generation/state/
session/readmodel/data/design/lib/integrations/components`) match the mental
model, the guard enforces the dependency direction, and the whole verb–noun
rename backlog (N1–N9) plus the structural moves (A1–A3, B/C) have landed. The
audit's "verified-clean, do not fix" list confirms the load-bearing names are
correct. **No code changes are proposed by this plan** — the code side of the
todo is effectively done by the completed backlog.

**Specs: not yet.** The specs are organized by concern and mostly link rather
than restate, but the *framing* is stale (see Q3) and a handful of path
references rotted during the re-foldering (see Q2).

### Q2 — Drift between code, specs, and tests

Tests co-locate with their source and are green, so **code↔test** is in sync.
The **spec↔code** drift is concrete and small:

| # | Spec file · line | Stale reference | Correct now |
| --- | --- | --- | --- |
| D1 | README.md L25 | `../src/utils/rosterGenerator/README.md` | `../src/generation/README.md` |
| D2 | data-layer.md L22 | `../src/utils/calendarUtils.js` | `../src/lib/calendarUtils.js` |
| D3 | multi-tenant.md L444 | `../src/utils/constraintPrimitives.js` | `../src/rules/constraintPrimitives.js` |
| D4 | multi-tenant.md L202 | prose "the whole `utils/` layer" | no `utils/` layer exists — consumers are spread across `generation/`, `evaluation/`, `readmodel/`, `state/` |
| D5 | README.md L31 | overhaul "IN PROGRESS (steps 1–2 landed)" | overhaul **complete** (steps 1–11 + backlog) |
| D6 | multi-tenant.md L1, L3-6 | title "(not yet built)" / "Nothing here is implemented yet" | **Phases 0–2 built**, Phase 3 planned (README L29 already says this; the file contradicts itself) |

These are the "drift" the todo asks about. All are one-line fixes except D6
(a self-contradiction inside multi-tenant.md).

### Q3 — Spec folding/rollup that is due (timeless, not sequential)

Three structural bloat items, in priority order:

**F1 — Retire `architecture-overhaul.plan.md` (the big one).** The file is
~1040 lines and its own header + housekeeping section mandate its retirement:
*"fold its now-true parts into `architecture.md` and delete the `.plan.md`, per
the README's plan-doc convention."* Right now it is simultaneously (a) the only
home of several *durable* architectural decisions (the rule-engine mental model,
"Schema is orthogonal", the `ctx` seam, the naming mandate, the read-model
bright line) and (b) a long *sequential* migration log (11 steps + ~20 backlog
rows) that is pure history. A newcomer reading `specs/` hits a 1000-line
"in-progress migration" as a top-level file — the single biggest readability and
bloat problem.

The fold is *not* "delete the history." It is: move the **timeless** parts into
their owning specs, preserve the **historical** log as history, and remove the
plan file from the live map.

**F2 — Create `integrations.md` (a long-standing promise).** README's "Planned
specs" note and the plan's spec-migration table both promise an `integrations.md`
that "owns the read-model bright line and the read-vs-write integrations split."
The code (`src/readmodel/`, `src/integrations/telegram.js`) is built; the spec
was never created, so that bright-line rationale currently lives *only* inside
the plan doc — which means F1 can't just delete it. Creating `integrations.md`
is the natural home for that content when F1 folds.

**F3 — Reconcile the concept-duplications the separation-of-concerns rule
flags.** The audit found a few facts described in detail in two files (each has a
clear owner + a link, so this is lower severity than F1/F2, but it is exactly the
"no fact in two files" rule):
- **Two-sided understudy gate** mechanics (`understudy-before-role` /
  `understudy-complete`) spelled out in both generation.md and understudy.md →
  understudy.md owns the domain rule; generation.md should link.
- **"Load derives from assignments"** cross-team fold stated as a Design
  Decision in both generation.md and multi-tenant.md → pick one owner, link
  from the other.
- **`no-clash` interval-overlap semantics** owned by data-layer.md but
  re-explained in multi-tenant.md and generation.md → keep the owner, thin the
  restatements to links.

## The plan (each step its own green commit; docs-only)

Because these are documentation changes, "green" means: `npx vitest run` still
445/33 (no test references a path we rename in a *comment* incorrectly) and
`npm run build` succeeds. The guard is unaffected (no code moves). Each step
closes the AGENTS loop (change → the "test" here is the doc-link integrity +
build → the spec *is* the artifact → verify).

### Step 1 — Fix the concrete path drift (D1–D4)
Low-risk, mechanical. Update the four stale references to their current paths;
fix the "whole `utils/` layer" prose (D4) to name the actual layers. Verify no
other `src/utils/` string survives anywhere in `specs/`.
**Owning specs:** README.md, data-layer.md, multi-tenant.md.

### Step 2 — Fix the two status self-contradictions (D5, D6)
- README.md L31: rewrite the overhaul-plan map row from "IN PROGRESS (steps 1–2
  landed)" to "COMPLETE — being retired (see Step 4)". (If Step 4 lands in the
  same pass, this row is removed instead.)
- multi-tenant.md L1 + L3-6: align the title/status blockquote with the file's
  own phased-delivery log and README L29 — "Phases 0–2 built; Phase 3 (Supabase
  persistence) planned."
**Owning specs:** README.md, multi-tenant.md.

### Step 3 — Create `integrations.md` (F2)
Create a concern-owned spec for the **read-vs-write integrations split**:
telegram is read-only mirroring (viewport/theme) today; the bot write-path is a
future actor on the session command surface. Add it to README's map; remove it
from the "Planned specs" note.
**Decision (locked):** the **read-model bright line stays in data-layer.md**
(which already owns "stats recomputed live, not snapshotted"); `integrations.md`
does *not* take it. The durable read-model rationale currently buried in the
overhaul plan doc folds into data-layer.md in Step 4, not here. So Step 3's new
spec is small — it owns only the integrations read/write boundary.

### Step 4 — Retire `architecture-overhaul.plan.md` (F1) — the main event
Fold in three moves so nothing durable is lost:
1. **Relocate the timeless architecture** (rule-engine model, "Schema is
   orthogonal", the `ctx` Rules↔Evaluation seam, the naming mandate, the
   target layer model + dependency-direction rationale) into **architecture.md**
   — most of it is *already* summarized there; this reconciles the two so
   architecture.md is the single authority for "how the system is shaped."
2. **Preserve the migration history** rather than delete it. The 11-step log +
   backlog rows are a valuable record of *why* decisions were made. Move them to
   a clearly-historical home so they stop reading as "current work." **Options
   (need your pick):**
   - (a) a `specs/history/` archive file
     (`specs/history/architecture-overhaul.history.md`) — keeps every row,
     clearly labelled "completed migration record, not binding"; **← chosen.**
   - (b) collapse to a short "Overhaul summary" appendix inside architecture.md
     (a paragraph + a link to the git history), dropping the row-by-row log;
   - (c) delete outright (the git log *is* the history) — lightest, but loses
     the curated rationale.
   **Decision (locked): (a)** — honors "remove no essential information" while
   getting the 1000-line in-progress doc out of the live spec surface.
3. **Delete `architecture-overhaul.plan.md`** and update README's map (remove its
   row; adjust the "when the overhaul completes, it folds into architecture.md"
   note to past tense).
**Owning specs:** architecture.md (gains the durable parts), README.md (map),
plus the chosen history home.

### Step 5 — Reconcile concept-duplications (F3)
Thin the three duplications to single-owner + link. Smallest-diff, purely
editorial; do last so it operates on the already-reconciled files.
**Owning specs:** generation.md, understudy.md, multi-tenant.md, data-layer.md.

## Scope boundaries (what this plan deliberately does NOT do)

- **No code changes.** The code side of the todo is satisfied by the completed
  backlog; touching code here would be scope creep.
- **No new features.** `integrations.md` documents what exists (+ the already-
  foreshadowed bot write-path), not new integration work.
- **No deletion of essential rationale.** Every "fold" relocates or archives;
  the only outright deletion on the table is the *plan file itself* (Step 4.3),
  and only after its durable content is relocated.
- **The other todo.md backlog items** (staging env, telegram bot, playground
  mode, etc.) are out of scope — this is strictly the L3-5 cleanup item.

## Decisions (locked with the user)

1. **Step 4.2 history home** — **archive file** at
   `specs/history/architecture-overhaul.history.md` (keeps every row, labelled
   non-binding).
2. **Step 3 read-model bright line** — **stays in data-layer.md**;
   `integrations.md` owns only the integrations read/write split.
3. **Sequencing** — **Steps 1–2 first** (drift + status fixes) as one commit,
   then pause for review before Steps 3–5.

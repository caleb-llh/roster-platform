# Agent Working Agreement

This file governs how any agent (human or AI) works in this repository. Its
central rule: **the spec is binding, and every change feeds back into it.**

Always clarify where there is ambiguity.

## The spec

The **binding specification** lives in [`specs/`](specs/) — one file per domain,
indexed by [`specs/README.md`](specs/README.md), which owns the map of *which
file covers what*. It records *why* the system behaves the way it does. Where a
decision's rationale depends on code-level implementation detail (module layout,
tuning internals), that detail lives **beside the code** in a README, and the
owning spec links to it rather than duplicating it.

The spec is authoritative:

- **Do not silently contradict it.** If a task would change behavior that the
  spec describes, that is a spec change — treat it as such (see the loop below).
- **Do not regress it by accident.** Before changing generation, eligibility,
  scoring, the data structure, or the understudy feature, re-read the relevant
  Design Decision. If your change conflicts with a decision, stop and confirm
  the intent with the user before proceeding.
- When code and the spec disagree, that is a bug in one of them — reconcile it,
  don't ignore it.

**Binding specs are timeless.** A binding spec (every file in [`specs/`](specs/)
that is *not* a `*.plan.md`) describes the system in **present tense, as it is**.
It carries no status or sequencing framing — no "Phase 2 landed", "not yet
built", "IN PROGRESS", "step N of the overhaul", "was moved / now removed", and
no status blockquote. That framing rots the moment work moves and turns a spec
into a migration narrative. Instead:

- **Unbuilt / sequenced work** lives in a `*.plan.md` — that is what plan docs
  are for.
- **Completed migration records** live in [`specs/history/`](specs/history/),
  clearly labelled non-binding, kept for the *why*.
- **When a plan or phase lands**, fold its decisions into the owning spec as
  plain present-tense behaviour and let the sequencing drop away. A plan doc
  retires by folding its durable parts into the owning spec and deleting itself.

Describing genuine *future product* intent ("a bot write-path is foreshadowed",
"the tenant-scoped model") is fine — that is design, not refactor bookkeeping.
The algorithm's own runtime pipeline phases (generation Phase 0/0.5/1/2) are
timeless behaviour, not sequencing.

## The feedback loop (mandatory)

Every bug fix or feature MUST close this loop **within the same change**:

1. **Change the code** to fix the bug or add the feature.
2. **Add or update tests** that lock in the new behavior.
3. **Update the spec.** If the change makes, reverses, or clarifies a design
   decision — or fixes a bug whose root cause is non-obvious — record it in the
   relevant [`specs/`](specs/) file. Include the *rationale* (the "why"), not
   just the "what". If it changes code-level implementation detail that a spec
   defers to (e.g. generator internals), also update the README that lives
   beside that code.
   - **Respect separation of concerns across specs; do not conflate them.** Each
     spec file owns one concern. Put a fact in the **one** file that owns its
     concern and **link** from others instead of restating it. If you find the
     same thing described (or, worse, described *differently*) in two files, that
     is a conflation bug — reconcile it into the owning file in this change. When
     a new concern doesn't fit an existing file, give it its own spec rather than
     bolting it onto an unrelated one. (See [`specs/README.md`](specs/README.md)
     for which file owns what.)
4. **Decision-check: isolated vs. shared.** For each change, decide whether the
   logic belongs to *this* component (an isolated change) or to a *shared*
   place — a util, primitive, or design-system token that other code should
   reuse. Two rules:
   - **Don't duplicate.** If you write logic that already exists elsewhere (a
     date parse, an eligibility check, a style token), reuse the shared version
     or promote yours into one. Reconcile the duplication *in this change*.
   - **Put it where it belongs.** Domain logic doesn't go in a "shared"
     grab-bag; truly cross-cutting helpers don't stay buried in one component.
   This is a *bounded* check, not a mandate to refactor unrelated code. Only act
   on duplication or misplacement that your current change creates or touches.
   Larger cleanups get noted (in the spec or a TODO), not force-fit.
5. **Verify**: `npx vitest run` (all tests pass) and `npm run build` (succeeds).

A change is not "done" until the spec reflects it. Knowledge from a debugging
session — the root cause, the reason a naive approach failed, the reason a
weight/threshold has the value it does — belongs in the spec so it is not
rediscovered later.

Propose updates to this feedback loop if there is room for improvements to the harness.

### When to add a Design Decision entry

Add an entry when any of the following is true:

- The behavior is **non-obvious** or surprising, or a "simpler" alternative was
  deliberately rejected.
- A **magic number / threshold** (e.g. a scoring weight, a session cap) has a
  reason that must not be tuned away blindly.
- A **bug fix** revealed an invariant that must hold (e.g. "locked slots must
  never move"). Capture the invariant, not just the patch.
- Two similar-looking concepts must **not be conflated** (e.g. `canFillSlotRole`
  vs `isRoleCapable`).

Keep entries concise: what the decision is, and why. Link to the code by name.

## Tooling conventions

- Tests: `npx vitest run` (or `npm test`). Use schema constants
  (`rosterSchema.js`) in test data.
- Build check: `npm run build`.
- Never commit unless the user explicitly asks. When asked, do not commit
  secrets or the gitignored `local/` inputs.


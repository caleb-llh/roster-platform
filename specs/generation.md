# Generation algorithm (binding spec)

Binding rules for the roster generator. The **scoring weights and internal
mechanics** (seeding lookahead, the local-search move set, `evaluateState`
terms) live in [`../src/utils/rosterGenerator/README.md`](../src/utils/rosterGenerator/README.md);
the understudy/promotion phases have their own spec in
[understudy.md](understudy.md). A high-level pipeline overview is in
[architecture.md](architecture.md#generation-pipeline-overview).

## Generated vs. locked (pre-assigned) slots

- A slot with `isGenerated: true` was placed by the generator. Within the run that places it, it may be freely moved/replaced by local search — **but a slot that was *already* filled when the run started is locked by default** (see "Generation only fills empty slots" below), so re-running generate does not reshuffle prior work.
- A slot that is **filled and *not* `isGenerated`** is a **manually pre-assigned ("locked") slot**. `RosterState.isLocked(slot)` identifies these.
- A generated slot may also be **pinned** (`slot._pinnedPromotion`) by the promotion-planning phase; pinned slots are treated as locked for the duration of the run (transient — stripped before results are returned).
- **Local search must never move a locked slot.** Phase 2 swap enumeration excludes locked slots (`slots.filter(s => getOccupant(s) && !isLocked(s))`). Pre-assigned members are respected as hard commitments.

## Generation only fills empty slots (binding, default)

By default `generateRoster` is **additive**: it fills the empty slots and never reshuffles assignments that already exist — including ones an *earlier, still-uncommitted* generation produced. Rationale: a user reported "I only have 1 unfilled slot, and generating makes 8 unsaved changes." That was Phase 2 local search doing its job — re-optimizing the *whole* roster (fairness/spread/preferences) by swapping already-generated slots — but it is surprising and undesirable as a default: each generate should add to the roster, not churn what the user already has and is reviewing in the draft. **Mechanism:** before Phase 1, every slot occupied at run start is tagged `_preExisting` and `RosterState.isLocked` treats it as locked, so Phase 2 can only rearrange the slots *this* run filled. Manually pre-assigned slots were already locked (`!isGenerated`); this extends the same protection to prior *generated* slots. The tag is transient — stripped before results are returned (like `_pinnedPromotion`), so it never leaks into roster data. The whole-roster re-optimization is preserved behind an **`optimizeExisting` option** (default `false`), intended to become a user toggle on a future algorithm-settings page. Note this means generate cannot *improve* an already-full roster in the default mode — that is the deliberate trade for predictability.

## Consecutive-weekend avoidance is a Phase-2 objective term, not just a Phase-1 bias

`AVOID_CONSECUTIVE_WEEKS` is enforced in **two** places that must stay in sync: the per-candidate `consecutiveWeekends` scorer (weight `200`) that biases Phase-1 greedy construction, **and** the whole-roster objective `evaluateState` (`index.js`), which counts consecutive-weekend pairs across the roster (`countConsecutiveWeekendViolations`, weighted by `SCORING_WEIGHTS.consecutiveWeekends`, gated by the same preference). Rationale: Phase-2 local search only optimises what `evaluateState` measures. If a soft goal exists only as a Phase-1 scorer, a later swap can freely re-introduce the thing it was meant to avoid — exactly the trap that made the availability scorer useless (below). **Invariant: every soft goal that biases greedy scoring must also appear as a term in `evaluateState`, or local search can undo it.**

## Availability is a constraint, not an objective (removed scorer)

The `availability` scorer (which prioritized members with fewer available dates) was **removed**. It was a Phase-1 greedy heuristic that never appeared in the Phase-2 objective, so it couldn't survive local search and caused confusing workload imbalance. Availability is properly a **hard eligibility constraint** (`ENFORCE_MEMBER_AVAILABILITY`), not a fairness objective. Do not re-introduce it as a scorer.

## Hard constraints: one authority, many consumers

The soft rules already have a single authority: the [`SCORERS`](../src/rules/scorers.js)
registry, consumed by **both** per-candidate scoring and the whole-roster
`evaluateState` objective, so they can't drift (see the consecutive-weekend
invariant above). **Hard constraints now follow the same shape** via the
[`CONSTRAINTS`](../src/rules/constraints.js) registry. Several call sites *consume*
that one list rather than re-owning the rules — three read the **full** rule set,
and the assignment dropdown reads the **feasibility** subset:

- **`EligibilityChecker.isEligible`** ([`eligibilityChecker.js`](../src/utils/rosterGenerator/eligibilityChecker.js)) — the generator's **predictive** question: *"**may** I place M here?"* (`would-place` mode, tracker-backed counts).
- **`validateEventAssignments`** ([`assignmentValidator.js`](../src/utils/assignmentValidator.js)) — the **diagnostic** question: *"is this **already-placed** assignment violating a rule?"* (`is-placed` mode, scan-backed counts; keeps its own enumerating wording).
- **`explainSwap`** ([`swapPolicy.js`](../src/utils/swapPolicy.js)) — the manual **feasibility subset**, predictive, both directions.
- **The assignment dropdown** ([`getAvailableMembersForEvent`](../src/rules/constraintPrimitives.js), rendered by [`EventsView.jsx`](../src/components/EventsView.jsx)) — a **UI feasibility consumer**: its per-candidate `available` flag comes from the `availability` descriptor (called directly, bypassing `enabled`, so unavailability always shows as a cue). Role capability is the UI `canFillSlotRole`/promotion rule (see [understudy.md](understudy.md), deliberately not a registry constraint), and once-per-slot filtering is positional UI logic; it does **not** apply load-cadence caps (a human picks freely, like a swap).

They share low-level helpers ([`constraintPrimitives.js`](../src/rules/constraintPrimitives.js), `understudy.js`) **and**
now the rule set itself. One difference remains, and it is intentional: the
generator uses `count >= cap` (predictive — "would this *reach* the cap") while
the validator uses `count > cap` (diagnostic — "has this *exceeded* the cap").
That difference is a single line inside one `check`, selected by `mode`.

**Design Decision — the rules live in [`src/rules/`](../src/rules/).** The
registry ([`constraints.js`](../src/rules/constraints.js)) and the leaf predicates
it composes ([`constraintPrimitives.js`](../src/rules/constraintPrimitives.js))
were moved out of `src/utils/` into a dedicated `rules/` layer (overhaul step 1;
see [architecture-overhaul.plan.md](architecture-overhaul.plan.md)). This is a
pure move — the descriptors, `ctx` contract, and `mode` semantics are unchanged.
The target boundary is *"`rules/` imports only Schema"*, so consumers depend on
`rules/` and never the reverse. **Residual coupling (not yet clean):** both files
still import role-capability vocabulary from `../utils/understudy` (e.g.
`isUnderstudyRole`, `baseRoleOf`). That is deliberate for now — understudy is
split by kind (vocabulary → Schema, policy → Rules) only at overhaul step 5; until
then the import direction points *out of* `rules/`, which the step-10 dependency
graph will forbid.

**Design Decision — both registries share a `rules/` home and a descriptor
factory.** `SCORERS` was moved from `rosterGenerator/scorers.js` to
[`src/rules/scorers.js`](../src/rules/scorers.js), next to `CONSTRAINTS` (overhaul
step 2). Both registries are now constructed through
[`defineRule` / `defineScorer`](../src/rules/defineRule.js) — thin, explicit
descriptor constructors that make the required shape self-documenting
(`{ key, kind, enabled, check }` for a constraint; `{ key, enabled, score }` +
optional `factor` for a scorer) and **fail loud at load time** if a field is
missing, rather than deep inside the generator. The factories are deliberately
*identity* — they validate and return the same plain object; there is no wrapping,
no engine indirection, no rule DSL (the "shape, not machinery" line). A
conformance test ([`registries.test.js`](../src/rules/registries.test.js)) locks
in the shape, key-uniqueness, and that every scorer has a `SCORING_WEIGHTS` entry.

**Design Decision — a single hard-constraint registry, many consumers.** Each
hard constraint is modelled once as a descriptor (mirroring `SCORERS`), tagged by
*when* it applies:

- **`kind: 'feasibility'`** — physically impossible to violate: active/included,
  role capability, availability, once-per-event, and the **time clash** (`no-clash`
  — a member in two events whose spans overlap; see
  [data-layer.md](data-layer.md#time-granularity-events-are-datetime-ranges-ui-still-groups-by-day)
  for the interval semantics). Enforced by **all** consumers, including manual
  swap/self-assign.
- **`kind: 'load-cadence'`** — policy caps that a human may deliberately override:
  once-per-week, max-per-month, the understudy-before-role gate. Enforced by the
  **generator** and flagged by the **validator**, but **not** by manual swaps.
  This is why a manual swap enforces a *subset* — the subset is exactly the
  feasibility rules, by design, not an oversight
  ([permissions.md](permissions.md) leans on this for `roster:assign-self`).

The predictive-vs-diagnostic distinction (the `>=`/`>` above) is a property of
the **question the consumer asks**, not a per-copy detail: the registry runs in a
`would-place` mode for the generator/swap and an `is-placed` mode for the
validator. **Invariant: a hard rule is defined once; generator, validator,
swap, and the dropdown ask the same rule set different questions. Adding/changing
a constraint touches one descriptor, not one-per-consumer copies.**

Not every place that mentions availability is a registry consumer. The
**roster-stats availability chart** ([`computeAvailabilityByRole`](../src/utils/availabilityUtils.js))
deliberately is **not**: it answers a bench-depth question ("how many members
*could* I field for role R on date D") that is capability-AND-free and ignores
who is already assigned, any specific slot, and all caps. It shares the same
low-level primitives (`canFillSlotRole`, `isMemberUnavailable`) — correct reuse —
but routing it through the placement-oriented registry would be a category error
(it is not evaluating a placement). See [events-ui.md](events-ui.md).

**Design Decision — the counting seam (tracker vs. scan).** Feasibility rules
read intrinsic facts off `ctx` (`memberConstraints`, `members`). Load-cadence
rules need *counts*, which each consumer computes differently: the generator from
its stateful [`AssignmentTracker`](../src/utils/rosterGenerator/assignmentTracker.js)
(incremental, fast in the O(slots²) placement loop), the validator from a
whole-roster scan of `allEvents` (no running tally on a finished roster). To keep
the rule defined once, the descriptor calls a small **uniform counting interface**
the consumer supplies on `ctx` — `currentRoster(placement)`,
`weeklyCount(memberId, date)`, `monthlyCount(memberId, date)`,
`priorUnderstudySessions(memberId, baseRole, date)`, and
`overlappingEvents(placement)` (the OTHER events whose span overlaps, powering
`no-clash` — the generator scans its live sorted events, the validator scans
`allEvents`, and each excludes the placement's own event so the rule is
mode-insensitive). Only the plumbing differs,
never the rule. This is *why* the same predicate can be shared even though the
generator and validator look nothing alike internally: they are the same check
asked in different modes over differently-sourced counts. In `would-place` mode
the counts **exclude** the pending placement (`count >= cap`); in `is-placed`
mode they **include** it (`count > cap`) — same cap, one extra already-counted
self.

**Design Decision — cross-team load/clash folds *through* the counting seam, not
around it.** The multi-tenant `externalAssignments` snapshot (a member's
assignments on OTHER teams) is enforced by adding it *inside* the same `ctx`
methods above: `weeklyCount`/`monthlyCount` add the external in-week/in-month
count when `ENFORCE_CROSS_TEAM_CAPS` is on, and `overlappingEvents` folds in the
member's external events when `ENFORCE_CROSS_TEAM_CLASH` is on. Because the fold is
in the plumbing, the `no-clash`/`once-per-week`/`max-per-month` *descriptors* are
untouched (the clash descriptor only gained a `params.external` flag so a
consumer can word a cross-team clash distinctly). Both keys default **OFF** and
the snapshot is empty in single-team mode, so single-team output is byte-for-byte
identical. Two subtleties, owned in detail by
[multi-tenant.md](multi-tenant.md#phased-delivery): cross-team **caps depend on
the local cap** being enabled (they change *what counts*, not *whether the cap
applies*); cross-team **clash BLOCKS during generation** (it is feasibility, not
a soft cadence), so the generator OR-s `ENFORCE_CROSS_TEAM_CLASH` into the
`no-clash` run condition even when `ENFORCE_NO_CLASH` is off.

**Registry shape (ratified).** Each constraint is one descriptor in a
`CONSTRAINTS` list (named to pair with `SCORERS`; "constraint" is already the
domain word — `rosterConstraints`, `CONSTRAINT_KEYS`):

```
{
  key,                       // stable id (also owns the violation code)
  kind,                      // 'feasibility' | 'load-cadence'
  enabled(ctx),              // reads the rosterConstraints flag
  check(placement, ctx, mode) => violation | null
}
```

- **One `check` + a `mode` flag**, `mode ∈ { 'would-place', 'is-placed' }`. The
  single line that differs for counting rules lives *inside* one function
  (`mode === 'would-place' ? count >= cap : count > cap`), so the two comparisons
  sit side by side and cannot drift. Feasibility rules ignore `mode`. Rejected
  "diagnostic-only + simulate placement": it would turn every candidate check in
  the O(slots²) hot loop into mutate→recompute→revert to answer what a read-only
  `>=` answers for free, and would force a whole-roster scan where the generator
  only needs a single-placement short-circuit.
- **Violations are structured, not prose.** `check` returns `null` or
  `{ code, params }` (e.g. `{ code: 'unavailable', params: { memberId, date } }`),
  and each **consumer formats its own sentence** — the swap toast uses the shared
  `formatViolation`, while the generator and validator keep their own wording
  (the validator additionally *enumerates* the offending events, which a
  single-placement `check` cannot express; the shared part is the *decision*, not
  the message). Codes stay i18n-ready.
- **Two registries, not one.** `CONSTRAINTS` is pass/fail-with-a-reason (the
  hard-rule half of "eligibility & assignment policy"); `SCORERS` is weighted
  score (the soft half). Do **not** merge them — conflating a hard reject with a
  soft penalty is the mistake the removed `availability` scorer made (above).
- **Two-sided understudy gate.** The `understudy-before-role` descriptor encodes
  both halves: a trainee entering the *real* role needs ≥ `UNDERSTUDY_MIN_SESSIONS`
  prior understudy sessions (`understudy-before-role` code), and a qualified
  trainee re-entering the *understudy* slot is blocked (`understudy-complete`
  code). The second half is a generator-only placement guard (there is no
  "over-understudied" defect to diagnose on a finished roster), so it is emitted
  only in `would-place` mode and the validator ignores it.

## Determinism

Generation is deterministic: a fixed seed drives all tie-breaks (`rng.js`). Every decision is captured by a verbose logger surfaced as the "Algorithm log" in the result dialog.

# Data layer (binding spec)

Covers the roster data structure, the draft/commit model, inline change review,
and real-time statistics. See also [architecture.md](architecture.md) for the
dual-mode provider contract that persists this data.

## Data structure: `event.roster` is a positional array

`event.roster` is an **array** of slot objects `{ role, member_id, isGenerated? }` — *not* a role-keyed map. This is intentional so a role can appear multiple times in one event (e.g. two `support` slots, or a role plus its understudy). Any view that needs a role→member lookup must group into positional buckets (`byRole[role][index]`) rather than collapsing to a single value per role, or duplicate slots disappear.

- The CSV / "Copy to Excel" exports compute an `exportColumns` layout: for each role, the max count across all events → that many numbered columns; understudy roles get their own columns; cells are filled positionally from the per-event `byRole` buckets.

## Time granularity: events are datetime ranges (UI still groups by day)

**Model (implemented): a half-open datetime interval per event.** An event's
time span is resolved by [`eventInterval`](../src/utils/constraintPrimitives.js)
to `[start, end)` in epoch ms. The fields are **additive and lossless**: an event
may carry explicit `start`/`end` datetime strings, but a bare `event.date`
(`YYYY-MM-DD`) is the whole-day range `[date 00:00, date+1 00:00)`. Parsing is
local-midnight (never `new Date('YYYY-MM-DD')`, which is UTC), matching the
`parseDayKey` invariant in [`calendarUtils.js`](../src/utils/calendarUtils.js) so
a day can't slip a timezone. Member unavailability remains a set of **day keys**
(`expandUnavailableDays`, which already supports a whole-day `{ start, end }`).

### Design decisions

- **Clash = interval overlap, not date-equality.** Two events conflict iff their
  `[start, end)` ranges overlap, computed by `intervalsOverlap`/`eventsClash` in
  [`constraintPrimitives.js`](../src/utils/constraintPrimitives.js). Overlap is
  **half-open**: touching boundaries (`a.end === b.start`) do *not* clash, so
  back-to-back services are legal. This **subsumes** the old whole-day model —
  two bare-date events on the same day are two whole-day ranges, so they still
  clash exactly as before, while a morning and an evening *timed* service on one
  day no longer do. This is the single rule the future cross-team clash check
  ([multi-tenant.md](multi-tenant.md#compatibility-seam-how-we-avoid-rewriting-the-engine))
  is written against — authored once against intervals.
- **The clash rule is a hard constraint, enforced via the registry.** It is the
  `no-clash` (`ENFORCE_NO_CLASH`) **feasibility** descriptor in the `CONSTRAINTS`
  registry — the generator, validator and manual swap all consume that one
  descriptor rather than re-implementing overlap. Ownership/architecture of the
  registry lives in
  [generation.md](generation.md#hard-constraints-one-authority-many-consumers);
  this file owns only the *interval semantics* the descriptor is built on.
  `no-clash` is distinct from `once-per-event`: the latter forbids a member in
  two slots of **one** event; the former forbids a member in two **different**
  overlapping events.
- **Backfill is lossless.** Existing `event.date` and whole-day blockouts map to
  a whole-day range; `sample.yaml` and the validators accept both the bare date
  (back-compat) and the explicit `start`/`end` datetimes, the same way member
  `roles` accept both a string and the object form. `validateDates` checks that
  any provided datetimes parse and that `start <= end`.
- **Week/month bucketing keys off `start`.** The fairness/spread counters use the
  range's start instant, so an event that spans midnight is counted in its
  start's week/month (defined, not ambiguous). Date-only events are unaffected
  because their start day *is* their date.
- **UI still groups by day (time-of-day inputs deferred).** The calendar, month
  grid, and past-event muting ([`EventsView`](../src/components/EventsView.jsx))
  keep grouping visually by day while the *model* is datetime. Surfacing
  time-of-day editing in the UI — and displaying multiple events per day — is a
  deliberately separate, not-yet-built change.
- **`include` is the ONE "is this member schedulable?" field.** The predicate is
  centralized in `isMemberIncluded(member)`
  ([`rosterSchema.js`](../src/schema/rosterSchema.js)): a member is schedulable
  unless they opt out with `include: false` (absent = included). The schema,
  `sample.yaml`, generator, validator, stats and the tenant resolver
  (`member_overrides`) all key off this one field, so `getDerivedState`'s
  `activeMembers` cannot disagree with generation/stats. A legacy `active: false`
  is still honoured **only as an alias** so very old documents don't silently
  start scheduling opted-out members — there is no separate `active` concept.
  (This fixes a real bug: `getDerivedState` previously filtered on `m.active`,
  which is *absent* on tenant-resolved members, so `member_overrides` sabbaticals
  were silently ignored in the schedulable count.)

## `sample.yaml` is the canonical valid-schema example

[`public/sample.yaml`](../public/sample.yaml) is the **single source of truth for what a valid input document looks like**. It must always parse (`js-yaml`) and pass `runAllValidators` with zero errors, and it should exercise every supported field so that reading it teaches the full schema — including the object form of member `roles` (`- name: <role>`) and the `understudy: true` flag. When the schema changes, update `sample.yaml` in the same change (it is part of the feedback loop in [`../AGENTS.md`](../AGENTS.md)); a stale sample is a spec regression. Member `roles` accept both the object form and a bare string for backward compatibility (`normalizeMemberRoles` handles both), but the sample and new documents use the object form for consistency and to make the understudy flag expressible.

**Nested tenant sibling.** [`public/sample_tenant.yaml`](../public/sample_tenant.yaml) is the canonical example of the **nested multi-tenant shape** (tenant + member registry + `teams[].team_members`/`rosters`). It is a *sibling*, not a replacement: the flat `sample.yaml` stays the default and both are valid inputs. The nested shape and its flat-back-compat rule are owned by [multi-tenant.md](multi-tenant.md#phase-1-contract-local-model); the resolver (`resolveTenant`) flattens a selected team+roster back into *this* flat schema, so validators/engine are shape-agnostic. A validator test resolves every team+roster of `sample_tenant.yaml` and asserts each is a valid flat document.

## Draft/commit is separate from undo/redo history

Assignment edits (manual slot edits, swaps, generation, YAML-editor roster changes) do **not** touch the persisted "binding" immediately. They accumulate in an uncommitted **draft** that overlays the committed events; the UI renders `effectiveEvents = draftEvents ?? data.events`. Only **Save** (`commitDraft`) writes the draft into the working document — in production it also writes through to Supabase. **Discard** drops the draft. This gives one explicit, reviewable "publish" step and keeps a half-finished roster from becoming the shared source of truth.

The mechanism lives in [`useDraftHistory.js`](../src/data/useDraftHistory.js) as **pure transitions** (`applyEdit`/`undoState`/`redoState`/`clearDraft`) wrapped by a hook; both providers use it, so the two modes behave identically and the logic is unit-testable without a renderer. Non-event document fields (members, roles, constraints) still apply immediately — the draft only tracks events.

**Undo/redo are a distinct concern from commit.** They navigate a two-stack history (`undoStack`/`redoStack`) of event snapshots and never persist. Crucially, **commit and discard leave both history stacks intact** — saving is not "the end of history", so you can still undo past a save (the pre-edit snapshot is compared against the new committed state). Conflating the two (e.g. clearing history on save) was deliberately rejected: users expect Ctrl+Z to keep working after they save. Every edit funnels through `updateEvents`, which is the single place that records an undo snapshot; individual handlers must not snapshot separately (that was the old `saveToHistory` pattern, now removed). Shortcuts: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z (or Ctrl+Y) redo, ignored while typing in a field.

**Uncommitted changes are shown inline, not in a separate panel.** [`computeRosterDiff`](../src/utils/rosterDiff.js) compares committed vs. draft positionally (by `date` + `roleIndex`, matching the array data structure) and yields per-slot `added`/`removed`/`changed` markers plus the net set of members added-to / removed-from the roster. Each changed slot shows a small colored dot in its corner (no heavy border) whose hover tooltip gives the detail (`role: before → after`); a sticky Save/Discard bar summarises the **count** only. The bar is gated on the **diff being non-empty** (`rosterDiff.slotChanges.length > 0`), *not* merely on `hasUncommitted`: a draft can exist yet net to zero actual slot changes (e.g. an edit that is manually reverted to the committed value), and in that case the bar must not appear reading "0 unsaved changes". **The bar deliberately does not list affected member names inline:** at realistic edit volumes (e.g. a regenerate touching dozens of slots) the net added/removed lists grow long and the bare `+`/`−` prefixes read as stray punctuation rather than "on/off the roster", crowding what the design system defines as the single highest-urgency chrome. `affectedMemberIds` is still computed (and unit-tested) as part of the diff API — it is just no longer surfaced in the bar; who-changed detail lives in the expandable review list. Membership is computed net (a member moved between slots is *not* reported as removed). The bar's count is a toggle that expands an IDE-copilot-style **change-review list** ([`ChangeReviewPanel`](../src/components/ChangeReviewPanel.jsx)) grouping every change by event date with its `role` and `before → after`; the list is **read-only** (Save/Discard act on the whole draft) — per-change accept/reject was deliberately not built because the draft/commit model treats the draft as one atomic publish unit.

## Roster statistics are real-time, not a generation snapshot

Roster statistics — including the quality metrics (the shift-distribution bell curve, per-member Time Spacing, and per-role Role Rotation Quality) **and the unassignable-roles warning** — are computed from the **current** roster state on every render by `calculateRosterStats(events, members, rosterPeriod, memberConstraints, rosterConstraints)` (`rosterStats.js`). It builds a live `AssignmentTracker` from the present `events` so the fairness/spread formulas are identical to the generator's, and returns `fairnessMetrics` + `assignedRoles` + `unassignableRoles`. Rationale: previously the detailed quality metrics read from the frozen `generationResult` snapshot, so hand-edits/swaps left them **stale** while the summary numbers above them updated — an inconsistency. The `generationResult` state has been removed entirely; the only place a generation-time count is still appropriate is the transient post-generate **toast** (it reports what *that click* filled, computed from the run's own `result.stats`), which reads the local `result` directly, not stored state. **Invariant: anything a user can change by editing the roster must be recomputed from `events`, not read from a generation snapshot.**

**Unassignable-roles warning is live, not a generation snapshot.** The "Unassignable Roles" panel lists slots that are **currently empty** and for which **no active member is eligible** under the current roster + constraints, computed in `calculateRosterStats` via the same `EligibilityChecker` the generator uses (so the eligibility rules never drift between the two). It therefore updates in real time: the moment a user manually assigns a member the slot leaves the list, and if an eligible-less slot is emptied it reappears. Rationale: a user reported "it stayed even after I found an assignment" — the panel was reading the frozen `generationResult.stats.unassignableRoles` from the last generation, which never reflected later edits. Once-per-event eligibility is judged against the event's already-filled slots (`event.roster.filter(s => s.member_id)`); `calculateRosterStats` now takes `memberConstraints`/`rosterConstraints` for this (defaulting to empty so callers/tests without constraints still get an empty, non-crashing list).

**Quality metrics are shown as human-meaningful quantities, not raw std-devs.** The compact `QualityMetrics` panel deliberately does **not** surface `assignmentStdDev`/`spreadStdDev` as bare numbers — a "1.34" told a scheduler nothing. Instead: the Shift Balance card was **removed** (the bell curve already shows workload spread); **Time Spacing** is a per-member **timeline** that plots each shift as a dot positioned by date across the roster period (`memberStats[].assignmentDates` on a shared `periodStart`/`periodEnd` axis) so clustering vs. even spacing reads visually — chosen over a single `avgGapDays` bar because a bar collapses *when* shifts fall into one scalar and hides bunching; the numeric `~avgGapDays` is kept only as a right-hand annotation; **Role Rotation Quality** is one bar per role of `rotationRatio = uniqueMembers / totalAssignments` (1.0 = every shift went to a different person, low = the same few people repeat the role). The old "Avg Members Per Role" gauge and the separate "Member Workload Distribution" list were removed (the bell curve + Time Spacing timeline cover per-member insight). `avgGapDays` is `null` for members with fewer than two shifts (no gap to measure). The raw std-dev fields still exist on `fairnessMetrics` for the generator's objective and the full `QualityMetrics` view (RosterStatsPanel "Show Details").

Note the two distinct `stats` shapes: `generationResult.stats` holds **scalar counts** (`assignedRoles`, `totalRoles`, `generatedAssignments`) plus the `unassignableRoles` array, whereas `calculateRosterStats(...)` returns arrays.

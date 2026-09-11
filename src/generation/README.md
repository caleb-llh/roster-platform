# Roster Generator

Automated roster generation algorithm that fills unassigned roles while maximizing fairness and honoring constraints and preferences.

## Architecture

The roster generator uses **promotion-aware seeding, greedy construction, then
local search**, with a pluggable weighted-scoring registry and reversible move
primitives:

```
src/generation/
├── index.js                 # Main entry point (seed + plan + greedy init + local search)
├── understudySeeding.js     # Phase 0: promotion-aware understudy seeding
├── promotionPlanning.js     # Phase 0.5: backtracking promotion planner (maximise promotions)
├── scoringEngine.js         # Thin adapter that ranks candidates via ../rules/scorers.js
├── localSearch.js           # Hill-climbing optimizer (swaps + fill-empty, skips locked)
├── rng.js                   # Seeded PRNG (deterministic randomization)
├── actionLog.js             # Verbose action logger (result.log / logEntries)
└── rosterGenerator.test.js  # Comprehensive test suite
```

> The judge lives in the evaluation layer, not here:
> `EligibilityChecker` (`../evaluation/eligibilityChecker.js`) — the generator's
> predictive "may I place M here?" gate — moved to `src/evaluation/` alongside
> `assignmentValidator.js` and `swapPolicy.js` (overhaul step 4). The generator
> imports and instantiates it; it does not own it. See the
> [generation spec](../../specs/generation.md) and the two-validators note in
> [data-layer.md](../../specs/data-layer.md).

> State lives in the state layer, not here: `AssignmentTracker`
> (`../state/assignmentTracker.js`) and `RosterState`
> (`../state/rosterState.js`) are the engine's working-memory shape and moved to
> `src/state/` (overhaul step 3). The generator imports them; it does not own them.
> See the [data-layer spec](../../specs/data-layer.md).

> Scoring lives in the rules layer, not here: the `SCORERS` registry and
> `SCORING_WEIGHTS` moved to `../rules/scorers.js` (overhaul step 2), sharing a
> home and a `defineRule`/`defineScorer` factory with `CONSTRAINTS`. `scoringEngine.js`
> is a thin adapter that consumes them. See the [generation spec](../../specs/generation.md).

> Understudy semantics (`../schema/understudyRoles.js` for the `X-understudy` slot
> suffix; `../rules/understudyPolicy.js` for `UNDERSTUDY_MIN_SESSIONS`,
> `canFillSlotRole` vs `isRoleCapable`) — and the full
> rationale for the cap/promotion/seeding decisions live in the
> [understudy spec](../../specs/understudy.md) (and
> [generation spec](../../specs/generation.md)), which are the **binding spec**.

## Algorithm Flow

A single seeded pass (reproducible / deterministic):

1. **Initialize Tracking** - Load existing assignments into tracker
2. **Phase 0 — Understudy seeding** (`understudySeeding.js`): pre-fill understudy
   slots so trainees shadow early. Base-role-centric with lookahead — at each
   shadowing opportunity it picks the still-needed trainee who can be *promoted
   soonest* afterwards (`EligibilityChecker.canBePromotedTo`).
3. **Phase 0.5 — Promotion planning** (`promotionPlanning.js`): before greedy can
   spend a trainee's limited monthly budget, **backtrack** over all unlocked
   trainees to promote as many as possible into later real base-role slots
   (maximise the count), honouring hard constraints. Each tentative promotion is
   recorded/reverted in the tracker during the search so the caps stay accurate.
   Committed promotions are pinned so local search won't undo them.
4. **Phase 1 — Greedy construction** (initial solution):
   - Sort events chronologically
   - Within each event, process **understudy slots before real slots**
   - For each unassigned slot: find eligible members (hard constraints),
     score them (soft preferences, with a seeded tie-break shuffle), assign the
     best via the reversible move layer
5. **Phase 2 — Local search**: hill-climb by applying the single best *improving*
   move (member↔member swap, or filling an empty slot) until no improving move
   exists (or a safety iteration cap is hit). Every candidate is validated
   against hard constraints and applied reversibly. **Locked (pre-assigned,
   non-generated) slots and pinned promotions are excluded from swaps.** **By
   default (`optimizeExisting: false`) slots that were already filled when the
   run started are locked too** — tagged `_preExisting` up front so
   `RosterState.isLocked` protects them — so generation is *additive* (only fills
   empty slots; it will not reshuffle prior, still-uncommitted assignments).
   Pass `optimizeExisting: true` to re-open the whole roster to optimization. The
   objective is the whole-roster `scoreRoster`: fairness, spread, day/role
   preference violations, **consecutive-weekend avoidance** (gated by
   `AVOID_CONSECUTIVE_WEEKS`), and empty slots — every soft goal that biases
   Phase 1's greedy scoring must also appear here or local search can undo it.

Every decision is recorded by a verbose logger and returned as
`result.log` (text lines) and `result.logEntries` (structured) for debugging.

## Components

### AssignmentTracker
Maintains state during generation:
- Total assignments per member
- Assignments by month, week, day
- Assignment dates for temporal analysis
- Fairness metrics (standard deviation)
- Spread metrics (temporal distribution)
- `recordAssignment` / `removeAssignment` — exact inverses, enabling reversible moves

### RosterState
Reversible move layer pairing the events (source of truth) with the tracker
(derived counters), keeping them in lock-step:
- `applyMove` / `revertMove` — set/clear a slot's occupant; revert restores exactly
- `applySwap` / `revertSwap` — exchange two slots' occupants
- `allSlots`, `getOccupant` — enumeration/inspection for the search loop

### localSearch
Hill-climbing optimizer over `RosterState`. Enumerates candidate swaps and
fill-empty moves, validates each via the `EligibilityChecker`, and applies the
best positive-delta move each iteration. Objective supplied by the caller
(`scoreRoster`, which reuses `SCORING_WEIGHTS`). Stops at a local optimum.

### EligibilityChecker
Validates hard constraints (must satisfy):
- `ENFORCE_MEMBER_ROLES` - Role compatibility
- `ENFORCE_MEMBER_AVAILABILITY` - Unavailable dates
- `ONLY_ONCE_PER_EVENT` - No duplicate assignments per event
- `ONLY_ONCE_PER_WEEK` - Max one assignment per week (Monday-Sunday)
- `MAX_ASSIGNMENTS_PER_MONTH` - Monthly assignment limit
- `ENFORCE_UNDERSTUDY_BEFORE_ROLE` - Understudy gate (bidirectional):
  - can't perform a real role before completing `UNDERSTUDY_MIN_SESSIONS`
    understudy sessions for it (strictly earlier dates), and
  - can't take another understudy slot once the cap (`= 1`) is reached
    (hard-block, so trainees get promoted rather than shadow forever).

Also exposes `canBePromotedTo(memberId, role, event)` — a lookahead probe
(capability + availability + not-already-assigned; ignores the understudy gate)
used by Phase 0 seeding to rank promotable trainees.

> **Cross-team seam (multi-tenant Phase 2 — active).** The constructor accepts an
> optional `{ externalAssignments }` — a read-only snapshot of a member's
> assignments in *other* teams' rosters (`{ memberId: [dateOrDatetime, ...] }`).
> It is the **single** cross-team primitive: any load/cap figure is *derived*
> from it by the same rollup the tracker applies to local assignments (no
> separate, drift-prone "load" input). It defaults to empty, so single-team
> behaviour is byte-for-byte unchanged. When `ENFORCE_CROSS_TEAM_CAPS` /
> `ENFORCE_CROSS_TEAM_CLASH` are enabled it is folded through the `ctx` counting
> methods (`weeklyCount`/`monthlyCount`/`overlappingEvents`) so the constraint
> descriptors are untouched. See the
> [multi-tenant spec](../../specs/multi-tenant.md).

### ScoringEngine
Scores based on soft preferences (optimize for). Weights live in a single
`SCORING_WEIGHTS` constant (defined in `../../rules/scorers.js`, re-exported from
`scoringEngine.js`) and are reused by
the roster-quality evaluation so the two never drift apart:

| Factor | Weight | Description |
|--------|--------|-------------|
| **Fairness** | 300 | Prefer members with fewer total assignments |
| **Consecutive Weekends** | 200 | Avoid back-to-back weekends |
| **Day Preference** | 120 | Match member's preferred days |
| **Role Preference** | 120 | Match member's preferred roles |
| **Role Diversity** | 60 | Encourage variety of roles per member |
| **Spread** | 60 | Prefer longer gaps since last assignment |
| **Day Balance** | 60 | Balance assignments across different days for member |

> **Promotions are not a scorer.** Promoting understudies into their real role
> is handled entirely by the Phase 0.5 promotion planner (a hard, up-front
> reservation), not by scoring. A scorer can't help once a trainee is blocked by
> the monthly cap, so relying on one was confusing and redundant — it was
> removed.
>
> **Availability is not a scorer either.** It was removed — availability is a
> *hard constraint* (`ENFORCE_MEMBER_AVAILABILITY`), not a workload objective,
> and it never survived local search. Do not re-introduce either as a scorer.
> See the [generation spec](../../specs/generation.md).

## Usage

### Generate Roster

```javascript
import { generateRoster } from './generation'

const result = generateRoster(
  events,              // Events with roster assignments
  members,             // Available members
  memberConstraints,   // Member unavailability
  memberPreferences,   // Member day preferences
  rosterConstraints,   // Roster-level constraints
  rosterPreferences,   // Roster-level preferences
  rosterPeriod        // Start/end dates
)

// Result contains:
// - events: Updated events with new assignments
// - stats: Generation statistics
// - fairnessMetrics: Distribution analysis
```

## Configuration

### Scoring Weights

Adjust the exported `SCORING_WEIGHTS` in `../../rules/scorers.js`:

```javascript
export const SCORING_WEIGHTS = {
  fairness: 300,
  consecutiveWeekends: 200,
  dayPreference: 120,
  rolePreference: 120,
  roleDiversity: 60,
  spread: 60,
  dayBalance: 60,
}
```

Higher weight = higher priority in scoring.

### Constraints

Configure in builder config YAML:

```yaml
roster_constraints:
  ENFORCE_MEMBER_ROLES: true
  ENFORCE_MEMBER_AVAILABILITY: true
  ONLY_ONCE_PER_EVENT: true
  ONLY_ONCE_PER_WEEK: true
  MAX_ASSIGNMENTS_PER_MONTH: 2

roster_preferences:
  AVOID_CONSECUTIVE_WEEKS: true
  BALANCED_DAY_DISTRIBUTION: true
  SPREAD_ASSIGNMENTS: true
```

## Statistics

Generation provides detailed metrics:

```javascript
result.stats = {
  totalRoles: 24,
  assignedRoles: 22,
  generatedAssignments: 15,
  unassignableRoles: [
    {
      event: "Sunday Service",
      date: "2026-02-15",
      role: "vm",
      reason: "No eligible members available"
    }
  ]
}

result.fairnessMetrics = {
  assignmentStdDev: 0.82,        // Lower = fairer
  spreadStdDev: 3.1,             // Lower = more even spread
  assignmentsByMember: { ... }   // Detailed breakdown
}
```

## Testing

Run comprehensive test suite:

```bash
npm test -- rosterGenerator
```

Tests cover:
- Basic generation and statistics
- All hard constraints
- Fairness distribution
- Preview mode
- Member preferences
- Edge cases

## Extension Points

The modular design allows easy extensions:

1. **New Constraints** - Add to `../../evaluation/eligibilityChecker.js`
2. **New Preferences** - Append one entry to the `SCORERS` list in `../../rules/scorers.js`
   (a `defineScorer({ key, enabled, score })` descriptor); it is automatically used by both
   per-candidate scoring and roster-quality evaluation
3. **New Move Types** - Add to `localSearch.js` using the reversible primitives
   in `../../state/rosterState.js` (e.g. 3-way rotations, chain moves)
4. **Advanced Search** - Swap hill-climbing for simulated annealing by changing
   the acceptance rule in `optimizeRoster` (state is already reversible)
5. **Custom Metrics** - Extend `../../state/assignmentTracker.js`

## Performance

- **Greedy construction**: O(E × R × M) where E=events, R=roles, M=members
- **Local search**: each iteration scans O(slots²) swap candidates; runs until a
  local optimum (bounded by `maxIterations`)
- **Space Complexity**: O(M + E)

## Future Enhancements

- Simulated annealing / tabu search for escaping local optima
- User-facing swap suggestions (reuse `RosterState` + `EligibilityChecker`)
- Multi-objective optimization
- Configurable weight tuning UI

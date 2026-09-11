# Understudy & promotion feature (binding spec)

The system supports **understudies**: members training to perform a role, who must shadow it before performing it for real. This is the most intricate part of the generator; see also [generation.md](generation.md) for the surrounding pipeline and [`../src/generation/README.md`](../src/generation/README.md) for the scoring internals.

**Model — split by kind across two layers** (overhaul step 5; see
[architecture-overhaul.plan.md](architecture-overhaul.plan.md)):
- **Vocabulary** ([`src/schema/understudyRoles.js`](../src/schema/understudyRoles.js)) — the
  *definitional* half: role naming and member-role shape, with zero dependencies.
- **Policy** ([`src/rules/understudyPolicy.js`](../src/rules/understudyPolicy.js)) — the
  *judgement* half: the promotion gate and its threshold, importing the vocabulary
  from Schema (the correct Rules → Schema direction).

The split follows the same *definitional-vs-policy* test as `isMemberIncluded`:
"is this an understudy slot / what is its base role?" is a fact (Schema);
"may this member fill it / are they promoted yet / how many sessions are
required?" is policy (Rules).

- A member has `{ roles, understudyFor }`. `understudyFor: ["multi-vm"]` means "training to perform `multi-vm`".
- An understudy **slot** uses the suffix convention: `multi-vm-understudy` (`understudySlotRole(base)` / `baseRoleOf(slot)` / `isUnderstudyRole(slot)` — all **vocabulary**, in Schema).
- Two distinct role-compatibility rules exist and must not be conflated (both **policy**, in Rules):
  - **`canFillSlotRole`** (UI): who may fill a slot from scratch — for an understudy slot, trainees only; for a real role, full performers only.
  - **`isRoleCapable`** (generator): a trainee counts as capable of the base role for lookahead/promotion purposes.

**Manual assignment dropdown includes promoted understudies.** The slot picker (`getAvailableMembersForEvent`) lists, for a real role `X`: full performers, **plus** any trainee who has already **completed an understudy session for `X` on an earlier date in the roster** (`isPromotedForRole` → `countUnderstudySessionsBefore`). Those trainees are tagged "understudy" in the list. This mirrors the generator's promotions so a human can reproduce/adjust them; trainees who haven't understudied yet stay out, honouring understudy-before-role. The same promotion-aware check gates drag-and-drop (`canOccupy` in `App.jsx`). No data-structure change was needed — `roles` + `understudyFor` already model this; the UI simply consults the event history.

**Hard constraints** — the understudy gate is one descriptor in the shared `CONSTRAINTS` registry (`understudy-before-role`, a `load-cadence` rule gated by `ENFORCE_UNDERSTUDY_BEFORE_ROLE`), **not** a rule re-implemented per consumer. The registry is the single authority; the generator, the assignment validator, and the manual-swap policy all consume that one descriptor — see [generation.md](generation.md#hard-constraints-one-authority-many-consumers) for the ownership/architecture. This spec owns only the understudy *domain rules* the descriptor encodes:
- **Understudy-before-role**: a member may not be assigned a real role until they have completed `UNDERSTUDY_MIN_SESSIONS` understudy sessions for it, on **strictly earlier** dates (`understudy-before-role` violation code).
- **Understudy cap = 1** (`UNDERSTUDY_MIN_SESSIONS = 1`): once a trainee has completed their required understudy session, they are **hard-blocked** from further understudy slots for that role (`understudy-complete` code). Rationale: repeatedly shadowing without ever being promoted (the "Ozborn understudied twice, never performed" bug) is wasteful — one session is enough to become eligible.

This is the **two-sided gate** described in generation.md: the first half (trainee entering the real role too early) fires in both the generator's predictive check and the validator's diagnostic pass; the second half (a qualified trainee re-entering an understudy slot) is a generator-only placement guard — there is no "over-understudied" defect to diagnose on a finished roster, so the validator ignores the `understudy-complete` code. Because both consumers read the same descriptor, the "understudy rostered for the actual role before promotion" error surfaces in the UI regardless of how the assignment was made (generated, or filled/edited/dragged by hand). Full performers and promoted trainees are never flagged.

**Promotion** — handled by the Phase 0.5 promotion planner (below), **not** by scoring:
- Once trainees are unlocked (have done their understudy session but not yet performed the real role), the planner reserves later real-role slots for as many of them as possible, up front.
- There is deliberately **no promotion scorer**. A soft score can't help once a trainee is hard-blocked by the monthly cap (see the Phase 0.5 rationale), so the earlier `promoteUnderstudy` scorer was **removed** to avoid confusion — promotion is a hard, planned reservation, not a preference.

**Phase 0 — promotion-aware seeding** (`understudySeeding.js`):
- Before greedy construction, understudy slots are seeded so trainees get their required shadowing early. Seeding is **base-role-centric with lookahead**, not member-order greedy.
- For each base role, it tracks trainees still needing a session, walks events chronologically, and at each shadowing opportunity picks the trainee who can be **promoted soonest** afterwards — ranked by `EligibilityChecker.canBePromotedTo(memberId, baseRole, laterEvent)` (capability + availability + not-already-assigned, deliberately *ignoring* the understudy gate since seeding is what satisfies it).
- Rationale: naive member-order seeding parked a trainee (e.g. denise) who was unavailable at the next real event, wasting the promotion chain. Promotion-aware seeding matches the hand-tuned reference (2 promotions instead of 1).

**Phase 0.5 — promotion planning (backtracking)** (`promotionPlanning.js`):
- Being *eligible* to perform the real role isn't enough to actually get promoted. Greedy fills events chronologically and `MAX_ASSIGNMENTS_PER_MONTH` (default **2**) is a hard cap, so a trainee's monthly budget can be spent on ordinary slots **before** their real-role opportunity arrives — leaving them capped out and unable to be promoted. The `promoteUnderstudy` scorer can't help once the trainee is hard-blocked.
- This dedicated phase runs right after seeding. Across the whole population of unlocked trainees it **backtracks** to find the assignment of trainees→later real base-role slots that **maximises the number of promoted trainees**, honouring all hard constraints (it re-uses `EligibilityChecker.isEligible` and records/reverts each tentative promotion in the tracker so monthly/weekly counters stay accurate during the search — a static bipartite matching won't do because assignments interact through the caps).
- Chosen promotions are committed as generated slots and **pinned** (`slot._pinnedPromotion`) so Phase 2 local search won't swap them away. The pin is transient and stripped before results are returned.
- Rationale: the real "promotions not maximised" bug — jia-lin understudied Sep 26 and *was* eligible for the Oct 31 real multi-vm, but greedy had already spent her 2 October slots on ordinary roles, so the monthly cap blocked the promotion. Securing promotions up front achieves 2 promotions (matching the reference) instead of 1.

**Phase 1 — understudy slots first**: within each event, understudy slots are scored/filled **before** real-role slots (`orderedSlots` sorts understudy roles ahead), so trainees are scheduled before the roles that depend on them.

**Members view**: the role filter includes understudies — filtering by `multi-vm` shows both performers and `multi-vm` trainees (`matchesRole` checks `roles` *and* `understudyFor`).

## Scope: what is team-level vs. roster-level

"Understudy" spans three distinct facts that live at **different scopes**. Do not
conflate them — the emphasis matters, because the interesting behaviour is
roster-specific while only the bare declaration is team config:

1. **The understudy *declaration/capability*** — *that* a person is training
   toward role `X` (`understudyFor: ["X"]`). This is the same axis as `roles`
   (schedulable capability), so in the target [multi-tenant](multi-tenant.md)
   model it lives on `team_members` (per team, admin-managed), right next to
   `roles`. A person training on Team A is not automatically training on Team B.
   This is the **only** team-scoped slice.
2. **Understudy *progress* (sessions)** — *how many* shadowing sessions a trainee
   has completed for `X`. This is **derived per roster** from that roster's event
   history (`countUnderstudySessionsBefore` over `events`), never stored. It does
   **not** cross teams: progress is roster history, scoped like the roster it is
   computed from.
3. **Seeding, promotion planning, and the promotion outcome** — Phases 0/0.5
   above, plus the `UNDERSTUDY_MIN_SESSIONS` gate and who ends up promoted. This
   is **entirely a roster-specific generation concern**: it decides who shadows
   and who is promoted *within one roster's pass*. Nothing here is stored on the
   member or team.

**Promotion is derived, not stored (Design Decision).** There is deliberately no
`promoted`/`promoted_at` status on `team_members`. "Promoted" is expressed two
ways, both already truthful without a new field: within a roster it is the
generation outcome (a trainee placed in a real slot after their session — see
Phase 0.5); across a person's team career it is simply an **admin edit to their
capability** (drop the `understudyFor` entry, add the real role to `roles`). A
stored status+date would be a *second* source of truth that must be kept in sync
with the derived progress in (2) — exactly the `canFillSlotRole` vs
`isRoleCapable` conflation this spec warns against — so it was rejected. If a
product need for a promotion *timeline* appears, it re-enters cleanly as an
**append-only promotions log** (an event history, not a mutable status), which
cannot drift from the derived truth.

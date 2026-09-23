/**
 * Member-list lookups shared across views.
 *
 * `memberNameById` is the one *name-only* accessor: given the roster's member
 * list and a member id, it returns the member's display name, falling back to
 * the raw id when a member has no `name`, and passing `null`/absent ids through
 * as `null` (an empty slot has no name). This contract was re-implemented
 * inline in three places (App, EventsView, the roster-stats charts) with
 * near-identical `name || id` logic; consolidating it here keeps the fallback
 * rule in one spot.
 *
 * This is deliberately *not* the full presentational label ("Name - telegram" /
 * "Unassigned") — that is `getMemberLabel` in EventsView and the `memberLabel`
 * vocabulary used by the export projection and RosterSlotPill.
 */
export const memberNameById = (members, id) =>
  id ? (members.find((m) => m.id === id)?.name || id) : null

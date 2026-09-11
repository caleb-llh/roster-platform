/**
 * Bulk-clear helper for the Events multi-select feature — a Session-layer domain
 * helper (it operates on the roster/slot shape and produces one draft edit).
 *
 * "Clear" means: empty the assigned member from a roster slot but KEEP the role
 * requirement (mirrors the single-slot `assign(..., memberId:null)` path). It is
 * deliberately the non-destructive action — removing whole role slots is a
 * separate, more destructive operation (`removeSlot`).
 *
 * Slot keys are the shared `slotKey` (`"<date>#<roleIndex>"`, from `lib/`) the
 * Events view already uses for its diff overlay and selection, so the caller can
 * pass the exact set the user ticked. Applying the whole set in one pass means
 * the change lands as a single draft entry and a single undo step.
 */
import { slotKey } from '../lib/slotKey'

/**
 * Return `{ nextEvents, count }` where every slot named in `keys` has its
 * `member_id` cleared (and the generated tag dropped, since a manual clear
 * un-generates the slot). Role slots are preserved. Unknown keys and
 * already-empty slots are ignored (they don't inflate `count`). `events` is not
 * mutated.
 *
 * @param {Array} events   The current events array.
 * @param {Iterable<string>} keys  Slot keys (`date#roleIndex`) to clear.
 */
export function buildBulkClear(events, keys) {
  const keySet = keys instanceof Set ? keys : new Set(keys)
  if (keySet.size === 0) return { nextEvents: events, count: 0 }

  let count = 0
  const nextEvents = (events || []).map(event => {
    if (!event.roster?.length) return event

    let changed = false
    const nextRoster = event.roster.map((slot, idx) => {
      if (!keySet.has(slotKey(event.date, idx))) return slot
      if (!slot.member_id) return slot // nothing to clear
      changed = true
      count++
      const { isGenerated, ...rest } = slot
      return { ...rest, member_id: null }
    })

    return changed ? { ...event, roster: nextRoster } : event
  })

  return { nextEvents, count }
}

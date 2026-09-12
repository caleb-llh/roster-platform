/**
 * Compute the diff between a committed events array (the "binding") and an
 * uncommitted draft. Used to visualise uncommitted changes inline in the UI and
 * to answer "who is affected?" before the draft is saved.
 *
 * The comparison is positional per event/slot, matching the data structure
 * (`event.roster` is a positional array — see specs/data-layer.md). A slot
 * is identified by `(event.date, roleIndex)`. We report, per slot, one of:
 *   - 'added'    : slot exists in draft but not in committed (role requirement added)
 *   - 'removed'  : slot exists in committed but not in draft (role requirement removed)
 *   - 'changed'  : same slot, different member_id (assignment changed)
 *   - 'unchanged': same slot, same member_id
 *
 * `slotDiffByKey` keys are `"${date}#${roleIndex}"` so a view rendering a slot
 * can look up its status in O(1). The key format is the shared `slotKey`
 * primitive (`lib/slotKey`), the same one EventsView and the bulk-clear command
 * use, so the three never drift.
 */
import { slotKey } from '../lib/slotKey'

/**
 * @param {Array} committed  events array as last saved (the binding)
 * @param {Array} draft      uncommitted working events array
 * @returns {{
 *   hasChanges: boolean,
 *   slotDiffByKey: Record<string, 'added'|'removed'|'changed'>,
 *   changedEventDates: Set<string>,
 *   slotChanges: Array<{ date, name, roleIndex, role, status, before: string|null, after: string|null }>,
 *   affectedMemberIds: { added: string[], removed: string[] },
 * }}
 */
export function computeRosterDiff(committed, draft) {
  const slotDiffByKey = {}
  const slotChanges = []
  const changedEventDates = new Set()
  // Net membership change across the whole roster (a member added to one slot
  // and removed from another nets out — they are still on the roster).
  const beforeCounts = new Map()
  const afterCounts = new Map()

  const committedEvents = Array.isArray(committed) ? committed : []
  const draftEvents = Array.isArray(draft) ? draft : []

  const committedByDate = new Map(committedEvents.map(e => [e.date, e]))
  const draftByDate = new Map(draftEvents.map(e => [e.date, e]))

  const bump = (map, id) => { if (id) map.set(id, (map.get(id) || 0) + 1) }

  // Tally committed occupants.
  committedEvents.forEach(e => (e.roster || []).forEach(s => bump(beforeCounts, s.member_id)))
  draftEvents.forEach(e => (e.roster || []).forEach(s => bump(afterCounts, s.member_id)))

  // Walk the union of event dates.
  const allDates = new Set([...committedByDate.keys(), ...draftByDate.keys()])
  for (const date of allDates) {
    const cEvent = committedByDate.get(date)
    const dEvent = draftByDate.get(date)
    const cRoster = cEvent?.roster || []
    const dRoster = dEvent?.roster || []
    const name = dEvent?.name ?? cEvent?.name ?? ''
    const maxLen = Math.max(cRoster.length, dRoster.length)

    for (let i = 0; i < maxLen; i++) {
      const cSlot = cRoster[i]
      const dSlot = dRoster[i]

      if (cSlot && !dSlot) {
        slotDiffByKey[slotKey(date, i)] = 'removed'
        slotChanges.push({ date, name, roleIndex: i, role: cSlot.role, status: 'removed', before: cSlot.member_id || null, after: null })
        changedEventDates.add(date)
        continue
      }
      if (!cSlot && dSlot) {
        slotDiffByKey[slotKey(date, i)] = 'added'
        slotChanges.push({ date, name, roleIndex: i, role: dSlot.role, status: 'added', before: null, after: dSlot.member_id || null })
        changedEventDates.add(date)
        continue
      }
      if (cSlot && dSlot) {
        const before = cSlot.member_id || null
        const after = dSlot.member_id || null
        if (before !== after || cSlot.role !== dSlot.role) {
          slotDiffByKey[slotKey(date, i)] = 'changed'
          slotChanges.push({ date, name, roleIndex: i, role: dSlot.role, status: 'changed', before, after })
          changedEventDates.add(date)
        }
      }
    }
  }

  // A member is "added to the roster" if they now appear where they didn't
  // before (net positive), "removed" if they no longer appear at all.
  const addedMembers = []
  const removedMembers = []
  const allMemberIds = new Set([...beforeCounts.keys(), ...afterCounts.keys()])
  for (const id of allMemberIds) {
    const before = beforeCounts.get(id) || 0
    const after = afterCounts.get(id) || 0
    if (before === 0 && after > 0) addedMembers.push(id)
    else if (before > 0 && after === 0) removedMembers.push(id)
  }

  return {
    hasChanges: slotChanges.length > 0,
    slotDiffByKey,
    changedEventDates,
    slotChanges,
    affectedMemberIds: { added: addedMembers, removed: removedMembers },
  }
}

/** Look up a single slot's diff status. */
export function slotDiffStatus(diff, date, roleIndex) {
  return diff?.slotDiffByKey?.[slotKey(date, roleIndex)]
}

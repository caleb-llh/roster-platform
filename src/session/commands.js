/**
 * Session command surface (pure).
 *
 * Each command is a pure function `(state, args) => Result`, where `state` is
 * the derived roster state (from `toState`) plus `externalAssignments`, and
 * `Result` is:
 *
 *   {
 *     ok: boolean,                 // false only for a HARD reject (swap)
 *     reason: string | null,       // populated on a hard reject
 *     nextEvents: Event[] | null,  // the events to stage (null on reject / no-op)
 *     verdict: { warnings: string[] },  // soft gate — surfaced, does NOT block
 *     logEntry: LogEntry | LogEntry[] | null,
 *   }
 *
 * These commands own ONLY the pure mutation (`nextEvents`) and the rule
 * **verdict**. They are the single place a domain mutation is expressed, so a UI
 * click and (eventually) an inbound bot command are peers through one surface.
 *
 * Gate policy (see specs/session.md and the overhaul plan, step 11):
 *  - Actions that had no gate before (assign / addSlot / removeSlot /
 *    clearGenerated / bulkClear) use a **warn-still-apply** gate: they always
 *    produce `nextEvents`, and attach any rule violations on the AFFECTED events
 *    as `verdict.warnings`. This preserves the intentional manual-override
 *    freedom while making the verdict visible.
 *  - `swap` keeps its pre-existing **hard reject** (`explainSwap`): an infeasible
 *    swap is blocked (`ok: false`, `reason`), exactly as before.
 *
 * View concerns (confirmation-dialog staging, toast wording, log-message prose
 * that isn't intrinsic to the action) stay in the UI, not here. The `logEntry`
 * returned here is the action's own audit line; richer prose can be layered by
 * the caller.
 */

import { validateEventAssignments } from '../evaluation/assignmentValidator'
import { explainSwap } from '../evaluation/swapPolicy'
import { buildBulkClear } from './bulkClear'

const nameOfIn = (members) => (id) =>
  members.find((m) => m.id === id)?.name || id || '—'

/**
 * Run the shared validator over `nextEvents` and collect the errors+warnings
 * that pertain to the given affected dates, flattened into one `warnings` list.
 * This reuses the one validation authority rather than re-deriving rules, so a
 * command's soft verdict always matches the panel's validation. Only the
 * affected events are surfaced (a manual edit shouldn't dump the whole roster's
 * pre-existing issues into one toast).
 */
const verdictFor = (nextEvents, state, affectedDates) => {
  const results = validateEventAssignments(
    nextEvents,
    state.members,
    state.memberConstraints,
    state.memberPreferences,
    state.rosterConstraints,
    state.rosterPreferences,
    state.rosterPeriod,
    state.externalAssignments || {}
  )
  const dates = new Set(affectedDates)
  const warnings = []
  for (const [date, r] of Object.entries(results)) {
    if (!dates.has(date)) continue
    warnings.push(...(r.errors || []), ...(r.warnings || []))
  }
  return { warnings: [...new Set(warnings)] }
}

const noop = { ok: true, reason: null, nextEvents: null, verdict: { warnings: [] }, logEntry: null }

/**
 * Assign / replace / remove one slot occupant. `memberId === null` removes the
 * current occupant; otherwise inserts or replaces. Warn-still-apply.
 */
export const assign = (state, { eventDate, roleIndex, memberId }) => {
  const { events, members } = state
  const nameOf = nameOfIn(members)
  let logEntry = null

  const nextEvents = events.map((event) => {
    if (event.date !== eventDate || !event.roster?.[roleIndex]) return event
    const nextRoster = event.roster.map((slot, idx) => {
      if (idx !== roleIndex) return slot
      const previous = slot.member_id || null
      const where = `${event.date} ${event.name} / ${slot.role}`
      if (!memberId) {
        logEntry = { level: 'info', category: 'delete', group: 'manual', message: `Removed ${nameOf(previous)} from ${where}` }
        const { isGenerated, ...rest } = slot
        return { ...rest, member_id: null }
      }
      logEntry = previous
        ? { level: 'info', category: 'replace', group: 'manual', message: `Replaced ${nameOf(previous)} with ${nameOf(memberId)} on ${where}` }
        : { level: 'info', category: 'insert', group: 'manual', message: `Assigned ${nameOf(memberId)} to ${where}` }
      return { ...slot, member_id: memberId, isGenerated: false }
    })
    return { ...event, roster: nextRoster }
  })

  return {
    ok: true,
    reason: null,
    nextEvents,
    verdict: verdictFor(nextEvents, state, [eventDate]),
    logEntry,
  }
}

/**
 * Add a new (unassigned) role requirement to an event. Non-destructive; ignores
 * roles already present. Returns a no-op result when nothing changes.
 */
export const addSlot = (state, { eventDate, role }) => {
  if (!role) return noop
  const { events } = state
  let added = false
  const nextEvents = events.map((event) => {
    if (event.date !== eventDate) return event
    const roster = event.roster || []
    if (roster.some((slot) => slot.role === role)) return event
    added = true
    return { ...event, roster: [...roster, { role, member_id: null }] }
  })
  if (!added) return noop
  const event = events.find((e) => e.date === eventDate)
  return {
    ok: true,
    reason: null,
    nextEvents,
    verdict: verdictFor(nextEvents, state, [eventDate]),
    logEntry: { level: 'info', category: 'insert', group: 'manual', message: `Added ${role} role to ${eventDate}${event ? ` ${event.name}` : ''}` },
  }
}

/**
 * Remove an entire role slot from an event (destructive). Warn-still-apply; the
 * CALLER owns the confirmation dialog — this just computes the result.
 */
export const removeSlot = (state, { eventDate, roleIndex }) => {
  const { events, members } = state
  const event = events.find((e) => e.date === eventDate)
  const slot = event?.roster?.[roleIndex]
  if (!slot) return noop
  const nameOf = nameOfIn(members)
  const nextEvents = events.map((e) => {
    if (e.date !== eventDate) return e
    return { ...e, roster: e.roster.filter((_, idx) => idx !== roleIndex) }
  })
  const occupant = slot.member_id ? ` (currently ${nameOf(slot.member_id)})` : ''
  return {
    ok: true,
    reason: null,
    nextEvents,
    verdict: verdictFor(nextEvents, state, [eventDate]),
    logEntry: { level: 'info', category: 'delete', group: 'manual', message: `Removed the ${slot.role} role from ${event.date} ${event.name}${occupant}` },
  }
}

/**
 * Swap the occupants of two roster slots (or move one into an empty slot). This
 * is the ONE command with a HARD reject: an infeasible swap is blocked via
 * `explainSwap` (`ok: false`, `reason`), unchanged from prior behaviour. On
 * success the caller may still stage it for confirmation (a swap is loss-ful).
 */
export const swap = (state, { source, target }) => {
  if (source.eventDate === target.eventDate && source.roleIndex === target.roleIndex) return noop
  const { events, members, memberConstraints, externalAssignments } = state
  const nameOf = nameOfIn(members)

  const eventA = events.find((e) => e.date === source.eventDate)
  const eventB = events.find((e) => e.date === target.eventDate)
  if (!eventA || !eventB) return noop
  const slotA = eventA.roster?.[source.roleIndex]
  const slotB = eventB.roster?.[target.roleIndex]
  if (!slotA || !slotB) return noop
  const memberA = slotA.member_id || null
  const memberB = slotB.member_id || null
  if (!memberA && !memberB) return noop

  const { ok, reason } = explainSwap({
    memberA, memberB, eventA, eventB,
    sourceIndex: source.roleIndex, targetIndex: target.roleIndex,
    slotA, slotB, members, memberConstraints, allEvents: events,
    externalAssignments: externalAssignments || {},
  })
  if (!ok) return { ok: false, reason: reason || 'Invalid swap.', nextEvents: null, verdict: { warnings: [] }, logEntry: null }

  const nextEvents = events.map((event) => {
    if (event !== eventA && event !== eventB) return event
    const nextRoster = event.roster.map((slot, idx) => {
      const isSlotA = event === eventA && idx === source.roleIndex
      const isSlotB = event === eventB && idx === target.roleIndex
      if (isSlotA) {
        if (!memberB) { const { isGenerated, ...rest } = slot; return { ...rest, member_id: null } }
        return { ...slot, member_id: memberB, isGenerated: false }
      }
      if (isSlotB) {
        if (!memberA) { const { isGenerated, ...rest } = slot; return { ...rest, member_id: null } }
        return { ...slot, member_id: memberA, isGenerated: false }
      }
      return slot
    })
    return { ...event, roster: nextRoster }
  })

  const message = memberA && memberB
    ? `Swapped ${nameOf(memberA)} (${eventA.date}/${slotA.role}) ↔ ${nameOf(memberB)} (${eventB.date}/${slotB.role})`
    : `Moved ${nameOf(memberA || memberB)} to ${(memberA ? eventB : eventA).date}/${(memberA ? slotB : slotA).role}`

  return {
    ok: true,
    reason: null,
    nextEvents,
    verdict: { warnings: [] },
    logEntry: { level: 'info', category: 'swap', group: 'manual', message },
    // View helpers for the confirmation dialog (the swap is loss-ful, so the UI
    // stages it before applying). Not part of the command result contract other
    // consumers depend on; the UI reads these to render a before/after card.
    preview: {
      message,
      isMove: !(memberA && memberB),
      slotA: { date: eventA.date, role: slotA.role, before: nameOf(memberA), after: nameOf(memberB) },
      slotB: { date: eventB.date, role: slotB.role, before: nameOf(memberB), after: nameOf(memberA) },
    },
  }
}

/**
 * Clear all auto-generated assignments (slots tagged `isGenerated`), leaving the
 * role requirements in place. Manual assignments untouched. Warn-still-apply.
 */
export const clearGenerated = (state) => {
  const { events } = state
  let count = 0
  const affected = []
  const nextEvents = events.map((event) => {
    if (!event.roster?.some((s) => s.isGenerated)) return event
    affected.push(event.date)
    const nextRoster = event.roster.map((slot) => {
      if (!slot.isGenerated) return slot
      count++
      const { isGenerated, ...rest } = slot
      return { ...rest, member_id: null }
    })
    return { ...event, roster: nextRoster }
  })
  if (count === 0) return noop
  return {
    ok: true,
    reason: null,
    nextEvents,
    verdict: verdictFor(nextEvents, state, affected),
    count,
    logEntry: { level: 'info', category: 'delete', group: 'manual', message: `Removed ${count} generated assignment${count > 1 ? 's' : ''}` },
  }
}

/**
 * Clear a batch of selected slots (empty the member, keep the role slot).
 * Reuses `buildBulkClear`. Warn-still-apply.
 */
export const bulkClear = (state, { selectedSlots }) => {
  const { events } = state
  const { nextEvents, count } = buildBulkClear(events, selectedSlots)
  if (count === 0) return noop
  // Affected dates = the event dates present among the selected keys.
  const affected = [...new Set([...selectedSlots].map((k) => String(k).split('#')[0]))]
  return {
    ok: true,
    reason: null,
    nextEvents,
    verdict: verdictFor(nextEvents, state, affected),
    count,
    logEntry: { level: 'info', category: 'delete', group: 'manual', message: `Cleared ${count} assignment${count > 1 ? 's' : ''}` },
  }
}

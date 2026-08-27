import { canFillSlotRole, isUnderstudyRole, isPromotedForRole } from './understudy'
import { getConstraintRule, CONSTRAINT_MODES, formatViolation } from './constraints'
import { eventsClash, externalEventsFor } from './constraintPrimitives'
import { isMemberIncluded } from '../schema/rosterSchema'

/**
 * Validate a proposed swap/move between two roster slots, returning both
 * whether it is allowed and — when rejected — *why*. A "swap" exchanges the
 * occupants of slotA (source) and slotB (target); either occupant may be null
 * (a move into/out of an empty slot).
 *
 * Rules enforced for each member landing in its new slot:
 *  - role compatibility (full performer, or a promoted trainee for a real role),
 *  - availability on the destination event's date,
 *  - once-per-event (no duplicate member within a single event),
 *  - no time clash (member not in another event whose span overlaps).
 *
 * This is the manual-swap CONSUMER of the hard-constraint registry: it enforces
 * only `feasibility` rules (a human may deliberately override load/cadence caps),
 * so it never checks week/month caps or the understudy gate. See the
 * "one authority, many consumers" decision in specs/generation.md.
 *
 * The once-per-event check must ignore the slot each member is LEAVING within
 * the event being checked. In a same-event swap both slots live in one roster
 * array, so memberA leaves `sourceIndex` and memberB leaves `targetIndex`;
 * ignoring the wrong index falsely reports a duplicate and blocks a legal
 * same-event, different-role swap. For the same reason the cross-event clash
 * check ignores the event the member is leaving (`fromEvent`): an overlap with
 * the slot they are vacating is not a real clash.
 *
 * @returns {{ ok: boolean, reason: string|null }} `ok` is the validity; `reason`
 *   is a human-readable, member-and-cause-specific sentence when `ok` is false
 *   (null when valid). Use `canSwapRosterSlots` for the boolean-only check.
 */
export const explainSwap = ({
  memberA, memberB, eventA, eventB, sourceIndex, targetIndex,
  slotA, slotB, members, memberConstraints, allEvents, externalAssignments = {},
}) => {
  const memberById = (id) => members.find(m => m.id === id)
  const nameOf = (id) => memberById(id)?.name || id || 'someone'
  const sameEvent = eventA === eventB
  const events = allEvents || [eventA, eventB]

  const noClash = getConstraintRule('no-clash')

  // Returns null when the member may occupy the slot, otherwise a reason string
  // naming the specific member, role, and cause so the toast can be actionable.
  // `fromEvent` is the event this member is leaving in the swap (null for a move
  // into an empty slot), excluded from the cross-event clash scan.
  const rejection = (memberId, event, slot, ignoreRoleIndex, fromEvent) => {
    if (!memberId) return null // clearing a slot is always valid
    const member = memberById(memberId)
    if (!isMemberIncluded(member)) {
      return `${nameOf(memberId)} is inactive and can't be assigned.`
    }

    const roleOk = canFillSlotRole(member, slot.role) ||
      (!isUnderstudyRole(slot.role) && isPromotedForRole(member, slot.role, events, event.date))
    if (!roleOk) return `${nameOf(memberId)} can't fill the ${slot.role} role.`

    const availability = getConstraintRule('availability')
    const unavailable = availability.check(
      { memberId, role: slot.role, event },
      { memberConstraints },
      CONSTRAINT_MODES.WOULD_PLACE
    )
    if (unavailable) return formatViolation(unavailable, nameOf)

    const dup = event.roster.some((r, i) => i !== ignoreRoleIndex && r.member_id === memberId)
    if (dup) return `${nameOf(memberId)} is already rostered on ${event.date}.`

    // Cross-event time clash (feasibility): member already in another event whose
    // span overlaps the destination — ignoring the event they are vacating.
    // Enforced always-on (like availability): being in two overlapping events at
    // once is physically impossible, not a toggleable cadence policy, and swap
    // isn't handed the rosterConstraints flags anyway. The member's assignments
    // on OTHER teams (externalAssignments — empty in single-team mode) fold into
    // the same scan, so a manual move can't double-book a person across teams.
    const clash = noClash.check(
      { memberId, role: slot.role, event },
      {
        overlappingEvents: (placement) => [
          ...events.filter(
            e => e !== placement.event && e !== fromEvent && eventsClash(e, placement.event)
          ),
          ...externalEventsFor(placement.memberId, externalAssignments).filter(
            e => eventsClash(e, placement.event)
          ),
        ],
      },
      CONSTRAINT_MODES.WOULD_PLACE
    )
    if (clash) {
      return clash.params.external
        ? `${nameOf(memberId)} is rostered on another team on an overlapping event (${clash.params.otherDate}).`
        : `${nameOf(memberId)} is already rostered on an overlapping event (${clash.params.otherDate}).`
    }

    return null
  }

  const reason =
    rejection(memberA, eventB, slotB, sameEvent ? sourceIndex : -1, eventA) ||
    rejection(memberB, eventA, slotA, sameEvent ? targetIndex : -1, eventB)

  return { ok: !reason, reason: reason || null }
}

/**
 * Boolean-only convenience wrapper over {@link explainSwap}.
 * @returns {boolean} true if the swap is valid
 */
export const canSwapRosterSlots = (args) => explainSwap(args).ok

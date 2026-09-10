/**
 * Reversible roster state for local-search optimization.
 *
 * Wraps the cloned `events` (the source of truth for who is assigned where) and
 * the AssignmentTracker (the derived counters used for scoring/eligibility), and
 * keeps them in lock-step. It exposes atomic, reversible operations so a search
 * loop can try a move, measure its effect, and cleanly undo it.
 *
 * A "slot" identifies one role in one event: { eventIndex, roleIndex }.
 * A "move" is a desired new occupant for a slot: { slot, memberId } where
 * memberId === null clears the slot.
 *
 * applyMove(move) returns an inverse move descriptor; passing that descriptor to
 * revertMove() restores the exact prior state (events + tracker).
 */

export class RosterState {
  /**
   * @param {Array} events  cloned events (will be mutated in place)
   * @param {AssignmentTracker} tracker  tracker already seeded from these events
   */
  constructor(events, tracker) {
    this.events = events
    this.tracker = tracker
  }

  /** The role assignment object for a slot. */
  getSlot({ eventIndex, roleIndex }) {
    return this.events[eventIndex]?.roster?.[roleIndex] ?? null
  }

  /** The member currently occupying a slot (or null). */
  getOccupant(slot) {
    return this.getSlot(slot)?.member_id ?? null
  }

  /**
   * A slot is "locked" if local search must never move or overwrite it:
   *  - a pre-assigned (manually authored) member — filled but NOT generated; or
   *  - a promotion pinned by the promotion-planning phase (`_pinnedPromotion`),
   *    which secured a trainee's real-role slot up front; letting search swap it
   *    away would waste the promotion the phase deliberately reserved; or
   *  - a slot that was already filled when THIS run started and `optimizeExisting`
   *    is off (`_preExisting`). This is the default "only fill empty slots"
   *    behaviour: prior assignments (including ones an earlier generation made)
   *    are treated as fixed, so a new run adds to the roster without reshuffling
   *    what is already there. See README → "Generation only fills empty slots".
   */
  isLocked(slot) {
    const roleAssignment = this.getSlot(slot)
    if (!roleAssignment?.member_id) return false
    if (roleAssignment._pinnedPromotion) return true
    if (roleAssignment._preExisting) return true
    return !roleAssignment.isGenerated
  }

  /** All slots across all events, in (event, role) order. */
  allSlots() {
    const slots = []
    this.events.forEach((event, eventIndex) => {
      event.roster?.forEach((_, roleIndex) => {
        slots.push({ eventIndex, roleIndex })
      })
    })
    return slots
  }

  /**
   * Set (or clear) the occupant of a slot and update the tracker accordingly.
   * Returns an inverse move that undoes this exact change.
   */
  applyMove({ slot, memberId }) {
    const event = this.events[slot.eventIndex]
    const roleAssignment = event.roster[slot.roleIndex]
    const previousMemberId = roleAssignment.member_id ?? null
    const previousGenerated = roleAssignment.isGenerated ?? false

    // Remove the previous occupant from the tracker.
    if (previousMemberId) {
      this.tracker.removeAssignment(
        previousMemberId, event.date, event.day_of_week, roleAssignment.role
      )
    }

    // Install the new occupant.
    if (memberId) {
      roleAssignment.member_id = memberId
      roleAssignment.isGenerated = true
      this.tracker.recordAssignment(
        memberId, event.date, event.day_of_week, roleAssignment.role
      )
    } else {
      roleAssignment.member_id = null
      delete roleAssignment.isGenerated
    }

    return {
      slot,
      memberId: previousMemberId,
      _restoreGenerated: previousGenerated,
    }
  }

  /**
   * Undo a move using the inverse descriptor returned by applyMove().
   */
  revertMove(inverse) {
    const { slot, memberId, _restoreGenerated } = inverse
    const applied = this.applyMove({ slot, memberId })
    // applyMove sets isGenerated=true for any non-null member; restore the
    // original flag so revert is a perfect inverse.
    if (memberId) {
      const roleAssignment = this.getSlot(slot)
      if (_restoreGenerated) roleAssignment.isGenerated = true
      else delete roleAssignment.isGenerated
    }
    return applied
  }

  /**
   * Swap the occupants of two slots (each may be empty). Returns an inverse
   * descriptor accepted by revertSwap().
   */
  applySwap(slotA, slotB) {
    const occA = this.getOccupant(slotA)
    const occB = this.getOccupant(slotB)
    const invA = this.applyMove({ slot: slotA, memberId: occB })
    const invB = this.applyMove({ slot: slotB, memberId: occA })
    return { invA, invB }
  }

  revertSwap({ invA, invB }) {
    // Revert in reverse order of application.
    this.revertMove(invB)
    this.revertMove(invA)
  }
}

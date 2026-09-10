import { describe, it, expect } from 'vitest'
import { RosterState } from './rosterState'
import { AssignmentTracker } from './assignmentTracker'

const members = [
  { id: 'alice', name: 'Alice', include: true },
  { id: 'bob', name: 'Bob', include: true },
  { id: 'carol', name: 'Carol', include: true },
]

function makeEvents() {
  return [
    {
      name: 'Service 1', date: '2026-02-01', day_of_week: 'Sunday',
      roster: [
        { role: 'vm', member_id: 'alice', isGenerated: true },
        { role: 'cam-1', member_id: null },
      ],
    },
    {
      name: 'Service 2', date: '2026-02-08', day_of_week: 'Sunday',
      roster: [
        { role: 'vm', member_id: 'bob', isGenerated: true },
      ],
    },
  ]
}

function snapshot(tracker) {
  return JSON.parse(JSON.stringify({
    memberAssignments: tracker.memberAssignments,
    memberRoleAssignments: tracker.memberRoleAssignments,
  }))
}

describe('RosterState reversible moves', () => {
  it('applyMove then revertMove restores events and tracker exactly', () => {
    const events = makeEvents()
    const tracker = new AssignmentTracker(members, events)
    const state = new RosterState(events, tracker)

    const before = snapshot(tracker)
    const beforeEvents = JSON.parse(JSON.stringify(events))

    // Assign carol to the empty cam-1 slot in event 0.
    const inverse = state.applyMove({ slot: { eventIndex: 0, roleIndex: 1 }, memberId: 'carol' })

    expect(state.getOccupant({ eventIndex: 0, roleIndex: 1 })).toBe('carol')
    expect(tracker.getAssignmentCount('carol')).toBe(1)
    expect(tracker.getRoleAssignmentCount('carol', 'cam-1')).toBe(1)

    state.revertMove(inverse)

    expect(snapshot(tracker)).toEqual(before)
    expect(events).toEqual(beforeEvents)
  })

  it('reassigning an occupied slot and reverting restores exactly', () => {
    const events = makeEvents()
    const tracker = new AssignmentTracker(members, events)
    const state = new RosterState(events, tracker)

    const before = snapshot(tracker)
    const beforeEvents = JSON.parse(JSON.stringify(events))

    // Replace alice with carol in event 0 vm slot.
    const inverse = state.applyMove({ slot: { eventIndex: 0, roleIndex: 0 }, memberId: 'carol' })
    expect(tracker.getAssignmentCount('alice')).toBe(0)
    expect(tracker.getAssignmentCount('carol')).toBe(1)

    state.revertMove(inverse)

    expect(snapshot(tracker)).toEqual(before)
    expect(events).toEqual(beforeEvents)
    expect(tracker.getAssignmentCount('alice')).toBe(1)
  })

  it('applySwap then revertSwap restores exactly', () => {
    const events = makeEvents()
    const tracker = new AssignmentTracker(members, events)
    const state = new RosterState(events, tracker)

    const before = snapshot(tracker)
    const beforeEvents = JSON.parse(JSON.stringify(events))

    const slotA = { eventIndex: 0, roleIndex: 0 } // alice
    const slotB = { eventIndex: 1, roleIndex: 0 } // bob
    const inverse = state.applySwap(slotA, slotB)

    expect(state.getOccupant(slotA)).toBe('bob')
    expect(state.getOccupant(slotB)).toBe('alice')

    state.revertSwap(inverse)

    expect(snapshot(tracker)).toEqual(before)
    expect(events).toEqual(beforeEvents)
  })

  it('allSlots enumerates every role slot', () => {
    const events = makeEvents()
    const tracker = new AssignmentTracker(members, events)
    const state = new RosterState(events, tracker)
    expect(state.allSlots()).toHaveLength(3)
  })
})

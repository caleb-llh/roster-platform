import { describe, it, expect } from 'vitest'
import { getAvailableMembersForEvent } from './availableMembers'

describe('getAvailableMembersForEvent', () => {
  const members = [
    { id: 'john', name: 'John', include: true, roles: ['vm', 'cam-1'] },
    { id: 'jane', name: 'Jane', include: true, roles: ['vm'] },
    { id: 'bob', name: 'Bob', include: false, roles: ['vm'] },
    { id: 'alice', name: 'Alice', include: true, roles: ['cam-1'] }
  ]

  const constraints = [
    {
      member_id: 'john',
      unavailable_dates: ['2026-02-14']
    }
  ]

  const event = {
    date: '2026-02-14',
    slots: [
      { role: 'vm', member_id: 'john' },
      { role: 'cam-1', member_id: null }
    ]
  }

  it('should return availability for all roster roles', () => {
    const result = getAvailableMembersForEvent(event, members, constraints)

    expect(result).toHaveProperty('vm')
    expect(result).toHaveProperty('cam-1')
  })

  it('should mark assigned member', () => {
    const result = getAvailableMembersForEvent(event, members, constraints)

    const johnEntry = result.vm.find(m => m.id === 'john')
    expect(johnEntry.assigned).toBe(true)
  })

  it('should mark unavailable members correctly', () => {
    const result = getAvailableMembersForEvent(event, members, constraints)

    const johnEntry = result.vm.find(m => m.id === 'john')
    expect(johnEntry.available).toBe(false) // John unavailable on 2026-02-14

    const janeEntry = result.vm.find(m => m.id === 'jane')
    expect(janeEntry.available).toBe(true) // Jane has no constraints
  })

  it('should exclude members with include:false', () => {
    const result = getAvailableMembersForEvent(event, members, constraints)

    const bobEntry = result.vm.find(m => m.id === 'bob')
    expect(bobEntry).toBeUndefined() // Bob should be excluded
  })

  it('should only include qualified members', () => {
    const result = getAvailableMembersForEvent(event, members, constraints)

    // Alice doesn't have 'vm' role
    const aliceInVM = result.vm.find(m => m.id === 'alice')
    expect(aliceInVM).toBeUndefined()

    // But Alice has 'cam-1' role
    const aliceInCam = result['cam-1'].find(m => m.id === 'alice')
    expect(aliceInCam).toBeDefined()
  })

  it('should handle event with no roster', () => {
    const emptyEvent = { date: '2026-02-14', slots: [] }
    const result = getAvailableMembersForEvent(emptyEvent, members, constraints)

    expect(Object.keys(result)).toHaveLength(0)
  })

  it('should handle event with undefined roster', () => {
    const noRosterEvent = { date: '2026-02-14' }
    const result = getAvailableMembersForEvent(noRosterEvent, members, constraints)

    expect(result).toEqual({})
  })

  describe('duplicate roles in one event', () => {
    // The roster is a positional array, so the same role can occupy more than
    // one slot (e.g. two 'vm'). Availability is per-role (identical for every
    // slot of that role), but 'assigned' must reflect ANY slot's occupant.
    const dupEvent = {
      date: '2026-03-01',
      slots: [
        { role: 'vm', member_id: 'john' },
        { role: 'vm', member_id: 'jane' },
      ],
    }

    it('lists the duplicated role once (availability is per-role)', () => {
      const result = getAvailableMembersForEvent(dupEvent, members, [])
      expect(Object.keys(result)).toEqual(['vm'])
    })

    it('marks EVERY occupant of the duplicated role as assigned', () => {
      const result = getAvailableMembersForEvent(dupEvent, members, [])
      // Regression: previously the last slot overwrote the first, so only
      // Jane showed assigned. Both must now be marked.
      expect(result.vm.find(m => m.id === 'john').assigned).toBe(true)
      expect(result.vm.find(m => m.id === 'jane').assigned).toBe(true)
    })
  })

  describe('promoted understudies in real-role slots', () => {
    const uMembers = [
      { id: 'perf', name: 'Perf', roles: ['multi-vm'], understudyFor: [] },
      { id: 'trainee', name: 'Trainee', roles: ['vm'], understudyFor: ['multi-vm'] },
    ]
    const allEvents = [
      { date: '2026-02-01', slots: [{ role: 'multi-vm-understudy', member_id: 'trainee' }] },
      { date: '2026-02-08', slots: [{ role: 'multi-vm', member_id: null }] },
    ]

    it('lists a promoted trainee for a real role once they have understudied earlier', () => {
      const result = getAvailableMembersForEvent(allEvents[1], uMembers, [], allEvents)
      const ids = result['multi-vm'].map(m => m.id)
      expect(ids).toContain('trainee')
      const trainee = result['multi-vm'].find(m => m.id === 'trainee')
      expect(trainee.isUnderstudy).toBe(true)
      // Full performers are not marked as understudies.
      expect(result['multi-vm'].find(m => m.id === 'perf').isUnderstudy).toBe(false)
    })

    it('excludes a trainee who has not yet understudied (understudy-before-role)', () => {
      // First event only — the trainee has no earlier understudy session.
      const result = getAvailableMembersForEvent(allEvents[0], uMembers, [], allEvents)
      // The multi-vm-understudy slot lists the trainee (they may fill it)...
      expect(result['multi-vm-understudy'].map(m => m.id)).toContain('trainee')
      // ...but there is no real multi-vm slot in this event to be promoted into.
      const noPriorSessions = getAvailableMembersForEvent(
        { date: '2026-02-08', slots: [{ role: 'multi-vm', member_id: null }] },
        uMembers, [], [allEvents[1]] // only the later event: no earlier understudy
      )
      expect(noPriorSessions['multi-vm'].map(m => m.id)).not.toContain('trainee')
    })

    it('falls back to performers-only when allEvents is omitted', () => {
      const result = getAvailableMembersForEvent(allEvents[1], uMembers, [])
      expect(result['multi-vm'].map(m => m.id)).toEqual(['perf'])
    })
  })
})

import { describe, it, expect } from 'vitest'
import { canSwapRosterSlots, explainSwap } from './swapPolicy'

describe('canSwapRosterSlots', () => {
  const members = [
    { id: 'john', name: 'John', include: true, roles: ['vm', 'cam-1'] },
    { id: 'jane', name: 'Jane', include: true, roles: ['vm', 'cam-1'] },
    { id: 'alice', name: 'Alice', include: true, roles: ['cam-1'] },
    { id: 'bob', name: 'Bob', include: false, roles: ['vm', 'cam-1'] },
  ]

  const makeEvent = (date, roster) => ({ date, roster })

  it('allows a same-event, different-role swap of the SAME member with an empty slot', () => {
    // John is in vm (index 0); cam-1 (index 1) is empty. Moving John from vm
    // to cam-1 within the same event must be allowed — this was the reported
    // bug (once-per-event falsely tripped on John still sitting in vm).
    const event = makeEvent('2026-02-08', [
      { role: 'vm', member_id: 'john' },
      { role: 'cam-1', member_id: null },
    ])
    const ok = canSwapRosterSlots({
      memberA: 'john', memberB: null,
      eventA: event, eventB: event,
      sourceIndex: 0, targetIndex: 1,
      slotA: event.roster[0], slotB: event.roster[1],
      members, memberConstraints: [], allEvents: [event],
    })
    expect(ok).toBe(true)
  })

  it('allows a same-event swap of two different members across roles', () => {
    const event = makeEvent('2026-02-08', [
      { role: 'vm', member_id: 'john' },
      { role: 'cam-1', member_id: 'jane' },
    ])
    const ok = canSwapRosterSlots({
      memberA: 'john', memberB: 'jane',
      eventA: event, eventB: event,
      sourceIndex: 0, targetIndex: 1,
      slotA: event.roster[0], slotB: event.roster[1],
      members, memberConstraints: [], allEvents: [event],
    })
    expect(ok).toBe(true)
  })

  it('rejects a swap that would place a member in a role they cannot fill', () => {
    // Alice only does cam-1; swapping her into the vm slot is invalid.
    const event = makeEvent('2026-02-08', [
      { role: 'vm', member_id: 'john' },
      { role: 'cam-1', member_id: 'alice' },
    ])
    const ok = canSwapRosterSlots({
      memberA: 'john', memberB: 'alice',
      eventA: event, eventB: event,
      sourceIndex: 0, targetIndex: 1,
      slotA: event.roster[0], slotB: event.roster[1],
      members, memberConstraints: [], allEvents: [event],
    })
    expect(ok).toBe(false)
  })

  it('rejects a cross-event move onto a date the member is unavailable', () => {
    const eventA = makeEvent('2026-02-08', [{ role: 'vm', member_id: 'john' }])
    const eventB = makeEvent('2026-02-15', [{ role: 'vm', member_id: null }])
    const constraints = [{ member_id: 'john', unavailable_dates: ['2026-02-15'] }]
    const ok = canSwapRosterSlots({
      memberA: 'john', memberB: null,
      eventA, eventB,
      sourceIndex: 0, targetIndex: 0,
      slotA: eventA.roster[0], slotB: eventB.roster[0],
      members, memberConstraints: constraints, allEvents: [eventA, eventB],
    })
    expect(ok).toBe(false)
  })

  it('rejects a cross-event swap that would duplicate a member within one event', () => {
    // eventA: john(vm) + jane(cam-1). eventB: jane(vm). Swapping john(A/vm)
    // with jane(B/vm) would put jane in eventA twice (cam-1 + vm).
    const eventA = makeEvent('2026-02-08', [
      { role: 'vm', member_id: 'john' },
      { role: 'cam-1', member_id: 'jane' },
    ])
    const eventB = makeEvent('2026-02-15', [{ role: 'vm', member_id: 'jane' }])
    const ok = canSwapRosterSlots({
      memberA: 'john', memberB: 'jane',
      eventA, eventB,
      sourceIndex: 0, targetIndex: 0,
      slotA: eventA.roster[0], slotB: eventB.roster[0],
      members, memberConstraints: [], allEvents: [eventA, eventB],
    })
    expect(ok).toBe(false)
  })

  it('rejects moving in an inactive (include:false) member', () => {
    const event = makeEvent('2026-02-08', [
      { role: 'vm', member_id: 'bob' },
      { role: 'cam-1', member_id: null },
    ])
    const ok = canSwapRosterSlots({
      memberA: 'bob', memberB: null,
      eventA: event, eventB: event,
      sourceIndex: 0, targetIndex: 1,
      slotA: event.roster[0], slotB: event.roster[1],
      members, memberConstraints: [], allEvents: [event],
    })
    expect(ok).toBe(false)
  })
})

describe('explainSwap (rejection reasons)', () => {
  const members = [
    { id: 'john', name: 'John', include: true, roles: ['vm', 'cam-1'] },
    { id: 'jane', name: 'Jane', include: true, roles: ['vm', 'cam-1'] },
    { id: 'alice', name: 'Alice', include: true, roles: ['cam-1'] },
    { id: 'bob', name: 'Bob', include: false, roles: ['vm', 'cam-1'] },
  ]
  const makeEvent = (date, roster) => ({ date, roster })

  it('returns ok with no reason for a valid swap', () => {
    const event = makeEvent('2026-02-08', [
      { role: 'vm', member_id: 'john' },
      { role: 'cam-1', member_id: 'jane' },
    ])
    const res = explainSwap({
      memberA: 'john', memberB: 'jane', eventA: event, eventB: event,
      sourceIndex: 0, targetIndex: 1,
      slotA: event.roster[0], slotB: event.roster[1],
      members, memberConstraints: [], allEvents: [event],
    })
    expect(res.ok).toBe(true)
    expect(res.reason).toBeNull()
  })

  it('names the member and role when the role cannot be filled', () => {
    const event = makeEvent('2026-02-08', [
      { role: 'vm', member_id: 'john' },
      { role: 'cam-1', member_id: 'alice' },
    ])
    const res = explainSwap({
      memberA: 'john', memberB: 'alice', eventA: event, eventB: event,
      sourceIndex: 0, targetIndex: 1,
      slotA: event.roster[0], slotB: event.roster[1],
      members, memberConstraints: [], allEvents: [event],
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('Alice')
    expect(res.reason).toContain('vm')
  })

  it('names the member and date when unavailable', () => {
    const eventA = makeEvent('2026-02-08', [{ role: 'vm', member_id: 'john' }])
    const eventB = makeEvent('2026-02-15', [{ role: 'vm', member_id: null }])
    const constraints = [{ member_id: 'john', unavailable_dates: ['2026-02-15'] }]
    const res = explainSwap({
      memberA: 'john', memberB: null, eventA, eventB,
      sourceIndex: 0, targetIndex: 0,
      slotA: eventA.roster[0], slotB: eventB.roster[0],
      members, memberConstraints: constraints, allEvents: [eventA, eventB],
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('John')
    expect(res.reason).toContain('2026-02-15')
  })

  it('reports a once-per-event clash naming the member', () => {
    const eventA = makeEvent('2026-02-08', [
      { role: 'vm', member_id: 'john' },
      { role: 'cam-1', member_id: 'jane' },
    ])
    const eventB = makeEvent('2026-02-15', [{ role: 'vm', member_id: 'jane' }])
    const res = explainSwap({
      memberA: 'john', memberB: 'jane', eventA, eventB,
      sourceIndex: 0, targetIndex: 0,
      slotA: eventA.roster[0], slotB: eventB.roster[0],
      members, memberConstraints: [], allEvents: [eventA, eventB],
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('Jane')
    expect(res.reason).toContain('already')
  })

  it('reports an inactive member', () => {
    const event = makeEvent('2026-02-08', [
      { role: 'vm', member_id: 'bob' },
      { role: 'cam-1', member_id: null },
    ])
    const res = explainSwap({
      memberA: 'bob', memberB: null, eventA: event, eventB: event,
      sourceIndex: 0, targetIndex: 1,
      slotA: event.roster[0], slotB: event.roster[1],
      members, memberConstraints: [], allEvents: [event],
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('Bob')
    expect(res.reason).toContain('inactive')
  })
})

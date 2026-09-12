import { describe, it, expect } from 'vitest'
import { computeRosterDiff, slotDiffStatus } from './rosterDiff'

const ev = (date, roster, name = 'Service') => ({ date, name, roster })

describe('computeRosterDiff', () => {
  it('reports no changes for identical arrays', () => {
    const committed = [ev('2026-02-07', [{ role: 'lead', member_id: 'a' }])]
    const diff = computeRosterDiff(committed, committed)
    expect(diff.hasChanges).toBe(false)
    expect(diff.slotChanges).toEqual([])
    expect(diff.affectedMemberIds).toEqual({ added: [], removed: [] })
  })

  it('detects a changed assignment (before -> after)', () => {
    const committed = [ev('2026-02-07', [{ role: 'lead', member_id: 'a' }])]
    const draft = [ev('2026-02-07', [{ role: 'lead', member_id: 'b' }])]
    const diff = computeRosterDiff(committed, draft)
    expect(diff.hasChanges).toBe(true)
    expect(diff.slotChanges).toEqual([
      { date: '2026-02-07', name: 'Service', roleIndex: 0, role: 'lead', status: 'changed', before: 'a', after: 'b' },
    ])
    expect(slotDiffStatus(diff, '2026-02-07', 0)).toBe('changed')
    expect(diff.affectedMemberIds.added).toEqual(['b'])
    expect(diff.affectedMemberIds.removed).toEqual(['a'])
  })

  it('detects an added slot (role requirement added)', () => {
    const committed = [ev('2026-02-07', [{ role: 'lead', member_id: 'a' }])]
    const draft = [ev('2026-02-07', [
      { role: 'lead', member_id: 'a' },
      { role: 'support', member_id: 'b' },
    ])]
    const diff = computeRosterDiff(committed, draft)
    expect(slotDiffStatus(diff, '2026-02-07', 1)).toBe('added')
    expect(diff.affectedMemberIds.added).toEqual(['b'])
    expect(diff.affectedMemberIds.removed).toEqual([])
  })

  it('detects a removed slot', () => {
    const committed = [ev('2026-02-07', [
      { role: 'lead', member_id: 'a' },
      { role: 'support', member_id: 'b' },
    ])]
    const draft = [ev('2026-02-07', [{ role: 'lead', member_id: 'a' }])]
    const diff = computeRosterDiff(committed, draft)
    expect(slotDiffStatus(diff, '2026-02-07', 1)).toBe('removed')
    expect(diff.affectedMemberIds.removed).toEqual(['b'])
  })

  it('nets out a member moved between slots (still on the roster)', () => {
    // 'a' moves from lead to support; they are still assigned, so not "removed".
    const committed = [ev('2026-02-07', [
      { role: 'lead', member_id: 'a' },
      { role: 'support', member_id: null },
    ])]
    const draft = [ev('2026-02-07', [
      { role: 'lead', member_id: null },
      { role: 'support', member_id: 'a' },
    ])]
    const diff = computeRosterDiff(committed, draft)
    expect(diff.affectedMemberIds).toEqual({ added: [], removed: [] })
    // Both slots changed though.
    expect(slotDiffStatus(diff, '2026-02-07', 0)).toBe('changed')
    expect(slotDiffStatus(diff, '2026-02-07', 1)).toBe('changed')
  })

  it('groups changed event dates', () => {
    const committed = [
      ev('2026-02-07', [{ role: 'lead', member_id: 'a' }]),
      ev('2026-02-08', [{ role: 'lead', member_id: 'b' }]),
    ]
    const draft = [
      ev('2026-02-07', [{ role: 'lead', member_id: 'a' }]),
      ev('2026-02-08', [{ role: 'lead', member_id: 'c' }]),
    ]
    const diff = computeRosterDiff(committed, draft)
    expect([...diff.changedEventDates]).toEqual(['2026-02-08'])
  })

  it('flags a slot whose role changed even if the member is unchanged', () => {
    const committed = [ev('2026-02-07', [{ role: 'lead', member_id: 'a' }])]
    const draft = [ev('2026-02-07', [{ role: 'support', member_id: 'a' }])]
    const diff = computeRosterDiff(committed, draft)
    expect(slotDiffStatus(diff, '2026-02-07', 0)).toBe('changed')
    // Member 'a' is still assigned, so membership is unaffected.
    expect(diff.affectedMemberIds).toEqual({ added: [], removed: [] })
  })

  it('handles null/empty inputs gracefully', () => {
    expect(computeRosterDiff(null, null).hasChanges).toBe(false)
    expect(computeRosterDiff(undefined, []).hasChanges).toBe(false)
  })

  it('handles an event present only in the draft (newly added event)', () => {
    const committed = [ev('2026-02-07', [{ role: 'lead', member_id: 'a' }])]
    const draft = [
      ev('2026-02-07', [{ role: 'lead', member_id: 'a' }]),
      ev('2026-02-08', [{ role: 'lead', member_id: 'b' }]),
    ]
    const diff = computeRosterDiff(committed, draft)
    expect(slotDiffStatus(diff, '2026-02-08', 0)).toBe('added')
    expect([...diff.changedEventDates]).toEqual(['2026-02-08'])
    expect(diff.affectedMemberIds.added).toEqual(['b'])
  })

  it('ignores empty (unassigned) slots for membership accounting', () => {
    const committed = [ev('2026-02-07', [{ role: 'lead', member_id: null }])]
    const draft = [ev('2026-02-07', [{ role: 'lead', member_id: 'a' }])]
    const diff = computeRosterDiff(committed, draft)
    expect(slotDiffStatus(diff, '2026-02-07', 0)).toBe('changed')
    expect(diff.affectedMemberIds.added).toEqual(['a'])
    expect(diff.affectedMemberIds.removed).toEqual([])
  })
})

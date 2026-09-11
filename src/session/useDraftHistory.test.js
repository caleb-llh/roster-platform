import { describe, it, expect, vi } from 'vitest'
import {
  initialDraftState,
  effectiveOf,
  applyEdit,
  undoState,
  redoState,
  clearDraft,
  resetState,
  commitDraftState,
} from './useDraftHistory'

// Minimal events fixtures (only the fields the draft logic touches).
const committed = [
  { date: '2026-02-07', roster: [{ role: 'lead', member_id: 'a' }] },
]
const edit1 = [
  { date: '2026-02-07', roster: [{ role: 'lead', member_id: 'b' }] },
]
const edit2 = [
  { date: '2026-02-07', roster: [{ role: 'lead', member_id: 'c' }] },
]

describe('useDraftHistory pure transitions', () => {
  it('effectiveOf returns committed when clean, draft when dirty', () => {
    expect(effectiveOf(initialDraftState, committed)).toBe(committed)
    const s = applyEdit(initialDraftState, committed, edit1)
    expect(effectiveOf(s, committed)).toEqual(edit1)
  })

  it('applyEdit snapshots committed onto undo and clears redo', () => {
    const s = applyEdit(initialDraftState, committed, edit1)
    expect(s.draftEvents).toEqual(edit1)
    expect(s.undoStack).toEqual([committed])
    expect(s.redoStack).toEqual([])
  })

  it('does not mutate the input state', () => {
    const before = JSON.parse(JSON.stringify(initialDraftState))
    applyEdit(initialDraftState, committed, edit1)
    expect(initialDraftState).toEqual(before)
  })

  it('undo/redo move between stacks without touching committed', () => {
    let s = applyEdit(initialDraftState, committed, edit1)
    s = applyEdit(s, committed, edit2)
    // effective is edit2, undo stack holds [committed, edit1]
    expect(effectiveOf(s, committed)).toEqual(edit2)

    s = undoState(s, committed)
    expect(effectiveOf(s, committed)).toEqual(edit1)
    expect(s.redoStack.length).toBe(1)

    s = undoState(s, committed)
    expect(effectiveOf(s, committed)).toEqual(committed)
    expect(s.undoStack.length).toBe(0)

    s = redoState(s, committed)
    expect(effectiveOf(s, committed)).toEqual(edit1)
    s = redoState(s, committed)
    expect(effectiveOf(s, committed)).toEqual(edit2)
    expect(s.redoStack.length).toBe(0)
  })

  it('a new edit after undo clears the redo future', () => {
    let s = applyEdit(initialDraftState, committed, edit1)
    s = undoState(s, committed) // draft back to committed, redo=[edit1]
    expect(s.redoStack.length).toBe(1)
    s = applyEdit(s, committed, edit2)
    expect(s.redoStack).toEqual([])
    expect(effectiveOf(s, committed)).toEqual(edit2)
  })

  it('undo/redo are no-ops on empty stacks', () => {
    expect(undoState(initialDraftState, committed)).toBe(initialDraftState)
    expect(redoState(initialDraftState, committed)).toBe(initialDraftState)
  })

  it('clearDraft (commit/discard) clears the draft but KEEPS both stacks', () => {
    let s = applyEdit(initialDraftState, committed, edit1)
    s = applyEdit(s, committed, edit2)
    s = undoState(s, committed) // undo=[committed], redo=[edit2], draft=edit1
    const cleared = clearDraft(s)
    expect(cleared.draftEvents).toBeNull()
    expect(cleared.undoStack).toEqual(s.undoStack) // history preserved
    expect(cleared.redoStack).toEqual(s.redoStack)
  })

  it('after clearing the draft, undo/redo still work (independent of commit)', () => {
    // Simulate: edit, commit (draft cleared but stacks kept), then the new
    // committed events equal the draft that was just saved.
    let s = applyEdit(initialDraftState, committed, edit1)
    const newCommitted = edit1 // pretend the provider persisted edit1
    s = clearDraft(s)
    expect(s.draftEvents).toBeNull()
    // Undo should still step back to the pre-edit snapshot (committed).
    s = undoState(s, newCommitted)
    expect(effectiveOf(s, newCommitted)).toEqual(committed)
  })

  it('resetState wipes draft and both stacks', () => {
    let s = applyEdit(initialDraftState, committed, edit1)
    s = resetState()
    expect(s).toEqual(initialDraftState)
  })
})

describe('commitDraftState', () => {
  it('is a no-op when there is no draft (does not call persist)', async () => {
    const persist = vi.fn()
    const { result, nextState } = await commitDraftState(initialDraftState, persist)
    expect(result).toEqual({ ok: true, errors: [] })
    expect(nextState).toBe(initialDraftState)
    expect(persist).not.toHaveBeenCalled()
  })

  it('persists the draft, then clears it while KEEPING history on success', async () => {
    let s = applyEdit(initialDraftState, committed, edit1)
    s = applyEdit(s, committed, edit2) // draft=edit2, undo=[committed, edit1]
    const persist = vi.fn().mockResolvedValue({ ok: true, errors: [] })

    const { result, nextState } = await commitDraftState(s, persist)
    expect(persist).toHaveBeenCalledWith(edit2) // persists the current draft
    expect(result.ok).toBe(true)
    expect(nextState.draftEvents).toBeNull()          // draft cleared
    expect(nextState.undoStack).toEqual(s.undoStack)  // history preserved
    expect(nextState.redoStack).toEqual(s.redoStack)
  })

  it('keeps the draft and surfaces errors when persist fails', async () => {
    const s = applyEdit(initialDraftState, committed, edit1)
    const persist = vi.fn().mockResolvedValue({ ok: false, errors: ['network down'] })

    const { result, nextState } = await commitDraftState(s, persist)
    expect(result).toEqual({ ok: false, errors: ['network down'] })
    expect(nextState).toBe(s)                 // unchanged — nothing lost
    expect(nextState.draftEvents).toEqual(edit1)
  })
})

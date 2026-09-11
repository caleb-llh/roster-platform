import { useReducer, useCallback, useRef, useMemo } from 'react'

/**
 * Draft / commit + undo / redo state, shared by every data provider.
 *
 * The provider owns the COMMITTED events (the "binding"). This module layers an
 * uncommitted DRAFT on top plus two history stacks. See specs/data-layer.md
 * → "Draft/commit is separate from undo/redo history".
 *
 * The state transitions are pure functions (exported for tests); the hook is a
 * thin wrapper that wires them to React state and the provider's persist call.
 *
 * State shape:
 *   { draftEvents: any[]|null, undoStack: any[][], redoStack: any[][] }
 * where `draftEvents === null` means "clean" (the effective roster IS committed).
 *
 * Invariants:
 *  - Every edit goes through `applyEdit`: it snapshots the current effective
 *    events onto the undo stack, clears the redo stack, and sets the draft.
 *  - `undo`/`redo` move a snapshot between the stacks and update the draft; they
 *    NEVER touch committed state.
 *  - `commit`/`discard` clear the draft but DELIBERATELY leave both stacks
 *    intact — committing is a separate concern from history navigation.
 */

const clone = (events) => JSON.parse(JSON.stringify(events || []))

/** The events the rest of the app should see. */
export function effectiveOf(state, committedEvents) {
  return state.draftEvents !== null ? state.draftEvents : committedEvents
}

export const initialDraftState = { draftEvents: null, undoStack: [], redoStack: [] }

/**
 * Pure transitions. Each takes (state, committedEvents, ...args) and returns a
 * new state object (never mutates the input).
 */
export function applyEdit(state, committedEvents, nextEvents) {
  const current = effectiveOf(state, committedEvents)
  return {
    draftEvents: clone(nextEvents),
    undoStack: [...state.undoStack, clone(current)],
    redoStack: [],
  }
}

export function undoState(state, committedEvents) {
  if (state.undoStack.length === 0) return state
  const current = effectiveOf(state, committedEvents)
  const previous = state.undoStack[state.undoStack.length - 1]
  return {
    draftEvents: clone(previous),
    undoStack: state.undoStack.slice(0, -1),
    redoStack: [...state.redoStack, clone(current)],
  }
}

export function redoState(state, committedEvents) {
  if (state.redoStack.length === 0) return state
  const current = effectiveOf(state, committedEvents)
  const next = state.redoStack[state.redoStack.length - 1]
  return {
    draftEvents: clone(next),
    undoStack: [...state.undoStack, clone(current)],
    redoStack: state.redoStack.slice(0, -1),
  }
}

/** Clear the draft; keep both history stacks (commit / discard). */
export function clearDraft(state) {
  if (state.draftEvents === null) return state
  return { ...state, draftEvents: null }
}

/** Reset everything (new session / roster switch / import). */
export function resetState() {
  return { draftEvents: null, undoStack: [], redoStack: [] }
}

/**
 * Pure async commit: persist the current draft via `persistEvents`, then (only
 * on success) clear the draft while keeping both history stacks. Returns the
 * mutation result plus the next state so callers / tests don't need a renderer.
 *
 * @returns {Promise<{ result: {ok:boolean, errors:string[]}, nextState: object }>}
 */
export async function commitDraftState(state, persistEvents) {
  if (state.draftEvents === null) {
    return { result: { ok: true, errors: [] }, nextState: state }
  }
  const result = await persistEvents(state.draftEvents)
  if (!result.ok) {
    // Persist failed → keep the draft (and history) so nothing is lost.
    return { result, nextState: state }
  }
  return { result: { ok: true, errors: [] }, nextState: clearDraft(state) }
}

function reducer(state, action) {
  switch (action.type) {
    case 'edit': return applyEdit(state, action.committedEvents, action.nextEvents)
    case 'undo': return undoState(state, action.committedEvents)
    case 'redo': return redoState(state, action.committedEvents)
    case 'clearDraft': return clearDraft(state)
    case 'reset': return resetState()
    default: return state
  }
}

/**
 * @param {Array} committedEvents  the provider's currently-saved events
 * @param {(events: any[]) => Promise<{ok:boolean, errors:string[]}>} persistEvents
 */
export function useDraftHistory(committedEvents, persistEvents) {
  const [state, dispatch] = useReducer(reducer, initialDraftState)

  // Refs so undo/redo/commit read the latest committed events / draft without
  // needing them in callback deps.
  const committedRef = useRef(committedEvents)
  committedRef.current = committedEvents
  const stateRef = useRef(state)
  stateRef.current = state

  const applyDraftEdit = useCallback((nextEvents) => {
    dispatch({ type: 'edit', committedEvents: committedRef.current, nextEvents })
  }, [])

  const undo = useCallback(() => {
    if (stateRef.current.undoStack.length === 0) return false
    dispatch({ type: 'undo', committedEvents: committedRef.current })
    return true
  }, [])

  const redo = useCallback(() => {
    if (stateRef.current.redoStack.length === 0) return false
    dispatch({ type: 'redo', committedEvents: committedRef.current })
    return true
  }, [])

  const commit = useCallback(async () => {
    const { result, nextState } = await commitDraftState(stateRef.current, persistEvents)
    if (result.ok && nextState !== stateRef.current) dispatch({ type: 'clearDraft' })
    return result
  }, [persistEvents])

  const discard = useCallback(() => dispatch({ type: 'clearDraft' }), [])
  const resetDraftHistory = useCallback(() => dispatch({ type: 'reset' }), [])

  const effectiveEvents = useMemo(
    () => effectiveOf(state, committedEvents),
    [state, committedEvents]
  )

  return {
    effectiveEvents,
    draftEvents: state.draftEvents,
    hasUncommitted: state.draftEvents !== null,
    applyDraftEdit,
    undo,
    redo,
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
    commit,
    discard,
    resetDraftHistory,
  }
}

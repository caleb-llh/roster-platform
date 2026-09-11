import { useEffect, useRef } from 'react'
import { useDraftHistory } from './useDraftHistory'

/**
 * The Session layer — the "time" layer that sits ABOVE a pure CRUD provider.
 *
 * A provider owns the COMMITTED document and knows how to persist events
 * (`saveEvents`) and swap the non-event document (`replaceDocument`), but it is
 * timeless: it has no notion of an uncommitted draft, undo/redo, or the
 * command surface the UI drives. This hook layers all of that on top:
 *
 *  - It owns `useDraftHistory`, keyed off the provider's committed events.
 *  - It exposes the draft/history keys (`draftEvents`, `effectiveEvents`,
 *    `hasUncommitted`, `canUndo`, `canRedo`, `undo`, `redo`, `commitDraft`,
 *    `discardDraft`) and the edit commands (`stageEvents`, `stageDocument`).
 *  - It resets the draft whenever a fresh committed document arrives (import,
 *    clear, roster/team switch, or a background load). That is detected by the
 *    provider's `originalData` reference changing — the providers set a new
 *    `originalData` on every load and null it on clear, but deliberately leave
 *    it untouched on `saveEvents` (a commit), so a commit does NOT wipe the
 *    history stacks. See specs/session.md and specs/data-layer.md.
 *
 * The composed surface is the identical flat shape the UI already consumes, so
 * assembling Session above the provider is transparent to App.jsx.
 *
 * @param {import('../data/providerContract').RosterProvider} provider
 * @returns {import('../data/providerContract').RosterProvider}
 */
export function useSession(provider) {
  const draft = useDraftHistory(provider.data?.events, provider.saveEvents)

  // Reset the draft + history when a NEW committed document arrives (load,
  // import, clear, roster/team switch). Commits leave `originalData` untouched,
  // so the stacks survive a commit. Skip the initial render (nothing to reset).
  const prevOriginalRef = useRef(provider.originalData)
  const initializedRef = useRef(false)
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true
      prevOriginalRef.current = provider.originalData
      return
    }
    if (provider.originalData !== prevOriginalRef.current) {
      prevOriginalRef.current = provider.originalData
      draft.resetDraftHistory()
    }
  }, [provider.originalData, draft])

  // Command: stage a manual/generation events edit into the uncommitted draft
  // (no persistence — that happens only on commitDraft). Gated on edit
  // permission so a viewer's edit is rejected the same way it was when the
  // provider owned this. Named as a command (it can be rejected), not CRUD.
  const stageEvents = async (newEvents) => {
    if (!provider.permissions.canEditRoster) {
      return { ok: false, errors: ['You do not have permission to edit.'] }
    }
    draft.applyDraftEdit(newEvents)
    return { ok: true, errors: [] }
  }

  // Command: stage a whole-document edit from the YAML editor. Non-event fields
  // apply to the working document immediately via the provider; the events
  // portion goes into the draft (undoable, committed on save). The current
  // draft events (if any) are preserved on the document.
  const stageDocument = async (parsedData) => {
    const keepEvents = draft.draftEvents !== null ? draft.draftEvents : provider.data?.events
    const result = await provider.replaceDocument(parsedData, keepEvents)
    if (!result.ok) return { ok: result.ok, errors: result.errors }
    draft.applyDraftEdit(result.nextEvents || [])
    return { ok: true, errors: [] }
  }

  return {
    ...provider,
    // Draft / history overlay.
    draftEvents: draft.draftEvents,
    effectiveEvents: draft.effectiveEvents,
    hasUncommitted: draft.hasUncommitted,
    canUndo: draft.canUndo,
    canRedo: draft.canRedo,
    undo: draft.undo,
    redo: draft.redo,
    commitDraft: draft.commit,
    discardDraft: draft.discard,
    // Edit commands (orchestrate the draft on top of provider CRUD).
    stageEvents,
    stageDocument,
  }
}

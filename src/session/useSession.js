import { useEffect, useRef } from 'react'
import { useDraftHistory } from './useDraftHistory'
import { toState } from '../state/derivedState'
import * as commands from './commands'

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
 *    `discardDraft`), the whole-document commands (`stageEvents`,
 *    `stageDocument`), and the per-action domain commands (`assign`, `addSlot`,
 *    `removeSlot`, `swap`, `clearGenerated`, `bulkClear`). Each per-action
 *    command runs a pure function from `commands.js` against the effective
 *    state, applies the result to the draft, and returns an Evaluation verdict
 *    (see specs/session.md). `stageEvents` remains the generic apply used by the
 *    generator (`generateRoster` produces events that are staged wholesale).
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

  // The derived state a pure command consumes: the EFFECTIVE document (committed
  // + uncommitted draft overlaid) run through the adapter, plus the provider's
  // externalAssignments (person-global other-team load). Recomputed per call so
  // a command always sees the latest draft.
  const commandState = () => {
    const effectiveData = provider.data
      ? { ...provider.data, events: draft.effectiveEvents }
      : provider.data
    return { ...toState(effectiveData), externalAssignments: provider.externalAssignments }
  }

  // Run a pure command: check edit permission, apply its `nextEvents` to the
  // draft, and return the command's verdict/logEntry/preview to the caller so
  // the UI can surface warnings, write the audit line, and (for a loss-ful
  // action like swap) stage a confirmation. A hard-rejected command
  // (`ok: false`, e.g. an infeasible swap) is NOT applied.
  //
  // `preview` mode computes the same result WITHOUT applying it — used by the
  // loss-ful/destructive actions (swap, removeSlot, clearGenerated, bulkClear)
  // that the UI stages behind a confirmation dialog and only applies on confirm
  // (via `stageEvents(result.nextEvents)`). This keeps "compute + verdict" in the
  // command and "confirm UX" in the UI, without an apply/undo hack.
  const runCommand = (fn) => (args, { preview = false } = {}) => {
    if (!provider.permissions.canEditRoster) {
      return { ok: false, reason: 'You do not have permission to edit.', nextEvents: null, verdict: { warnings: [] }, logEntry: null }
    }
    const result = fn(commandState(), args)
    if (!preview && result.ok && result.nextEvents) draft.applyDraftEdit(result.nextEvents)
    return result
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
    // Whole-document commands (orchestrate the draft on top of provider CRUD).
    stageEvents,
    stageDocument,
    // Per-action domain commands (pure mutation + Evaluation verdict). Each
    // returns { ok, reason, nextEvents, verdict:{warnings}, logEntry, ... }.
    assign: runCommand(commands.assign),
    addSlot: runCommand(commands.addSlot),
    removeSlot: runCommand(commands.removeSlot),
    swap: runCommand(commands.swap),
    clearGenerated: runCommand(commands.clearGenerated),
    bulkClear: runCommand(commands.bulkClear),
  }
}

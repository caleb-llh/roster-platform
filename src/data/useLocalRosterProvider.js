import { useState, useRef } from 'react'
import yaml from 'js-yaml'
import { runAllValidators } from '../validators'
import { LOCAL_PERMISSIONS } from './providerContract'
import { useDraftHistory } from './useDraftHistory'
import { isTenantShape, tenantSelection, resolveTenant, memberTeams, writeBackEvents, deriveExternalAssignments, validateTenantRosters } from '../utils/tenantResolver'

/**
 * Local (in-memory) implementation of the roster data provider contract.
 *
 * State is held fully in memory for the session — nothing is persisted, so a
 * page refresh starts from an empty state. This is the default GitHub Pages
 * playground. Mutations are async-shaped and return { ok, errors } to match the
 * production contract exactly, even though local edits cannot really fail; this
 * keeps callers honest so the same code paths work in production.
 *
 * @returns {import('./providerContract').RosterProvider}
 */
export function useLocalRosterProvider() {
  const [data, setData] = useState(null)
  const [originalData, setOriginalData] = useState(null)
  const [error, setError] = useState(null)
  const [loading] = useState(false)
  const [hasGenerated, setHasGenerated] = useState(false)
  const [actionLog, setActionLog] = useState([]) // Generic roster action log

  // Multi-tenant Phase 1: when a nested tenant document is imported, the raw
  // document is held here and `data` is the RESOLVED flat view of the active
  // team+roster (so the draft/commit machinery, which reads `data.events`, is
  // unchanged). Flat imports leave `tenantDoc` null and behave exactly as before.
  const [tenantDoc, setTenantDoc] = useState(null)
  const [activeTeamId, setActiveTeamId] = useState(null)
  const [activeRosterId, setActiveRosterId] = useState(null)

  // The committed-events sink below is captured by the draft hook via a ref, so
  // it must read the LATEST tenant doc + selection (not the render-time closure)
  // to write edits back into the correct roster on commit.
  const tenantDocRef = useRef(tenantDoc)
  tenantDocRef.current = tenantDoc
  const activeTeamIdRef = useRef(activeTeamId)
  activeTeamIdRef.current = activeTeamId
  const activeRosterIdRef = useRef(activeRosterId)
  activeRosterIdRef.current = activeRosterId

  const selection = tenantDoc ? tenantSelection(tenantDoc) : { teams: [] }
  const teams = tenantDoc ? selection.teams.map(t => ({ id: t.id, name: t.name })) : []
  const activeTeam = selection.teams.find(t => t.id === activeTeamId)
  const activeTeamName = activeTeam ? activeTeam.name : null
  const rosters = activeTeam ? activeTeam.rosters.map(r => ({ id: r.id, name: r.name, role: 'owner' })) : []
  // Cross-team visibility for the members view (multi-tenant Phase 1). `{}` for
  // flat documents, so the "Also on" line never shows in single-team mode.
  const memberTeamsMap = tenantDoc ? memberTeams(tenantDoc) : {}
  // Cross-team enforcement snapshot (multi-tenant Phase 2): the active team's
  // members' assignments on OTHER teams. `{}` in flat/single-team mode so the
  // cross-team caps/clash fold is a no-op. Consumed by the generator/validator
  // via App.jsx and folded through the shared counting seam.
  const externalAssignments = tenantDoc
    ? deriveExternalAssignments(tenantDoc, { teamId: activeTeamId })
    : {}

  // Draft overlay + undo/redo. Committed events live in `data.events`; edits
  // build an uncommitted draft that is only merged back on commit().
  const persistCommittedEvents = async (events) => {
    setData(prevData => ({ ...prevData, events }))
    setHasGenerated(true)
    // Multi-tenant Phase 1 write-back: when a nested tenant doc is loaded,
    // committing also persists the events into that roster inside the tenant
    // doc, so switching team/roster and returning preserves the edit.
    if (tenantDocRef.current) {
      setTenantDoc(prevDoc =>
        writeBackEvents(
          prevDoc,
          { teamId: activeTeamIdRef.current, rosterId: activeRosterIdRef.current },
          events
        )
      )
    }
    return { ok: true, errors: [] }
  }
  const draft = useDraftHistory(data?.events, persistCommittedEvents)

  // Import YAML data (fresh session).
  const importData = async (yamlText) => {
    let parsedData
    try {
      parsedData = yaml.load(yamlText)
    } catch (err) {
      return { ok: false, errors: [err.message] }
    }

    // Multi-tenant Phase 1: a nested tenant document (top-level `teams`) is
    // resolved to the FLAT shape the validators + engine consume, selecting the
    // first team's first roster. Flat documents pass through unchanged.
    let flatData = parsedData
    let nextTeamId = null
    let nextRosterId = null
    if (isTenantShape(parsedData)) {
      const sel = tenantSelection(parsedData)
      const firstTeam = sel.teams[0]
      nextTeamId = firstTeam ? firstTeam.id : null
      nextRosterId = firstTeam && firstTeam.rosters[0] ? firstTeam.rosters[0].id : null
      flatData = resolveTenant(parsedData, { teamId: nextTeamId, rosterId: nextRosterId })
    }

    const validation = runAllValidators(flatData)
    if (!validation.isValid) {
      return { ok: false, errors: validation.errors }
    }

    // Multi-tenant Phase 2: structural warning if a team's rosters overlap in
    // time (breaks the sibling-partition assumption cross-team load relies on).
    // Non-fatal — merged into the same warnings channel the UI already shows.
    const tenantWarnings = validateTenantRosters(parsedData)
    const allWarnings = [...(validation.warnings || []), ...tenantWarnings]

    setTenantDoc(isTenantShape(parsedData) ? parsedData : null)
    setActiveTeamId(nextTeamId)
    setActiveRosterId(nextRosterId)
    setOriginalData(JSON.parse(JSON.stringify(flatData)))
    setData(
      allWarnings.length
        ? { ...flatData, warnings: allWarnings }
        : flatData
    )
    setError(null)
    setHasGenerated(false)
    draft.resetDraftHistory()
    setActionLog([])

    return { ok: true, errors: [] }
  }

  // Re-resolve the flat working document for a new team/roster selection from
  // the held tenant document. Only meaningful when a nested tenant doc is loaded.
  const applySelection = (teamIdSel, rosterIdSel) => {
    if (!tenantDoc) return
    const flatData = resolveTenant(tenantDoc, { teamId: teamIdSel, rosterId: rosterIdSel })
    setOriginalData(JSON.parse(JSON.stringify(flatData)))
    setData(flatData)
    setHasGenerated(false)
    draft.resetDraftHistory()
    setActionLog([])
  }

  const selectTeam = (id) => {
    if (!tenantDoc || id === activeTeamId) return
    const sel = tenantSelection(tenantDoc)
    const team = sel.teams.find(t => t.id === id)
    if (!team) return
    const firstRosterId = team.rosters[0] ? team.rosters[0].id : null
    setActiveTeamId(id)
    setActiveRosterId(firstRosterId)
    applySelection(id, firstRosterId)
  }

  const selectRoster = (id) => {
    if (!tenantDoc || id === activeRosterId) return
    setActiveRosterId(id)
    applySelection(activeTeamId, id)
  }

  // Clear all data.
  const clearData = async () => {
    setData(null)
    setOriginalData(null)
    setTenantDoc(null)
    setActiveTeamId(null)
    setActiveRosterId(null)
    setHasGenerated(false)
    draft.resetDraftHistory()
    setActionLog([])
    setError(null)
  }

  // Update events after generation / manual edit. Goes into the uncommitted
  // draft (undoable); committed state changes only on commit().
  const updateEvents = async (newEvents) => {
    draft.applyDraftEdit(newEvents)
    return { ok: true, errors: [] }
  }

  /**
   * Replace the entire working document from an edited object (e.g. the live
   * YAML editor). Validates first; on failure the current state is kept
   * unchanged and the errors are returned so the caller can surface them.
   *
   * Non-event fields (members, roles, constraints) apply to the working
   * document immediately. The events portion is routed through the draft so
   * YAML-editor roster changes are undoable and part of the same commit flow as
   * manual edits (see README "Draft/commit is separate from undo/redo history").
   */
  const replaceData = async (parsedData) => {
    const validation = runAllValidators(parsedData)
    if (!validation.isValid) {
      return { ok: false, errors: validation.errors }
    }

    const { events: nextEvents, ...docWithoutEvents } = parsedData
    setData(prev => ({
      ...docWithoutEvents,
      events: (draft.draftEvents !== null ? draft.draftEvents : prev?.events) || [],
      ...(validation.hasWarnings ? { warnings: validation.warnings } : {}),
    }))
    draft.applyDraftEdit(nextEvents || [])
    return { ok: true, errors: [] }
  }

  /**
   * Append entries to the generic roster action log. Accepts a single entry or
   * an array of entries. Synchronous (purely a UI log), same in both modes.
   */
  const logAction = (entryOrEntries) => {
    const additions = Array.isArray(entryOrEntries) ? entryOrEntries : [entryOrEntries]
    if (additions.length === 0) return
    setActionLog(prev => [...prev, ...additions])
  }

  return {
    // State
    data,
    originalData,
    error,
    loading,
    hasGenerated,
    // Draft + undo/redo (see useDraftHistory)
    draftEvents: draft.draftEvents,
    effectiveEvents: draft.effectiveEvents,
    hasUncommitted: draft.hasUncommitted,
    canUndo: draft.canUndo,
    canRedo: draft.canRedo,
    actionLog,
    permissions: LOCAL_PERMISSIONS,
    // Admin surface — production only. Local mode has no roles or membership,
    // so role is null (the admin UI is gated on role === 'owner') and the admin
    // actions are inert stubs to keep the contract shape uniform. Team/roster
    // SELECTION, however, is real in local mode once a nested tenant document is
    // loaded (multi-tenant Phase 1): the selectors below re-resolve the flat
    // working document from the held tenant doc.
    role: null,
    teams,
    activeTeamId,
    activeTeamName,
    memberTeams: memberTeamsMap,
    externalAssignments,
    selectTeam,
    rosters,
    activeRosterId,
    selectRoster,
    createRoster: async () => ({ ok: false, errors: ['Not available in local mode.'] }),
    listMembers: async () => ({ ok: true, errors: [], members: [] }),
    setMemberRole: async () => ({ ok: false, errors: ['Not available in local mode.'] }),
    removeMember: async () => ({ ok: false, errors: ['Not available in local mode.'] }),
    inviteMember: async () => ({ ok: false, errors: ['Not available in local mode.'] }),
    listInvites: async () => ({ ok: true, errors: [], invites: [] }),
    revokeInvite: async () => ({ ok: false, errors: ['Not available in local mode.'] }),

    // Actions
    importData,
    clearData,
    updateEvents,
    replaceData,
    logAction,
    undo: draft.undo,
    redo: draft.redo,
    commitDraft: draft.commit,
    discardDraft: draft.discard,
    setError,
  }
}

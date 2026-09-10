import { useState, useEffect, useCallback, useRef } from 'react'
import yaml from 'js-yaml'
import { runAllValidators } from '../state/documentValidation'
import { supabase } from './supabaseClient'
import { useDraftHistory } from './useDraftHistory'

/**
 * Production (Supabase-backed) implementation of the roster data provider
 * contract.
 *
 * Storage model: the whole working roster is stored as a single JSONB document
 * on a `rosters` row, mirroring the in-memory `data` object used by the local
 * provider. Access is scoped by a `roster_members` membership row that also
 * carries the user's role (owner/editor/viewer); Row-Level Security enforces
 * this in the DB regardless of client behavior.
 *
 * Permissions are derived from the active roster's role and used by the UI for
 * fast gating; the DB is the real authority (a viewer's write simply fails
 * RLS → { ok:false }).
 *
 * Multi-roster: a user may belong to several rosters. `rosters` lists them all
 * (id/name/role); `activeRosterId` selects the one currently loaded, switchable
 * via `selectRoster`. Role/permissions always reflect the active roster.
 *
 * @returns {import('./providerContract').RosterProvider}
 */
export function useSupabaseRosterProvider() {
  const [rosters, setRosters] = useState([]) // [{ id, name, role }]
  const [rosterId, setRosterId] = useState(null)
  const activeIdRef = useRef(null) // mirrors rosterId for stable reads in loaders
  const [role, setRole] = useState(null) // 'owner' | 'editor' | 'viewer' | null
  const [data, setData] = useState(null)
  const [originalData, setOriginalData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [hasGenerated, setHasGenerated] = useState(false)
  const [actionLog, setActionLog] = useState([])

  const permissions = {
    canEditRoster: role === 'owner' || role === 'editor',
    canImport: role === 'owner',
    canUndo: role === 'owner' || role === 'editor',
  }

  const withWarnings = (parsed) => {
    const validation = runAllValidators(parsed)
    if (!validation.isValid) return { ok: false, errors: validation.errors, doc: null }
    const doc = validation.hasWarnings ? { ...parsed, warnings: validation.warnings } : parsed
    return { ok: true, errors: [], doc }
  }

  // Ref to the draft hook's reset, populated below (avoids a definition cycle
  // between applyDoc and useDraftHistory).
  const resetDraftRef = useRef(() => {})

  const applyDoc = useCallback((doc) => {
    if (doc) {
      const { doc: validated } = withWarnings(doc)
      setData(validated || doc)
      setOriginalData(JSON.parse(JSON.stringify(doc)))
    } else {
      setData(null)
      setOriginalData(null)
    }
    setHasGenerated(false)
    resetDraftRef.current()
    setActionLog([])
  }, [])

  // Persist the current document (minus transient `warnings`) to the roster row.
  const persist = useCallback(async (doc) => {
    if (!supabase || !rosterId) return { ok: false, errors: ['No active roster.'] }
    const { warnings, ...clean } = doc || {}
    void warnings
    const { error: dbError } = await supabase
      .from('rosters')
      .update({ document: clean, updated_at: new Date().toISOString() })
      .eq('id', rosterId)
    if (dbError) return { ok: false, errors: [dbError.message] }
    return { ok: true, errors: [] }
  }, [rosterId])

  // Draft overlay + undo/redo. Committed events live in `data.events`; edits
  // build an uncommitted draft. Only commit() writes through to the backend.
  const dataRef = useRef(data)
  dataRef.current = data
  const persistCommittedEvents = useCallback(async (events) => {
    if (!permissions.canEditRoster) return { ok: false, errors: ['You do not have permission to edit.'] }
    const next = { ...dataRef.current, events }
    const result = await persist(next)
    if (!result.ok) return result
    setData(next)
    setHasGenerated(true)
    return { ok: true, errors: [] }
  }, [persist, permissions.canEditRoster])
  const draft = useDraftHistory(data?.events, persistCommittedEvents)
  resetDraftRef.current = draft.resetDraftHistory

  // Load all of the user's rosters and activate one. `preferredId` wins if it
  // is among the memberships; otherwise the currently-active one is kept, else
  // the first. Also loads the active roster's document.
  const loadRosters = useCallback(async (preferredId) => {
    if (!supabase) return
    setLoading(true)

    const { data: memberships, error: mErr } = await supabase
      .from('roster_members')
      .select('role, roster:rosters(id, name, document)')
      .order('created_at', { ascending: true })

    if (mErr) {
      setError({ type: 'load', message: mErr.message })
      setLoading(false)
      return
    }

    const list = (memberships || [])
      .filter(m => m.roster)
      .map(m => ({ id: m.roster.id, name: m.roster.name, role: m.role, document: m.roster.document }))

    setRosters(list.map(({ id, name, role: r }) => ({ id, name, role: r })))

    if (list.length === 0) {
      activeIdRef.current = null
      setRosterId(null)
      setRole(null)
      applyDoc(null)
      setLoading(false)
      return
    }

    const target =
      list.find(r => r.id === preferredId) ||
      list.find(r => r.id === activeIdRef.current) ||
      list[0]

    activeIdRef.current = target.id
    setRosterId(target.id)
    setRole(target.role)
    applyDoc(target.document || null)
    setError(null)
    setLoading(false)
  }, [applyDoc])

  // On mount: claim pending invites, then load rosters. The auth.users trigger
  // covers brand-new signups; claim_my_invites covers users who existed before
  // being invited.
  useEffect(() => {
    if (!supabase) return
    ;(async () => {
      await supabase.rpc('claim_my_invites')
      await loadRosters()
    })()
  }, [loadRosters])

  // Switch the active roster (loads its document from the already-fetched list
  // when possible, else re-fetches).
  const selectRoster = useCallback((id) => {
    if (id === rosterId) return
    loadRosters(id)
  }, [rosterId, loadRosters])

  // Import a fresh document from YAML (owner only). Replaces the roster doc.
  const importData = async (yamlText) => {
    if (!permissions.canImport) return { ok: false, errors: ['You do not have permission to import.'] }
    let parsed
    try {
      parsed = yaml.load(yamlText)
    } catch (err) {
      return { ok: false, errors: [err.message] }
    }
    const { ok, errors, doc } = withWarnings(parsed)
    if (!ok) return { ok, errors }

    const result = await persist(doc)
    if (!result.ok) return result

    setOriginalData(JSON.parse(JSON.stringify(parsed)))
    setData(doc)
    setError(null)
    setHasGenerated(false)
    setHistory([])
    setActionLog([])
    return { ok: true, errors: [] }
  }

  const clearData = async () => {
    // Clearing is a local view reset only; the roster row is left intact so a
    // reload restores it. (Deleting a shared roster is a separate, deliberate
    // action, not wired in this iteration.)
    setData(null)
    setHasGenerated(false)
    draft.resetDraftHistory()
    setActionLog([])
    setError(null)
  }

  // Manual/generation edit → uncommitted draft (no network). Committed state is
  // written only by commitDraft().
  const updateEvents = async (newEvents) => {
    if (!permissions.canEditRoster) return { ok: false, errors: ['You do not have permission to edit.'] }
    draft.applyDraftEdit(newEvents)
    return { ok: true, errors: [] }
  }

  // YAML editor: non-event fields apply to the working document immediately;
  // the events portion goes into the draft (undoable, committed on save).
  const replaceData = async (parsedData) => {
    if (!permissions.canEditRoster) return { ok: false, errors: ['You do not have permission to edit.'] }
    const { ok, errors, doc } = withWarnings(parsedData)
    if (!ok) return { ok, errors }
    const { events: nextEvents, ...docWithoutEvents } = doc
    setData(prev => ({
      ...docWithoutEvents,
      events: (draft.draftEvents !== null ? draft.draftEvents : prev?.events) || [],
    }))
    draft.applyDraftEdit(nextEvents || [])
    return { ok: true, errors: [] }
  }

  const logAction = (entryOrEntries) => {
    const additions = Array.isArray(entryOrEntries) ? entryOrEntries : [entryOrEntries]
    if (additions.length === 0) return
    setActionLog(prev => [...prev, ...additions])
  }

  // --- Admin (owner-only) actions, backed by SECURITY DEFINER RPCs. ---

  const createRoster = async (name) => {
    if (!supabase) return { ok: false, errors: ['No backend.'] }
    const { data: newId, error: rpcErr } = await supabase.rpc('create_roster', { p_name: name })
    if (rpcErr) return { ok: false, errors: [rpcErr.message] }
    await loadRosters(newId)
    return { ok: true, errors: [] }
  }

  const listMembers = async () => {
    if (!supabase || !rosterId) return { ok: false, errors: ['No active roster.'], members: [] }
    const { data: rows, error: rpcErr } = await supabase.rpc('list_roster_members', { p_roster_id: rosterId })
    if (rpcErr) return { ok: false, errors: [rpcErr.message], members: [] }
    return { ok: true, errors: [], members: rows || [] }
  }

  const setMemberRole = async (email, memberRole) => {
    if (!supabase || !rosterId) return { ok: false, errors: ['No active roster.'] }
    const { error: rpcErr } = await supabase.rpc('set_member_role', {
      p_roster_id: rosterId,
      p_email: email,
      p_role: memberRole,
    })
    if (rpcErr) return { ok: false, errors: [rpcErr.message] }
    return { ok: true, errors: [] }
  }

  const removeMember = async (userId) => {
    if (!supabase || !rosterId) return { ok: false, errors: ['No active roster.'] }
    const { error: rpcErr } = await supabase.rpc('remove_member', {
      p_roster_id: rosterId,
      p_user_id: userId,
    })
    if (rpcErr) return { ok: false, errors: [rpcErr.message] }
    return { ok: true, errors: [] }
  }

  // Whitelist an email before (or after) they log in. If the user already
  // exists it adds a membership immediately; otherwise a pending invite is
  // stored and auto-claimed on their first login.
  const inviteMember = async (email, memberRole) => {
    if (!supabase || !rosterId) return { ok: false, errors: ['No active roster.'] }
    const { error: rpcErr } = await supabase.rpc('invite_member', {
      p_roster_id: rosterId,
      p_email: email,
      p_role: memberRole,
    })
    if (rpcErr) return { ok: false, errors: [rpcErr.message] }
    return { ok: true, errors: [] }
  }

  const listInvites = async () => {
    if (!supabase || !rosterId) return { ok: false, errors: ['No active roster.'], invites: [] }
    const { data: rows, error: rpcErr } = await supabase.rpc('list_roster_invites', { p_roster_id: rosterId })
    if (rpcErr) return { ok: false, errors: [rpcErr.message], invites: [] }
    return { ok: true, errors: [], invites: rows || [] }
  }

  const revokeInvite = async (email) => {
    if (!supabase || !rosterId) return { ok: false, errors: ['No active roster.'] }
    const { error: rpcErr } = await supabase.rpc('revoke_invite', {
      p_roster_id: rosterId,
      p_email: email,
    })
    if (rpcErr) return { ok: false, errors: [rpcErr.message] }
    return { ok: true, errors: [] }
  }

  return {
    data,
    originalData,
    error,
    loading,
    hasGenerated,
    draftEvents: draft.draftEvents,
    effectiveEvents: draft.effectiveEvents,
    hasUncommitted: draft.hasUncommitted,
    canUndo: draft.canUndo,
    canRedo: draft.canRedo,
    actionLog,
    permissions,
    // Admin surface (production only).
    role,
    // Multi-tenant team-selection layer (Phase 1 contract). The Supabase
    // provider does not yet expose real teams (Phase 3 adds the tenant/team
    // tables + join); it reports no teams so the local-mode team selector stays
    // hidden and roster selection continues to work exactly as before.
    teams: [],
    activeTeamId: null,
    activeTeamName: null,
    memberTeams: {},
    externalAssignments: {},
    selectTeam: () => {},
    rosters,
    activeRosterId: rosterId,
    selectRoster,
    createRoster,
    listMembers,
    setMemberRole,
    removeMember,
    inviteMember,
    listInvites,
    revokeInvite,

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

import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { createRoleColorMap, formatDateRange, formatDate } from './design/colorUtils'
import { calculateRosterStats } from './readmodel/rosterStats'
import { validateEventAssignments } from './evaluation/assignmentValidator'
import { generateRoster } from './generation'
import { toState } from './state/derivedState'
import { computeRosterDiff } from './utils/rosterDiff'
import { computeAvailabilityByRole } from './readmodel/availabilityUtils'
import { useRosterData } from './hooks/useRosterData'
import { getActiveConstraints, getActivePreferences, getConstraintDescription, getPreferenceDescription, MEMBER_PREF_FIELDS } from './schema/rosterSchema'
import { ErrorDisplay, GlassFab, HoverCard } from './components/SharedComponents'
import MembersView from './components/MembersView'
import EventsView from './components/EventsView'
import RosterStatsPanel from './components/RosterStatsPanel'
import AlgorithmDescriptionModal from './components/AlgorithmDescriptionModal'
import ChangeReviewPanel from './components/ChangeReviewPanel'
import YamlDrawer from './components/YamlDrawer'
import AdminModal from './components/AdminModal'
import { headingPage, headingModal, glassModal, glassCard, modalBackdrop, btnDanger, btnPrimary, tabActive, tabInactive, monoChip, semanticError, semanticWarning, glassPanel, draftBar, tierSection, zSticky, zPopover, zToast, zModal } from './design/designSystem'

function App({ auth }) {
  // UI State
  const [searchQuery, setSearchQuery] = useState('')
  const [showDrawer, setShowDrawer] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  const [activeTab, setActiveTab] = useState('events') // 'events' | 'members' (one shown at a time, all breakpoints)
  const [showAlgorithmModal, setShowAlgorithmModal] = useState(false)
  const [generationNotice, setGenerationNotice] = useState(null) // transient neutral toast after generating
  const [showScrollTop, setShowScrollTop] = useState(false) // scroll-to-top FAB, shown once the page is scrolled down
  // Height of the pinned "unsaved changes" bar, so other sticky toolbars (the
  // Events select bar) can offset below it instead of being obstructed.
  const draftBarRef = useRef(null)
  const [draftBarHeight, setDraftBarHeight] = useState(0)
  // Tab switcher: also sticky, pinned below the draft bar. Measured so the
  // (further-down) select toolbar can clear BOTH bars. Shown at every
  // breakpoint (Events/Members are separate tabs, never side-by-side).
  const tabBarRef = useRef(null)
  const [tabBarHeight, setTabBarHeight] = useState(0)
  const [swapNotice, setSwapNotice] = useState(null)
  const [editWarning, setEditWarning] = useState(null) // transient amber toast: a command applied but a rule verdict warns
  const [pendingSwap, setPendingSwap] = useState(null) // { nextEvents, logEntry, message } awaiting confirmation
  const [showChanges, setShowChanges] = useState(false) // expand the uncommitted-changes review list
  const [pendingRemoveSlot, setPendingRemoveSlot] = useState(null) // { nextEvents, prompt, message } awaiting confirmation
  const [pendingClearGenerated, setPendingClearGenerated] = useState(null) // { nextEvents, count, prompt, message } awaiting confirmation
  const [selectMode, setSelectMode] = useState(false) // Events multi-select mode
  const [selectedSlots, setSelectedSlots] = useState(() => new Set()) // set of `date#roleIndex` keys
  const [pendingBulkClear, setPendingBulkClear] = useState(null) // { nextEvents, count, prompt, message } awaiting confirmation

  // Custom hook for all data management (consolidated state)
  const roster = useRosterData()
  const { 
    data, 
    error, 
    loading, 
    canUndo,
    canRedo,
    hasUncommitted,
    effectiveEvents,
    actionLog,
    permissions,
    role,
    teams,
    activeTeamId,
    activeTeamName,
    memberTeams,
    externalAssignments,
    selectTeam,
    rosters,
    activeRosterId,
    selectRoster,
    importData, 
    clearData, 
    stageEvents,
    stageDocument,
    assign,
    addSlot,
    removeSlot,
    swap,
    clearGenerated,
    bulkClear,
    logAction,
    undo,
    redo,
    commitDraft,
    discardDraft,
    setError 
  } = roster

  // The document the UI renders from: committed data with the uncommitted draft
  // events overlaid (effectiveEvents === draftEvents ?? data.events). All
  // derived state and validation run against this, so pending edits are visible
  // everywhere before they are saved.
  const effectiveData = data ? { ...data, events: effectiveEvents } : data

  // Derived state using utility function
  const {
    members,
    events,
    roles,
    activeMembers,
    memberConstraints,
    memberPreferences,
    rosterConstraints,
    rosterPreferences,
    rosterPeriod
  } = toState(effectiveData)

  // Committed (last-saved) events, for diffing against the draft.
  const committedEvents = toState(data).events
  const rosterDiff = computeRosterDiff(committedEvents, events)
  // Name-only label for the change-review list (diff stores member_id).
  const getMemberName = (memberId) => memberId ? (members.find(m => m.id === memberId)?.name || memberId) : null

  const roleColorMap = createRoleColorMap(roles)
  const rosterStats = calculateRosterStats(events, members, rosterPeriod, memberConstraints, rosterConstraints)
  // Members available per real role at each event date (role-capable AND free);
  // feeds the availability line chart in the stats panel.
  const availabilityByRole = computeAvailabilityByRole(events, members, roles, memberConstraints)
  
  // Validate event assignments
  const validationResults = validateEventAssignments(
    events,
    members,
    memberConstraints,
    memberPreferences,
    rosterConstraints,
    rosterPreferences,
    rosterPeriod,
    externalAssignments
  )

  // Generate dynamic algorithm description based on configuration
  const getAlgorithmDescription = () => {
    const sections = []
    
    // Constraints section
    const activeConstraintKeys = getActiveConstraints(rosterConstraints)
    if (activeConstraintKeys.length > 0) {
      const descriptions = activeConstraintKeys
        .map(key => getConstraintDescription(key, rosterConstraints))
        .filter(Boolean)
      sections.push('✓ Rules that must be followed:\n• ' + descriptions.join('\n• '))
    }
    
    // Preferences section
    const activePreferenceKeys = getActivePreferences(rosterPreferences)
    if (activePreferenceKeys.length > 0) {
      const descriptions = activePreferenceKeys
        .map(key => getPreferenceDescription(key))
        .filter(Boolean)
      sections.push('⚖️ Goals to optimize for:\n• ' + descriptions.join('\n• '))
    }
    
    // Member day preferences
    if (memberPreferences && Object.keys(memberPreferences).length > 0) {
      const dayPrefs = {}
      Object.values(memberPreferences).forEach(pref => {
        if (pref[MEMBER_PREF_FIELDS.PREFERRED_DAY]) {
          const day = pref[MEMBER_PREF_FIELDS.PREFERRED_DAY]
          dayPrefs[day] = (dayPrefs[day] || 0) + 1
        }
      })
      
      if (Object.keys(dayPrefs).length > 0) {
        const prefSummary = Object.entries(dayPrefs)
          .map(([day, count]) => `${count} member${count > 1 ? 's' : ''} prefer ${day}`)
          .join(', ')
        sections.push('👥 Individual preferences:\n• The system will try to match members with their preferred days (' + prefSummary + ')')
      }
    }
    
    // Default message if no configuration
    if (sections.length === 0) {
      return 'The system will automatically assign members to open slots, making sure everyone gets a fair share and respecting any preferences you\'ve set up.'
    }
    
    return 'The system will automatically create assignments based on:\n\n' + sections.join('\n\n')
  }

  // Handle YAML import from the drawer (fresh session).
  const handleImport = async (yamlText) => {
    const result = await importData(yamlText)
    return result
  }

  // Generate the roster immediately. Generation is non-destructive — it lands
  // in the draft and is fully undoable (Ctrl/Cmd+Z), so there is no pre-action
  // gate: clicking Auto runs it. The "how it works" explainer is on-demand (the
  // info FAB) rather than a mandatory step. A transient toast confirms the run;
  // the persistent detail (unassignable roles + quality metrics) lives in the
  // Roster Statistics panel, so a separate result modal would be redundant.
  const handleGenerateRoster = () => {
    try {
      // Count slots empty BEFORE this run so we can report how many THIS run
      // filled. We can't trust stats.generatedAssignments for the toast: it
      // counts every slot tagged `isGenerated` in the whole roster (including
      // slots filled by earlier, still-uncommitted runs), so on a mostly-full
      // roster it reads e.g. "53" when this click only filled 1 empty slot.
      const emptyBefore = events.reduce(
        (n, ev) => n + (ev.roster?.filter((r) => !r.member_id).length ?? 0),
        0
      )

      const result = generateRoster(
        events,
        members,
        memberConstraints,
        memberPreferences,
        rosterConstraints,
        rosterPreferences,
        rosterPeriod,
        { externalAssignments }
      )

      stageEvents(result.events)
      logAction(result.logEntries)

      // filled-this-run = (slots empty before) − (slots still unassignable after)
      const unassignable = result.stats?.unassignableRoles?.length ?? 0
      const filled = Math.max(0, emptyBefore - unassignable)
      setGenerationNotice(
        filled === 0 && unassignable === 0
          ? 'Nothing to generate — all slots already filled'
          : `Filled ${filled} slot${filled === 1 ? '' : 's'}${unassignable > 0 ? ` · ${unassignable} unassignable` : ''}`
      )
      setTimeout(() => setGenerationNotice(null), 4000)
    } catch (err) {
      setError({ type: 'generation', message: err.message })
    }
  }

  // Undo / redo. These navigate the draft history and NEVER touch committed
  // state (committing is a separate concern — see the draft/commit spec).
  const handleUndo = () => {
    undo()
  }
  const handleRedo = () => {
    redo()
  }

  // Save the uncommitted draft (the "binding" update) / discard it.
  const handleCommitDraft = async () => {
    const result = await commitDraft()
    if (result.ok) {
      setShowChanges(false)
    } else {
      setError({ type: 'save', message: result.errors.join('; ') })
    }
  }
  const handleDiscardDraft = () => {
    discardDraft()
    setShowChanges(false)
  }

  // Keyboard shortcuts: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z (or Ctrl+Y) redo.
  // Ignored while typing in a field so we don't hijack the browser's text undo.
  useEffect(() => {
    if (!permissions.canUndo) return
    const isTextTarget = (el) => {
      if (!el) return false
      const tag = el.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable || el.closest?.('.cm-editor')
    }
    const onKeyDown = (e) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || isTextTarget(e.target)) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        handleRedo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [permissions.canUndo, undo, redo])

  // Track whether the page is scrolled down (past ~half a viewport). The FAB is
  // always shown; when scrolled down it scrolls to top, and when at the top it
  // becomes a "scroll to today" jump. The page scrolls on the window
  // (min-h-screen, no inner scroll container).
  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > window.innerHeight * 0.5)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' })

  // Jump to the first event on or after today. Event cards carry a
  // `data-event-date` (YYYY-MM-DD) attribute; we pick the earliest one that is
  // not in the past (string compare works for zero-padded ISO dates). Falls
  // back to the last card if every event is in the past. We scroll manually
  // (not scrollIntoView) so we can offset by the sticky header stack (draft bar
  // + tab bar) and leave a small gap, instead of the card hiding behind them.
  const scrollToToday = () => {
    const cards = [...document.querySelectorAll('[data-event-date]')]
    if (cards.length === 0) return
    const todayKey = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD, local
    const target = cards.find(el => el.dataset.eventDate >= todayKey) || cards[cards.length - 1]
    const stickyOffset = draftBarHeight + tabBarHeight + 12 // + small breathing gap
    const top = target.getBoundingClientRect().top + window.scrollY - stickyOffset
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }

  // Measure the pinned draft bar so sticky toolbars below it (the Events select
  // bar) can offset by its height instead of being hidden behind it. Re-measures
  // when the bar appears/disappears or its expandable review list toggles.
  useLayoutEffect(() => {
    const el = draftBarRef.current
    if (!el) {
      setDraftBarHeight(0)
      return
    }
    const measure = () => setDraftBarHeight(el.offsetHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [hasUncommitted, rosterDiff.slotChanges.length, permissions.canEditRoster, showChanges])

  // Measure the tab switcher (see tabBarHeight above). Shown at all
  // breakpoints, so it always contributes its height.
  useLayoutEffect(() => {
    const el = tabBarRef.current
    if (!el) {
      setTabBarHeight(0)
      return
    }
    const measure = () => setTabBarHeight(el.offsetHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Surface a command's verdict: log its audit line and, if the warn-still-apply
  // gate produced warnings, show them in a transient amber toast (the edit still
  // applied — this is a heads-up, not a block). See specs/session.md.
  const surfaceVerdict = (result) => {
    if (result.logEntry) logAction(result.logEntry)
    const warnings = result.verdict?.warnings || []
    if (warnings.length) {
      setEditWarning(warnings.join(' · '))
      setTimeout(() => setEditWarning(null), 5000)
    }
  }

  // Handle a manual roster slot edit from the Events view.
  // memberId === null removes the current occupant; otherwise inserts/replaces.
  // The pure mutation + rule verdict live in the `assign` session command; this
  // handler only surfaces the verdict (log + any warning toast).
  const handleEditRosterSlot = (eventDate, roleIndex, memberId) => {
    const result = assign({ eventDate, roleIndex, memberId })
    surfaceVerdict(result)
  }

  // Handle a drag-and-drop swap between two roster slots. The `swap` command
  // enforces feasibility with a HARD reject (role compatibility, availability,
  // once-per-event, no clash); an infeasible swap is blocked with a reason. A
  // valid swap is loss-ful (rewrites two occupants), so it is staged for
  // confirmation rather than applied immediately — the command's `preview`
  // carries the before/after occupants for the dialog.
  const handleSwapRosterSlots = (source, target) => {
    const result = swap({ source, target }, { preview: true })
    if (!result.nextEvents && result.ok) return // no-op (same slot / empty)
    if (!result.ok) {
      setSwapNotice(result.reason || 'Invalid swap.')
      setTimeout(() => setSwapNotice(null), 3000)
      return
    }
    // Valid but loss-ful — stage for confirmation; apply on confirmSwap.
    setPendingSwap({
      nextEvents: result.nextEvents,
      logEntry: result.logEntry,
      ...result.preview,
    })
  }

  // Apply the staged swap after the user confirms.
  const confirmSwap = () => {
    if (!pendingSwap) return
    stageEvents(pendingSwap.nextEvents)
    if (pendingSwap.logEntry) logAction(pendingSwap.logEntry)
    setPendingSwap(null)
  }

  // Add a new (unassigned) role requirement to an event. Non-destructive, so
  // it applies immediately via the `addSlot` command.
  const handleAddRosterSlot = (eventDate, role) => {
    const result = addSlot({ eventDate, role })
    if (!result.nextEvents) return // no-op (duplicate / missing role)
    surfaceVerdict(result)
  }

  // Apply the staged role-slot removal after the user confirms. Removing an
  // entire role requirement is destructive, so it is staged for confirmation.
  const confirmRemoveSlot = () => {
    if (!pendingRemoveSlot) return
    stageEvents(pendingRemoveSlot.nextEvents)
    if (pendingRemoveSlot.logEntry) logAction(pendingRemoveSlot.logEntry)
    if (pendingRemoveSlot.warnings?.length) {
      setEditWarning(pendingRemoveSlot.warnings.join(' · '))
      setTimeout(() => setEditWarning(null), 5000)
    }
    setPendingRemoveSlot(null)
  }

  // Stage the removal of an entire role slot from an event for confirmation.
  // The `removeSlot` command computes the result + verdict; the UI holds it
  // pending (it does not apply until confirmRemoveSlot).
  const handleRemoveRosterSlot = (eventDate, roleIndex) => {
    const event = events.find(e => e.date === eventDate)
    const slot = event?.roster?.[roleIndex]
    if (!slot) return
    const result = removeSlot({ eventDate, roleIndex }, { preview: true })
    if (!result.nextEvents) return
    const nameOf = (id) => members.find(m => m.id === id)?.name || id
    const occupant = slot.member_id ? ` (currently ${nameOf(slot.member_id)})` : ''
    setPendingRemoveSlot({
      nextEvents: result.nextEvents,
      logEntry: result.logEntry,
      warnings: result.verdict?.warnings || [],
      prompt: `Remove the ${slot.role} role?`,
      message: `Removes the ${slot.role} role from ${event.date} ${event.name}${occupant}.`,
    })
  }

  // Clear all auto-generated assignments (slots tagged isGenerated), leaving
  // their role requirements in place but unassigned. Manual assignments are
  // untouched. Staged for confirmation since it's destructive — the
  // `clearGenerated` command computes the result; the UI applies on confirm.
  const handleClearGenerated = () => {
    const result = clearGenerated(undefined, { preview: true })
    if (!result.nextEvents) return
    setPendingClearGenerated({
      nextEvents: result.nextEvents,
      count: result.count,
      logEntry: result.logEntry,
      warnings: result.verdict?.warnings || [],
      prompt: `Remove ${result.count} generated assignment${result.count > 1 ? 's' : ''}?`,
      message: 'Clears every assignment tagged "generated", leaving the role slots empty. Manual assignments are kept.',
    })
  }

  // Apply the staged clear-generated action after the user confirms.
  const confirmClearGenerated = () => {
    if (!pendingClearGenerated) return
    stageEvents(pendingClearGenerated.nextEvents)
    if (pendingClearGenerated.logEntry) logAction(pendingClearGenerated.logEntry)
    setPendingClearGenerated(null)
  }

  // --- Events multi-select (bulk clear) ---
  //
  // "Clear" empties the member from each selected slot but keeps the role slot
  // (non-destructive, mirrors handleEditRosterSlot(...,null)). The whole set is
  // applied in one stageEvents call so it is a single draft/undo step.

  // Toggle one slot key (`date#roleIndex`) in the selection.
  const toggleSlotSelected = (key) => {
    setSelectedSlots(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Replace the whole selection (used by the toolbar's All / filled / generated
  // / None buttons, which compute keys from the currently-visible events).
  const setSelection = (keys) => setSelectedSlots(new Set(keys))

  // Enter select mode from a long-press / right-click on a filled pill, with
  // that slot pre-selected. This is the primary entry point (no menu needed).
  const enterSelectAt = (key) => {
    setSelectMode(true)
    setSelectedSlots(new Set(key ? [key] : []))
  }

  // Add or remove a batch of keys at once (event-level / month-level / range
  // toggles). When every key in the batch is already selected we deselect them
  // all; otherwise we add them all — a predictable tri-state group toggle.
  const toggleSlotBatch = (keys) => {
    setSelectedSlots(prev => {
      const next = new Set(prev)
      const allSelected = keys.length > 0 && keys.every(k => next.has(k))
      if (allSelected) keys.forEach(k => next.delete(k))
      else keys.forEach(k => next.add(k))
      return next
    })
  }

  // Leave select mode and drop any pending selection.
  const exitSelectMode = () => {
    setSelectMode(false)
    setSelectedSlots(new Set())
  }

  // Stage the bulk clear for confirmation (only slots that actually hold a
  // member are counted; empty/unknown keys are ignored by the command).
  const handleBulkClear = () => {
    const result = bulkClear({ selectedSlots }, { preview: true })
    if (!result.nextEvents) return
    setPendingBulkClear({
      nextEvents: result.nextEvents,
      count: result.count,
      logEntry: result.logEntry,
      warnings: result.verdict?.warnings || [],
      prompt: `Clear ${result.count} assignment${result.count > 1 ? 's' : ''}?`,
      message: 'Empties the selected assignments, leaving their role slots in place to re-fill. Nothing is deleted.',
    })
  }

  // Apply the staged bulk clear after the user confirms.
  const confirmBulkClear = () => {
    if (!pendingBulkClear) return
    stageEvents(pendingBulkClear.nextEvents)
    if (pendingBulkClear.logEntry) logAction(pendingBulkClear.logEntry)
    setPendingBulkClear(null)
    exitSelectMode()
  }

  // Check if there are unassigned roles
  const hasUnassignedRoles = events.some(event => 
    event.roster && event.roster.some(r => !r.member_id)
  )
  
  const unassignedRolesCount = events.reduce((count, event) => {
    if (!event.roster) return count
    return count + event.roster.filter(r => !r.member_id).length
  }, 0)

  if (loading) return <div className="min-h-screen bg-white/40 flex items-center justify-center"><div className="text-gray-600">Loading...</div></div>
  if (error) return <ErrorDisplay title={error.type === 'validation' ? 'Validation Errors' : 'Loading Error'} message={error.message} hint={error.type === 'load' ? 'Check YAML file syntax. Telegram handles need quotes.' : undefined} />

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className={`${glassPanel} border-b pt-safe`}>
        <div className="max-w-full px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-2">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <h1 className={headingPage}>Roster Builder</h1>
              {rosterPeriod && rosterPeriod.start_date && rosterPeriod.end_date && (
                <div className={`text-xs sm:text-sm font-medium px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg w-fit ${monoChip}`}>
                  {formatDateRange(rosterPeriod.start_date, rosterPeriod.end_date)}
                </div>
              )}
            </div>
            {/* Multi-tenant Phase 1: team + roster selectors, shown when a
                nested tenant document is loaded (local mode). Team sits ABOVE
                roster; switching team resets to that team's first roster. */}
            {teams.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-gray-600">
                {teams.length > 1 && (
                  <select
                    value={activeTeamId || ''}
                    onChange={(e) => selectTeam(e.target.value)}
                    className="max-w-[160px] rounded-md border border-gray-300 px-2 py-1 font-medium text-gray-700 touch-manipulation"
                    title="Switch team"
                  >
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                )}
                {rosters.length > 1 && (
                  <select
                    value={activeRosterId || ''}
                    onChange={(e) => selectRoster(e.target.value)}
                    className="max-w-[160px] rounded-md border border-gray-300 px-2 py-1 font-medium text-gray-700 touch-manipulation"
                    title="Switch roster"
                  >
                    {rosters.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
            {auth?.mode === 'production' && auth.user && (
              <div className="flex items-center gap-2 text-xs text-gray-600">
                {rosters.length > 1 && (
                  <select
                    value={activeRosterId || ''}
                    onChange={(e) => selectRoster(e.target.value)}
                    className="max-w-[160px] rounded-md border border-gray-300 px-2 py-1 font-medium text-gray-700 touch-manipulation"
                    title="Switch roster"
                  >
                    {rosters.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                )}
                {role === 'owner' && (
                  <button
                    onClick={() => setShowAdmin(true)}
                    className="rounded-md border border-gray-300 px-2 py-1 font-medium text-gray-600 hover:bg-gray-100 touch-manipulation"
                    title="Manage roster & members"
                  >
                    Manage
                  </button>
                )}
                <span className="max-w-[180px] truncate">{auth.user.email}</span>
                <button
                  onClick={auth.signOut}
                  className="rounded-md border border-gray-300 px-2 py-1 font-medium text-gray-600 hover:bg-gray-100 touch-manipulation"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
          <p className="text-xs sm:text-sm text-gray-600">{activeMembers.length} members · {events.length} events</p>
          
          {/* Roster Statistics */}
          <div className="mt-3 sm:mt-4">
            <RosterStatsPanel stats={rosterStats} members={members} actionLog={actionLog} availability={availabilityByRole} />
          </div>
          
          {/* Shared Search Bar */}
          <div className="mt-3 sm:mt-4 flex sm:justify-end">
            <div className="relative w-full sm:max-w-md">
              <input
                type="text"
                placeholder="Search members and events..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`w-full px-3 sm:px-4 py-2 pr-10 text-sm sm:text-base ${glassPanel} focus:ring-2 focus:ring-gray-400/50 focus:border-transparent placeholder-gray-600 touch-manipulation`}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-700 active:text-gray-900 transition-colors touch-manipulation"
                  aria-label="Clear search"
                >
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Uncommitted-changes bar: draft edits are visible in the roster but not
          yet saved to the binding. Shows what changed + who is affected, with
          Save / Discard. Undo/redo are independent of this (see spec). Hidden
          when the draft nets to zero actual slot changes (a draft can exist yet
          be diff-empty), so the bar never reads "0 unsaved changes". */}
      {hasUncommitted && rosterDiff.slotChanges.length > 0 && permissions.canEditRoster && (
        <div ref={draftBarRef} className={`sticky top-0 ${zSticky} ${draftBar}`}>
          <div className="max-w-full px-3 sm:px-6 lg:px-8 py-2 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <div className="flex-1 min-w-0 text-sm text-amber-900">
              <button
                type="button"
                onClick={() => setShowChanges(v => !v)}
                className="inline-flex items-center gap-1 font-semibold hover:text-amber-700"
                aria-expanded={showChanges}
                title={showChanges ? 'Hide changes' : 'Review changes'}
              >
                <span className={`inline-block transition-transform ${showChanges ? 'rotate-90' : ''}`}>▸</span>
                {rosterDiff.slotChanges.length} unsaved change{rosterDiff.slotChanges.length === 1 ? '' : 's'}
              </button>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleDiscardDraft}
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 active:scale-95 transition-all touch-manipulation"
              >
                Discard
              </button>
              <button
                onClick={handleCommitDraft}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 active:scale-95 transition-all touch-manipulation"
              >
                Save changes
              </button>
            </div>
          </div>
          {showChanges && (
            <ChangeReviewPanel slotChanges={rosterDiff.slotChanges} getMemberName={getMemberName} />
          )}
        </div>
      )}

      {/* Tab switcher: Events / Members are shown one at a time at every
          breakpoint (the "separate by default" layout — no side-by-side split).
          Pins BELOW the draft bar (offset by its measured height) so the two
          sticky bars stack instead of overlapping. */}
      <div ref={tabBarRef} className={`sticky ${zSticky} flex bg-white/70 backdrop-blur-md border-b border-gray-200`} style={{ top: draftBarHeight }}>
        <button
          onClick={() => setActiveTab('events')}
          className={`flex-1 py-3 text-sm font-semibold transition-colors touch-manipulation ${activeTab === 'events' ? tabActive : tabInactive}`}
        >
          Events <span className="text-xs font-normal">({events.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('members')}
          className={`flex-1 py-3 text-sm font-semibold transition-colors touch-manipulation ${activeTab === 'members' ? tabActive : tabInactive}`}
        >
          Members <span className="text-xs font-normal">({activeMembers.length})</span>
        </button>
      </div>

      {/* Tabbed view container: only the active tab's panel is shown, at every
          breakpoint (no lg side-by-side split). */}
      <div className="flex flex-col pb-24 lg:pb-safe">
        {/* Events Section */}
        <div className={`${activeTab === 'events' ? 'block' : 'hidden'} w-full`}>
          <EventsView 
            events={events}
            members={members}
            memberConstraints={memberConstraints}
            roleColorMap={roleColorMap}
            roles={roles}
            searchQuery={searchQuery}
            validationResults={validationResults}
            onEditRosterSlot={permissions.canEditRoster ? handleEditRosterSlot : undefined}
            onSwapRosterSlots={permissions.canEditRoster ? handleSwapRosterSlots : undefined}
            onAddRosterSlot={permissions.canEditRoster ? handleAddRosterSlot : undefined}
            onRemoveRosterSlot={permissions.canEditRoster ? handleRemoveRosterSlot : undefined}
            onClearGenerated={permissions.canEditRoster ? handleClearGenerated : undefined}
            selectMode={permissions.canEditRoster ? selectMode : false}
            selectedSlots={selectedSlots}
            onEnterSelectAt={permissions.canEditRoster ? enterSelectAt : undefined}
            onExitSelectMode={exitSelectMode}
            onToggleSlotSelected={toggleSlotSelected}
            onToggleSlotBatch={toggleSlotBatch}
            onSetSelection={setSelection}
            onBulkClear={handleBulkClear}
            stickyTop={draftBarHeight + tabBarHeight}
            yamlData={data}
            rosterDiff={hasUncommitted ? rosterDiff : null}
          />
        </div>

        {/* Members Section */}
        <div className={`${activeTab === 'members' ? 'block' : 'hidden'} w-full pb-4`}>
          <MembersView 
            members={members}
            roles={roles}
            roleColorMap={roleColorMap}
            warnings={data?.warnings}
            searchQuery={searchQuery}
            memberConstraints={memberConstraints}
            memberPreferences={memberPreferences}
            activeTeamName={activeTeamName}
            memberTeams={memberTeams}
          />
        </div>
      </div>

      {/* Floating action buttons — all standardized to h-12 w-12 */}
      {!showDrawer && (
        <div className={`fixed right-4 ${zPopover} flex flex-col items-end gap-2 bottom-safe sm:right-6`}>
          {hasUnassignedRoles && permissions.canEditRoster && (
            <HoverCard
              placement="left"
              tapToggles={false}
              onPanelClick={() => setShowAlgorithmModal(true)}
              panelClassName={`w-72 p-3 text-left text-xs leading-relaxed text-gray-700 cursor-pointer ${glassPanel}`}
              trigger={
                <GlassFab
                  onClick={handleGenerateRoster}
                  className="relative h-12 w-12 text-[11px] font-semibold uppercase tracking-wide"
                  title="Generate roster"
                >
                  Auto
                  {unassignedRolesCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-gray-700 px-1 text-xs font-bold text-white shadow">
                      {unassignedRolesCount}
                    </span>
                  )}
                </GlassFab>
              }
            >
              <div className={`mb-1 ${tierSection}`}>How generation works</div>
              <p className="whitespace-pre-line">{getAlgorithmDescription()}</p>
              <div className="mt-2 text-[11px] font-medium text-gray-500">Click for full details · generation is undoable</div>
            </HoverCard>
          )}
          {canUndo && permissions.canUndo && (
            <GlassFab
              onClick={handleUndo}
              className="h-12 w-12"
              title="Undo (Ctrl/Cmd+Z)"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h11a4 4 0 0 1 0 8h-1M3 10l4-4M3 10l4 4" />
              </svg>
            </GlassFab>
          )}
          {canRedo && permissions.canUndo && (
            <GlassFab
              onClick={handleRedo}
              className="h-12 w-12"
              title="Redo (Ctrl/Cmd+Shift+Z)"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 10H10a4 4 0 0 0 0 8h1M21 10l-4-4M21 10l-4 4" />
              </svg>
            </GlassFab>
          )}
          {permissions.canImport && (
            <GlassFab
              onClick={() => setShowDrawer(true)}
              className="h-12 w-12 text-base font-mono"
              title="View & edit YAML"
            >
              {'{ }'}
            </GlassFab>
          )}
          {showScrollTop ? (
            <GlassFab
              onClick={scrollToTop}
              className="h-12 w-12"
              title="Scroll to top"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
            </GlassFab>
          ) : activeTab === 'events' ? (
            <GlassFab
              onClick={scrollToToday}
              className="h-12 w-12"
              title="Jump to today"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </GlassFab>
          ) : null}
        </div>
      )}

      {/* Two-way YAML editor drawer — owner-only in production */}
      {permissions.canImport && (
        <YamlDrawer
          open={showDrawer}
          onClose={() => setShowDrawer(false)}
          data={data}
          onReplace={stageDocument}
          onImport={handleImport}
        />
      )}

      {/* Owner admin panel (production) */}
      <AdminModal open={showAdmin} onClose={() => setShowAdmin(false)} roster={roster} />

      {/* Invalid-swap toast. Sits above the floating month selector (which is
          centered at the very bottom) so the two don't overlap. */}
      {swapNotice && (
        <div className={`fixed bottom-20 left-1/2 ${zToast} -translate-x-1/2 rounded-lg px-4 py-2 text-sm shadow-lg ${semanticError}`}>
          {swapNotice}
        </div>
      )}
      {/* Edit-warning toast (amber): a warn-still-apply command applied but a
          rule verdict flagged something (e.g. member unavailable). Heads-up,
          not a block — see specs/session.md. */}
      {editWarning && (
        <div className={`fixed bottom-20 left-1/2 ${zToast} -translate-x-1/2 max-w-md rounded-lg px-4 py-2 text-sm shadow-lg ${semanticWarning}`}>
          {editWarning}
        </div>
      )}
      {/* Generation-complete toast (neutral; detail lives in the stats panel) */}
      {generationNotice && (
        <div className={`fixed bottom-20 left-1/2 ${zToast} -translate-x-1/2 rounded-lg px-4 py-2 text-sm text-white shadow-lg bg-gray-800/90 backdrop-blur-md`}>
          {generationNotice}
        </div>
      )}
      {/* Swap confirmation (drag-and-drop rewrites two slots — loss-ful) */}
      {pendingSwap && (
        <div className={`fixed inset-0 ${zModal} flex items-center justify-center p-4 ${modalBackdrop}`} onClick={() => setPendingSwap(null)}>
          <div className={`w-full max-w-sm p-4 sm:p-6 ${glassModal}`} onClick={e => e.stopPropagation()}>
            <h2 className={headingModal}>{pendingSwap.isMove ? 'Confirm move' : 'Confirm swap'}</h2>
            <div className="mt-4 space-y-2">
              {[pendingSwap.slotA, pendingSwap.slotB].map((slot, i) => (
                <div key={i} className={`flex items-center gap-3 rounded-lg p-2.5 ${glassCard}`}>
                  <div className="min-w-0 flex-1">
                    <div className={tierSection}>
                      {formatDate(slot.date)} · {slot.role}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-900">
                      <span className={slot.before === slot.after ? '' : 'text-gray-400 line-through'}>{slot.before}</span>
                      {slot.before !== slot.after && (
                        <>
                          <span className="text-gray-400">→</span>
                          <span className="font-semibold">{slot.after}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingSwap(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-500/10 touch-manipulation"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmSwap}
                className={`px-4 py-2 text-sm ${btnPrimary} touch-manipulation`}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Role-slot removal confirmation (removes an entire role requirement) */}
      {pendingRemoveSlot && (
        <div className={`fixed inset-0 ${zModal} flex items-center justify-center p-4 ${modalBackdrop}`} onClick={() => setPendingRemoveSlot(null)}>
          <div className={`w-full max-w-sm p-5 ${glassModal}`} onClick={e => e.stopPropagation()}>
            <p className="text-base font-semibold text-gray-900">{pendingRemoveSlot.prompt}</p>
            <p className="mt-1 text-sm text-gray-600">{pendingRemoveSlot.message}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingRemoveSlot(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-500/10 touch-manipulation"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmRemoveSlot}
                className={`px-4 py-2 text-sm ${btnDanger} touch-manipulation`}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Clear-generated confirmation (removes all auto-generated assignments) */}
      {pendingClearGenerated && (
        <div className={`fixed inset-0 ${zModal} flex items-center justify-center p-4 ${modalBackdrop}`} onClick={() => setPendingClearGenerated(null)}>
          <div className={`w-full max-w-sm p-5 ${glassModal}`} onClick={e => e.stopPropagation()}>
            <p className="text-base font-semibold text-gray-900">{pendingClearGenerated.prompt}</p>
            <p className="mt-1 text-sm text-gray-600">{pendingClearGenerated.message}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingClearGenerated(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-500/10 touch-manipulation"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmClearGenerated}
                className={`px-4 py-2 text-sm ${btnDanger} touch-manipulation`}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Bulk-clear confirmation (empties multiple selected assignments) */}
      {pendingBulkClear && (
        <div className={`fixed inset-0 ${zModal} flex items-center justify-center p-4 ${modalBackdrop}`} onClick={() => setPendingBulkClear(null)}>
          <div className={`w-full max-w-sm p-5 ${glassModal}`} onClick={e => e.stopPropagation()}>
            <p className="text-base font-semibold text-gray-900">{pendingBulkClear.prompt}</p>
            <p className="mt-1 text-sm text-gray-600">{pendingBulkClear.message}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingBulkClear(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-500/10 touch-manipulation"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmBulkClear}
                className={`px-4 py-2 text-sm ${btnDanger} touch-manipulation`}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Algorithm Description Modal (on-demand explainer, opened from the info FAB) */}
      {showAlgorithmModal && (
        <AlgorithmDescriptionModal
          description={getAlgorithmDescription()}
          onClose={() => setShowAlgorithmModal(false)}
        />
      )}
    </div>
  )
}

export default App

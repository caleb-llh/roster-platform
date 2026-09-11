import { useState, useRef, useEffect } from 'react'
import { glassMenu, glassPopup, hoverRow, btnDanger, monoChip, zInCard } from '../design/designSystem'
import { HoverCard } from './SharedComponents'

/**
 * A single roster slot rendered as a pillbox with an inline dropdown picker.
 *
 * - Assigned: shows the member name as a filled pill (with a small × to remove
 *   and click-to-replace). Filled pills are draggable.
 * - Unassigned: shows a dashed placeholder pill ("+ Assign") that opens the picker.
 *
 * The picker only lists members who are eligible for the role AND available on
 * the event date AND not already assigned elsewhere in the event — so inserts
 * and replacements always respect availability.
 *
 * Drag-and-drop: drag a member pill onto another slot to swap (or move into an
 * empty slot). The drop is validated by `onSwap`, which runs the same role /
 * availability / once-per-event checks as the picker.
 */
const DRAG_MIME = 'application/x-roster-slot'

export default function RosterSlotPill({
  slot,
  role,
  roleColorClass,
  memberId,
  memberLabel,
  isGenerated,
  diffChange,
  availableMembers = [],
  onSelect,
  onRemove,
  onRemoveSlot,
  onSwap,
  onOpenChange,
  selectMode = false,
  selected = false,
  onToggleSelect,
  onEnterSelectAt,
}) {
  const [open, setOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  // Pending loss-ful action awaiting confirmation:
  //  { type: 'remove' } or { type: 'replace', id, name }. null when none.
  const [confirming, setConfirming] = useState(null)
  const ref = useRef(null)
  // Long-press timer: touch-and-hold a filled pill to enter select mode.
  const longPressRef = useRef(null)

  // Notify the parent when this pill's overlay (picker or confirm) opens or
  // closes so the enclosing card can lift its stacking context above siblings.
  useEffect(() => {
    onOpenChange?.(open || Boolean(confirming))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, confirming])

  useEffect(() => {
    if (!open && !confirming) return
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false)
        setConfirming(null)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open, confirming])

  // Clear any pending long-press timer on unmount.
  useEffect(() => () => clearTimeout(longPressRef.current), [])

  // Candidates: available and not the current occupant.
  const candidates = availableMembers.filter(m => m.available && m.id !== memberId)

  // Choosing a candidate: replacing an existing occupant is loss-ful, so it
  // asks for confirmation first; assigning into an empty slot applies directly.
  const handleSelect = (id) => {
    if (memberId) {
      const name = candidates.find(m => m.id === id)?.name || id
      setOpen(false)
      setConfirming({ type: 'replace', id, name })
    } else {
      onSelect(id)
      setOpen(false)
    }
  }

  // Removing an occupant is loss-ful, so it asks for confirmation first.
  const handleRemoveClick = () => {
    setOpen(false)
    setConfirming({ type: 'remove' })
  }

  const confirmAction = () => {
    if (confirming?.type === 'remove') onRemove()
    else if (confirming?.type === 'replace') onSelect(confirming.id)
    setConfirming(null)
  }

  const editable = Boolean(onSelect)

  // --- Drag-and-drop (only when swapping is enabled) ---
  const handleDragStart = (e) => {
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(slot))
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e) => {
    if (!onSwap || !e.dataTransfer.types.includes(DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!dragOver) setDragOver(true)
  }

  const handleDragLeave = () => setDragOver(false)

  const handleDrop = (e) => {
    setDragOver(false)
    const raw = e.dataTransfer.getData(DRAG_MIME)
    if (!raw) return
    e.preventDefault()
    try {
      const source = JSON.parse(raw)
      onSwap?.(source, slot)
    } catch {
      // ignore malformed payloads
    }
  }

  const canDrag = Boolean(onSwap && memberId)

  // In multi-select mode a FILLED slot becomes a selection toggle: the member
  // pill no longer opens the picker or drags — clicking it (de)selects the slot
  // for bulk clear. Empty slots are not selectable (nothing to clear).
  const selecting = Boolean(selectMode && memberId && onToggleSelect)

  // Enter select-mode gestures on a FILLED pill (only when NOT already in
  // select mode). Long-press for touch, right-click (contextmenu) for desktop —
  // both avoid clashing with left-click (picker) and left-drag (swap).
  const canEnterSelect = Boolean(!selectMode && memberId && onEnterSelectAt)

  const startLongPress = () => {
    if (!canEnterSelect) return
    clearTimeout(longPressRef.current)
    longPressRef.current = setTimeout(() => onEnterSelectAt(), 500)
  }
  const cancelLongPress = () => clearTimeout(longPressRef.current)

  const handleContextMenu = (e) => {
    if (!canEnterSelect) return
    e.preventDefault()
    onEnterSelectAt()
  }

  // Inline uncommitted-change marker (draft vs. last saved): just a small
  // colored dot in the corner, so pending edits are visible in place without
  // clutter. Hovering the dot reveals what changed.
  const diffMeta = diffChange && {
    changed: { cls: 'bg-amber-500', label: 'Changed' },
    added: { cls: 'bg-emerald-500', label: 'Added' },
    removed: { cls: 'bg-rose-500', label: 'Removed' },
  }[diffChange.status]

  return (
    <div
      className="relative inline-flex items-center"
      ref={ref}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {diffMeta && (
        <span
          className="absolute -left-1 -top-1 z-10"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <HoverCard
            placement="bottom"
            align="start"
            panelClassName={`w-max max-w-[16rem] px-2 py-1 text-[11px] leading-tight ${glassPopup}`}
            trigger={<span className={`block h-2 w-2 rounded-full ring-2 ring-white ${diffMeta.cls}`} />}
          >
            <span className="font-semibold text-slate-800">{diffMeta.label} · unsaved</span>
            <br />
            <span className="text-slate-500">{diffChange.role}: </span>
            {diffChange.status === 'added' ? (
              <span>{diffChange.afterLabel || 'unassigned'}</span>
            ) : diffChange.status === 'removed' ? (
              <span className="line-through">{diffChange.beforeLabel || 'unassigned'}</span>
            ) : (
              <span>
                <span className="line-through text-slate-400">{diffChange.beforeLabel || 'unassigned'}</span>
                {' → '}
                <span>{diffChange.afterLabel || 'unassigned'}</span>
              </span>
            )}
          </HoverCard>
        </span>
      )}
      <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-gray-200/70 bg-white/30 text-xs font-medium ${roleColorClass}`}>
        {role}
        {onRemoveSlot && (
          <button
            type="button"
            onClick={onRemoveSlot}
            className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-60 hover:bg-red-500/20 hover:text-red-700 hover:opacity-100"
            title="Remove this role from the event"
          >
            ×
          </button>
        )}
      </span>

      {memberId ? (
        <span
          className={`ml-1.5 inline-flex items-center gap-1 rounded-full border bg-white/70 pl-2 pr-1 py-0.5 text-xs text-gray-800 transition-colors ${selecting && selected ? 'border-gray-600 ring-1 ring-gray-500' : dragOver ? 'border-gray-500 ring-1 ring-gray-400' : 'border-gray-300'} ${selecting ? 'cursor-pointer' : canDrag ? 'cursor-grab active:cursor-grabbing' : ''}`}
          draggable={canDrag && !selecting}
          onDragStart={canDrag && !selecting ? handleDragStart : undefined}
          onClick={selecting ? (e) => onToggleSelect(e.shiftKey) : undefined}
          onContextMenu={handleContextMenu}
          onTouchStart={startLongPress}
          onTouchEnd={cancelLongPress}
          onTouchMove={cancelLongPress}
          title={selecting ? 'Click to select (Shift-click for a range)' : canDrag ? 'Drag to swap · long-press or right-click to select' : undefined}
        >
          {selecting && (
            <span
              className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[9px] leading-none ${selected ? 'border-gray-700 bg-gray-800 text-white' : 'border-gray-400 bg-white/70 text-transparent'}`}
              aria-hidden="true"
            >
              ✓
            </span>
          )}
          <button
            type="button"
            onClick={() => !selecting && editable && setOpen(o => !o)}
            className="max-w-[140px] truncate hover:text-gray-900"
            title={!selecting && editable ? 'Replace member' : undefined}
            tabIndex={selecting ? -1 : undefined}
          >
            {memberLabel}
          </button>
          {isGenerated && (
            <span className={`px-1 text-[10px] font-medium rounded ${monoChip}`} title="Auto-generated by algorithm">
              gen
            </span>
          )}
          {editable && !selecting && (
            <button
              type="button"
              onClick={handleRemoveClick}
              className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-gray-400 hover:bg-red-100 hover:text-red-600"
              title="Remove member"
            >
              ×
            </button>
          )}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => editable && setOpen(o => !o)}
          disabled={!editable}
          className={`ml-1.5 inline-flex items-center rounded-full border border-dashed px-2 py-0.5 text-xs transition-colors ${dragOver ? 'border-gray-500 bg-gray-500/10 text-gray-700 ring-1 ring-gray-400' : 'border-gray-400 bg-white/40 text-gray-500 hover:border-gray-600 hover:text-gray-800'} ${editable ? '' : 'cursor-default opacity-60'}`}
          title={editable ? 'Assign member' : undefined}
        >
          {editable ? '+ Assign' : 'Unassigned'}
        </button>
      )}

      {open && editable && !confirming && (
        <div className={`absolute left-0 top-full ${zInCard} mt-1 max-h-52 w-52 overflow-y-auto ${glassMenu}`}>
          {candidates.length === 0 ? (
            <div className="px-3 py-2 text-xs italic text-gray-400">
              No available members
            </div>
          ) : (
            candidates.map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => handleSelect(m.id)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs text-gray-700 ${hoverRow}`}
              >
                <span className="truncate">{m.name}</span>
                {m.isUnderstudy && (
                  <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-700" title="Promoted understudy — trained for this role">
                    understudy
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}

      {confirming && editable && (
        <div className={`absolute left-0 top-full ${zInCard} mt-1 w-56 p-3 ${glassMenu}`}>
          <p className="text-xs text-gray-700">
            {confirming.type === 'remove'
              ? <>Remove <span className="font-semibold">{memberLabel}</span> from this slot?</>
              : <>Replace <span className="font-semibold">{memberLabel}</span> with <span className="font-semibold">{confirming.name}</span>?</>}
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(null)}
              className="rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-500/10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmAction}
              className={`${btnDanger} !rounded px-2 py-1 text-xs`}
            >
              {confirming.type === 'remove' ? 'Remove' : 'Replace'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

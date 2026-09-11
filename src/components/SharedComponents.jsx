// Shared components for the application
import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { semanticError, glassMenu, tierSection, glassCard, glassFab, tierLabel, zPopover } from '../design/designSystem'

/**
 * Close the popup when a mousedown lands outside `ref`. Shared by the various
 * click-to-open dropdowns/menus so the outside-click behaviour is identical.
 */
export const useClickOutside = (ref, onOutside, active = true) => {
  useEffect(() => {
    if (!active) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onOutside() }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [ref, onOutside, active])
}

/**
 * Standardised hover/tap popover so all hover popups behave the same:
 *
 *  - **No dead gap.** The trigger and the floating panel share one hover
 *    region, so moving the cursor from the trigger onto the panel never
 *    crosses un-hovered space. (The old Auto explainer used an `mr-3` margin
 *    gap and vanished the moment the cursor entered it.)
 *  - **Close delay.** Leaving either the trigger or the panel starts a short
 *    timer; entering the other cancels it — so a small overlap/scrollbar hop
 *    doesn't dismiss it. This lets you move onto the panel and scroll.
 *  - **Touch = tap.** Pointers that can't hover toggle on tap instead, and an
 *    outside tap closes it. Desktop keeps hover + focus.
 *  - **Never spills off-screen (DYNAMIC).** The panel is rendered `position:
 *    fixed` and, after it mounts, its position is *measured* against the
 *    viewport and clamped into it with an 8px margin. `placement` is the
 *    preferred side, but the panel FLIPS to the opposite side if it won't fit,
 *    and its `maxHeight`/`maxWidth` are set to the available space so tall
 *    content scrolls *within the viewport* instead of growing past the edge.
 *    Recomputed on open, resize, and scroll. This replaced static
 *    `left-1/2 -translate-x-1/2` classes, which centred the panel on the
 *    trigger and let it spill (e.g. a dot near the left edge).
 *
 * `panelClassName` styles the panel surface (pass a glass token). The trigger
 * is rendered as-is (it may be a button with its own onClick); `tapToggles`
 * (default true) lets a tap on the trigger open/close the panel on touch — set
 * it false when the trigger has its own primary tap action (e.g. the Auto FAB
 * generates on tap, so it must not also toggle the card).
 */
const CLOSE_DELAY_MS = 140
const VIEWPORT_MARGIN = 8 // px kept between the panel and every viewport edge
const GAP = 8 // px between the trigger and the panel
export const HoverCard = ({
  trigger,
  children,
  placement = 'top',
  align = 'center', // cross-axis anchoring: 'center' | 'start'
  panelClassName = '',
  onPanelClick,
  tapToggles = true,
}) => {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null) // { left, top, maxWidth, maxHeight }
  const containerRef = useRef(null)
  const panelRef = useRef(null)
  const timerRef = useRef(null)
  const rafRef = useRef(null)

  const cancelClose = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null } }
  const scheduleClose = () => { cancelClose(); timerRef.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS) }
  useEffect(() => () => cancelClose(), [])
  // Close on outside tap. The panel is portaled to <body> (see below), so it is
  // NOT inside containerRef — treat a click within the panel as "inside" too.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (containerRef.current?.contains(e.target)) return
      if (panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Measure trigger + panel against the viewport and clamp/flip so the panel is
  // always fully on-screen. Runs after the panel mounts and whenever the
  // viewport changes while it is open.
  const reposition = useCallback(() => {
    const anchor = containerRef.current
    const panel = panelRef.current
    // The panel is portaled, so on the very first layout pass its ref may not
    // be attached yet (or it has 0 size before paint). Retry next frame so
    // `pos` always resolves — otherwise the panel stays `visibility: hidden`
    // and appears not to show up at all.
    if (!anchor || !panel || panel.offsetWidth === 0) {
      rafRef.current = requestAnimationFrame(reposition)
      return
    }
    const a = anchor.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const space = {
      top: a.top - VIEWPORT_MARGIN - GAP,
      bottom: vh - a.bottom - VIEWPORT_MARGIN - GAP,
      left: a.left - VIEWPORT_MARGIN - GAP,
      right: vw - a.right - VIEWPORT_MARGIN - GAP,
    }
    const pw = panel.offsetWidth
    const ph = panel.offsetHeight
    const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
    let side = placement
    const need = (placement === 'top' || placement === 'bottom') ? ph : pw
    if (space[side] < need && space[opposite[side]] > space[side]) side = opposite[side]

    const maxHeight = (side === 'top' ? space.top : side === 'bottom' ? space.bottom : vh - VIEWPORT_MARGIN * 2)

    let left, top
    if (side === 'top' || side === 'bottom') {
      top = side === 'top' ? a.top - GAP - ph : a.bottom + GAP
      // 'start' anchors the panel's left edge at the trigger centre so a wide
      // panel over a tiny anchor (e.g. the 8px diff dot) stays visually next to
      // it instead of being centred and pushed away by edge-clamping.
      left = align === 'start' ? a.left + a.width / 2 : a.left + a.width / 2 - pw / 2
    } else {
      left = side === 'left' ? a.left - GAP - pw : a.right + GAP
      top = align === 'start' ? a.top + a.height / 2 : a.top + a.height / 2 - ph / 2
    }
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - pw - VIEWPORT_MARGIN))
    top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - ph - VIEWPORT_MARGIN))
    setPos({ left, top, maxHeight: Math.max(80, maxHeight) })
  }, [placement, align])

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    reposition()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, reposition])

  return (
    <span
      ref={containerRef}
      className="relative inline-flex"
      onMouseEnter={() => { cancelClose(); setOpen(true) }}
      onMouseLeave={scheduleClose}
      onFocus={() => { cancelClose(); setOpen(true) }}
      onBlur={scheduleClose}
      onClick={tapToggles ? () => setOpen((v) => !v) : undefined}
    >
      {trigger}
      {open && createPortal(
        <div
          ref={panelRef}
          role="tooltip"
          onClick={onPanelClick}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          style={{
            position: 'fixed',
            left: pos?.left ?? -9999,
            top: pos?.top ?? -9999,
            maxHeight: pos?.maxHeight,
            overflowY: 'auto',
            visibility: pos ? 'visible' : 'hidden',
          }}
          className={`${zPopover} max-w-[calc(100vw-1rem)] ${panelClassName}`}
        >
          {children}
        </div>,
        document.body
      )}
    </span>
  )
}

/** Standard modal "×" close button. */
export const ModalCloseButton = ({ onClick, className = '' }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label="Close"
    className={`text-gray-400 hover:text-gray-600 transition-colors ${className}`}
  >
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  </button>
)

/** Standard modal header: title (headingModal-ish) + close button on one bar.
 *  Any `children` render next to the title (e.g. a status badge). */
export const ModalHeader = ({ title, onClose, children }) => (
  <div className="flex items-center justify-between border-b border-white/40 px-4 sm:px-6 py-3 sm:py-4">
    <div className="flex min-w-0 items-center gap-2">
      <h2 className="text-lg font-semibold tracking-tight text-gray-900">{title}</h2>
      {children}
    </div>
    {onClose && <ModalCloseButton onClick={onClose} />}
  </div>
)

/** Glass stat tile: a big number with an uppercase caption below. */
export const StatTile = ({ value, label, className = '' }) => (
  <div className={`${glassCard} p-3 text-center ${className}`}>
    <div className="text-2xl font-bold text-gray-800">{value}</div>
    <div className={`mt-1 ${tierLabel}`}>{label}</div>
  </div>
)

/** Round glass floating action button. */
export const GlassFab = ({ onClick, disabled, title, className = '', children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`${glassFab} disabled:opacity-40 disabled:pointer-events-none ${className}`}
  >
    {children}
  </button>
)

// Compact validation summary: coloured dot(s) + count(s) with a disclosure
// caret that toggles a dropdown listing the individual issues. Used next to
// the Events and Members headings so both surfaces present errors/warnings the
// same way (click to open — no hover). Each item is { level, label?, msg }.
export const IssueSummary = ({ errorCount = 0, warningCount = 0, items = [] }) => {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useClickOutside(ref, () => setOpen(false), open)

  if (errorCount === 0 && warningCount === 0) return null

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label="View validation issues"
        className="flex items-center gap-1.5 text-xs font-semibold"
      >
        {errorCount > 0 && (
          <span className="flex items-center gap-1 text-red-600">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400" />
            {errorCount}
          </span>
        )}
        {warningCount > 0 && (
          <span className="flex items-center gap-1 text-amber-600">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
            {warningCount}
          </span>
        )}
        <span className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <div className={`absolute left-0 top-full ${zPopover} mt-1 w-72 max-h-64 overflow-y-auto p-2 ${glassMenu}`}>
          <div className={`px-1 pb-1 ${tierSection}`}>
            {errorCount} {errorCount === 1 ? 'Error' : 'Errors'} · {warningCount} {warningCount === 1 ? 'Warning' : 'Warnings'}
          </div>
          <ul className="space-y-1">
            {items.map((issue, idx) => (
              <li key={idx} className="flex items-start gap-1.5 rounded px-1 py-0.5 text-xs">
                <span className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${issue.level === 'error' ? 'bg-red-400' : 'bg-amber-400'}`} />
                <span className="text-gray-600">
                  {issue.label && <span className="font-medium text-gray-800">{issue.label}</span>}
                  {issue.label ? ' — ' : ''}{issue.msg}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export const ErrorDisplay = ({ title, message, hint }) => (
  <div className="min-h-screen bg-slate-50 p-8">
    <div className="max-w-4xl mx-auto">
      <div className={`p-6 rounded-lg ${semanticError}`}>
        <div className="flex items-center mb-2">
          <svg className="w-6 h-6 text-red-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h2 className="text-lg font-semibold tracking-tight text-red-800">{title}</h2>
        </div>
        {typeof message === 'string' ? (
          <p className="text-red-700 font-mono text-sm">{message}</p>
        ) : (
          <ul className="space-y-2">
            {message.map((err, i) => (
              <li key={i} className="text-red-700 text-sm flex items-start">
                <span className="mr-2">•</span>
                <span>{err}</span>
              </li>
            ))}
          </ul>
        )}
        {hint && <p className="mt-4 text-red-600 text-sm">{hint}</p>}
      </div>
    </div>
  </div>
)


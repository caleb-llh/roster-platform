import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { zPopover } from '../design/designSystem'

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

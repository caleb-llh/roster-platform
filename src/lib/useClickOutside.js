import { useEffect } from 'react'

/**
 * Close the popup when a mousedown lands outside `ref`. Shared by the various
 * click-to-open dropdowns/menus so the outside-click behaviour is identical.
 *
 * Domain-free (no roster/design knowledge) — a generic DOM hook, so it lives in
 * `lib/`. The single-ref inline copies (EventsView's add-role + card menu,
 * RosterSlotPill's picker) were consolidated onto this (audit B5). HoverCard is
 * deliberately *not* a consumer: it excludes two refs (trigger + portaled
 * panel), a different contract than this single-ref hook.
 */
export const useClickOutside = (ref, onOutside, active = true) => {
  useEffect(() => {
    if (!active) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onOutside() }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [ref, onOutside, active])
}

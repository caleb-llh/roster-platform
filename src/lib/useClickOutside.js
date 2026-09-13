import { useEffect } from 'react'

/**
 * Close the popup when a mousedown lands outside `ref`. Shared by the various
 * click-to-open dropdowns/menus so the outside-click behaviour is identical.
 *
 * Domain-free (no roster/design knowledge) — a generic DOM hook, so it lives in
 * `lib/`. Consolidating the inline copies scattered across components onto this
 * one is tracked as audit B5.
 */
export const useClickOutside = (ref, onOutside, active = true) => {
  useEffect(() => {
    if (!active) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onOutside() }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [ref, onOutside, active])
}

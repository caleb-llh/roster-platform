import { detectMode } from '../data/mode'
import { useLocalRosterProvider } from '../data/useLocalRosterProvider'
import { useSupabaseRosterProvider } from '../data/useSupabaseRosterProvider'
import { useSession } from '../session/useSession'

/**
 * Dual-mode roster data hook.
 *
 * This is a thin dispatcher: it picks a pure CRUD provider based on the runtime
 * mode, then composes the Session layer on top of it (draft/undo/redo + the
 * edit command surface). Both providers satisfy the same CRUD contract and the
 * composed result satisfies the full ROSTER_PROVIDER_KEYS surface
 * (see ../data/providerContract.js), so components consuming this hook never
 * branch on mode — they read `data`, gate UI on `permissions`, and call the
 * async mutations uniformly.
 *
 *  - local      : in-memory YAML playground (useLocalRosterProvider)
 *  - production : backend + auth + DB (useSupabaseRosterProvider)
 *
 * Note: mode is fixed for the life of the app, so calling exactly one provider
 * hook per render (plus useSession unconditionally) keeps the Rules of Hooks
 * satisfied.
 *
 * @returns {import('../data/providerContract').RosterProvider}
 */
export function useRosterData() {
  const mode = detectMode()

  // One provider hook is invoked unconditionally per render. `mode` is constant
  // for the app lifetime, so this does not violate the Rules of Hooks.
  const local = mode === 'local' ? useLocalRosterProvider() : null
  const production = mode === 'production' ? useSupabaseRosterProvider() : null

  // The Session layer sits above the provider: it owns the draft/commit +
  // undo/redo overlay and the edit commands, re-exposing the full flat surface.
  return useSession(local ?? production)
}


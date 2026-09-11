import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { PROVIDER_KEYS, ROSTER_PROVIDER_KEYS } from './providerContract'
import { useLocalRosterProvider } from './useLocalRosterProvider'
import { useSupabaseRosterProvider } from './useSupabaseRosterProvider'
import { useSession } from '../session/useSession'

// Tell React we drive updates through act() (silences the act-environment warning).
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/**
 * Contract-conformance across two seams:
 *
 *  1. PROVIDER (pure CRUD): local and Supabase providers must be interchangeable
 *     — every consumer depends only on the shape, never on the concrete backend.
 *     Each *real* provider hook must return exactly PROVIDER_KEYS.
 *  2. SESSION composition: `useSession(provider)` lifts a CRUD provider to the
 *     full ROSTER_PROVIDER_KEYS surface the UI consumes (draft/undo/redo + edit
 *     commands), regardless of which provider it wraps.
 *
 * The Supabase provider is inert in tests: with no VITE_SUPABASE_* env vars its
 * `supabase` client is null, so every effect/loader early-returns and it renders
 * the same shape without any I/O.
 */

// Minimal render harness (no @testing-library dep): mount a probe component that
// runs the hook and captures its return value.
function renderHookValue(useHook) {
  const container = document.createElement('div')
  const root = createRoot(container)
  let captured
  function Probe() {
    captured = useHook()
    return null
  }
  act(() => {
    root.render(<Probe />)
  })
  const value = captured
  act(() => {
    root.unmount()
  })
  return value
}

afterEach(() => {
  // Ensure no Supabase config leaks in from the environment.
  expect(import.meta.env?.VITE_SUPABASE_URL).toBeFalsy()
})

describe('RosterProvider contract conformance', () => {
  it('the local provider returns exactly the CRUD provider keys', () => {
    const provider = renderHookValue(useLocalRosterProvider)
    expect(Object.keys(provider).sort()).toEqual([...PROVIDER_KEYS].sort())
  })

  it('the Supabase provider returns exactly the CRUD provider keys', () => {
    const provider = renderHookValue(useSupabaseRosterProvider)
    expect(Object.keys(provider).sort()).toEqual([...PROVIDER_KEYS].sort())
  })

  it('both providers expose an identical CRUD surface (interchangeable)', () => {
    const local = renderHookValue(useLocalRosterProvider)
    const supa = renderHookValue(useSupabaseRosterProvider)
    expect(Object.keys(local).sort()).toEqual(Object.keys(supa).sort())
  })

  it('useSession(provider) composes the full ROSTER_PROVIDER_KEYS surface', () => {
    const composed = renderHookValue(() => useSession(useLocalRosterProvider()))
    expect(Object.keys(composed).sort()).toEqual([...ROSTER_PROVIDER_KEYS].sort())
  })
})

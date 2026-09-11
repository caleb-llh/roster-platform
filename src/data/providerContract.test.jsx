import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ROSTER_PROVIDER_KEYS } from './providerContract'
import { useLocalRosterProvider } from './useLocalRosterProvider'
import { useSupabaseRosterProvider } from './useSupabaseRosterProvider'

// Tell React we drive updates through act() (silences the act-environment warning).
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/**
 * Contract-conformance: local and Supabase providers must be interchangeable —
 * every consumer depends only on the RosterProvider shape, never on the concrete
 * backend. This renders each *real* provider hook and asserts it returns exactly
 * the keys declared in ROSTER_PROVIDER_KEYS (the single source of truth), so the
 * two backends cannot drift apart without failing here.
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
  it('the local provider returns exactly the contract keys', () => {
    const provider = renderHookValue(useLocalRosterProvider)
    expect(Object.keys(provider).sort()).toEqual([...ROSTER_PROVIDER_KEYS].sort())
  })

  it('the Supabase provider returns exactly the contract keys', () => {
    const provider = renderHookValue(useSupabaseRosterProvider)
    expect(Object.keys(provider).sort()).toEqual([...ROSTER_PROVIDER_KEYS].sort())
  })

  it('both providers expose an identical key surface (interchangeable)', () => {
    const local = renderHookValue(useLocalRosterProvider)
    const supa = renderHookValue(useSupabaseRosterProvider)
    expect(Object.keys(local).sort()).toEqual(Object.keys(supa).sort())
  })
})

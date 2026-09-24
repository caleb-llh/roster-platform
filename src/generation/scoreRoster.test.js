import { describe, it, expect } from 'vitest'
import { scoreRoster } from './scoreRoster'
import { PREFERENCE_KEYS } from '../schema/rosterSchema'

// A zero-load tracker so the objective reflects only the roster contents under
// test (fairness/spread contribute 0). scoreRoster returns negative cost, so a
// higher (closer to 0) score is better.
const zeroTracker = { getFairnessScore: () => 0, getSpreadScore: () => 0 }

const state = (events) => ({ events, tracker: zeroTracker })

describe('scoreRoster', () => {
  it('scores a fully-filled, preference-satisfying roster at 0 (no cost)', () => {
    const events = [
      { date: '2026-01-05', day_of_week: 'Monday', roster: [{ role: 'lead', member_id: 'm1' }] },
    ]
    // scoreRoster returns -cost; a zero-cost roster is -0 (higher = better).
    expect(scoreRoster(state(events), [], {})).toBe(-0)
  })

  it('penalises empty slots heavily (1000 each)', () => {
    const events = [
      { date: '2026-01-05', day_of_week: 'Monday', roster: [{ role: 'lead', member_id: null }] },
    ]
    expect(scoreRoster(state(events), [], {})).toBe(-1000)
  })

  it('penalises a day-preference violation by the day weight', () => {
    const events = [
      { date: '2026-01-05', day_of_week: 'Monday', roster: [{ role: 'lead', member_id: 'm1' }] },
    ]
    const memberPrefs = [{ member_id: 'm1', days: ['Tuesday'] }]
    // dayPreference weight = 120.
    expect(scoreRoster(state(events), memberPrefs, {})).toBe(-120)
  })

  it('penalises a role-preference violation by the role weight', () => {
    const events = [
      { date: '2026-01-05', day_of_week: 'Monday', roster: [{ role: 'lead', member_id: 'm1' }] },
    ]
    const memberPrefs = [{ member_id: 'm1', roles: ['support'] }]
    // rolePreference weight = 120.
    expect(scoreRoster(state(events), memberPrefs, {})).toBe(-120)
  })

  it('counts consecutive-weekend violations only when AVOID_CONSECUTIVE_WEEKS is on', () => {
    // Two consecutive Saturdays for the same member.
    const events = [
      { date: '2026-01-03', day_of_week: 'Saturday', roster: [{ role: 'lead', member_id: 'm1' }] },
      { date: '2026-01-10', day_of_week: 'Saturday', roster: [{ role: 'lead', member_id: 'm1' }] },
    ]
    // Preference off -> no consecutive-weekend cost.
    expect(scoreRoster(state(events), [], {})).toBe(-0)
    // Preference on -> one violation * consecutiveWeekends weight (200).
    const prefs = { [PREFERENCE_KEYS.AVOID_CONSECUTIVE_WEEKS]: true }
    expect(scoreRoster(state(events), [], prefs)).toBe(-200)
  })
})

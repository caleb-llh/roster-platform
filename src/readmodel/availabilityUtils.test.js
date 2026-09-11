import { describe, it, expect } from 'vitest'
import { computeAvailabilityByRole, availabilityCellColor } from './availabilityUtils'

describe('computeAvailabilityByRole', () => {
  // Members are given in NORMALIZED shape (plain `roles` string arrays, plus
  // optional `understudyFor`), matching getDerivedState's output.
  const members = [
    { id: 'a', roles: ['vm'] },
    { id: 'b', roles: ['vm', 'multi-vm'] },
    { id: 'c', roles: ['multi-vm'] },
    { id: 'd', roles: ['vm'], include: false }, // excluded member
    { id: 'e', roles: [], understudyFor: ['multi-vm'] }, // trainee only
  ]
  const events = [
    { date: '2026-02-01', roster: [{ role: 'vm' }, { role: 'multi-vm' }] },
    { date: '2026-02-08', roster: [{ role: 'vm' }] },
    { date: '2026-02-15', roster: [] },
  ]
  const roles = ['vm', 'multi-vm']

  it('counts role-capable, included members with no constraints', () => {
    const { dates, series, maxCount } = computeAvailabilityByRole(events, members, roles, [])
    expect(dates).toEqual(['2026-02-01', '2026-02-08', '2026-02-15'])

    const vm = series.find(s => s.role === 'vm')
    const multi = series.find(s => s.role === 'multi-vm')
    // vm: a + b (d excluded, e is trainee-only) = 2 every date
    expect(vm.counts).toEqual([2, 2, 2])
    // multi-vm: b + c (e only understudies it, not counted) = 2 every date
    expect(multi.counts).toEqual([2, 2, 2])
    expect(maxCount).toBe(2)
  })

  it('computes required slots and slack per role/date', () => {
    const { series } = computeAvailabilityByRole(events, members, roles, [])
    const vm = series.find(s => s.role === 'vm')
    const multi = series.find(s => s.role === 'multi-vm')
    // vm slots: 1 on 02-01, 1 on 02-08, 0 on 02-15
    expect(vm.required).toEqual([1, 1, 0])
    expect(vm.slack).toEqual([1, 1, 2]) // available(2) - required
    // multi-vm slots: 1 on 02-01, 0, 0
    expect(multi.required).toEqual([1, 0, 0])
    expect(multi.slack).toEqual([1, 2, 2])
  })

  it('reports negative slack when required exceeds available', () => {
    const busy = [{ date: '2026-02-01', roster: [{ role: 'vm' }, { role: 'vm' }, { role: 'vm' }] }]
    const { series } = computeAvailabilityByRole(busy, members, roles, [])
    const vm = series.find(s => s.role === 'vm')
    expect(vm.counts).toEqual([2])
    expect(vm.required).toEqual([3])
    expect(vm.slack).toEqual([-1])
  })

  it('subtracts members who are unavailable on a given date', () => {
    const constraints = [{ member_id: 'b', unavailable_dates: ['2026-02-08'] }]
    const { series } = computeAvailabilityByRole(events, members, roles, constraints)
    const vm = series.find(s => s.role === 'vm')
    const multi = series.find(s => s.role === 'multi-vm')
    // b drops out only on 02-08
    expect(vm.counts).toEqual([2, 1, 2])
    expect(multi.counts).toEqual([2, 1, 2])
  })

  it('excludes understudy roles from the series', () => {
    const { series } = computeAvailabilityByRole(events, members, ['vm', 'multi-vm-understudy'], [])
    expect(series.map(s => s.role)).toEqual(['vm'])
  })

  it('collapses multiple events on the same date into one point', () => {
    const dup = [
      { date: '2026-02-01', roster: [{ role: 'vm' }] },
      { date: '2026-02-01', roster: [{ role: 'vm' }] },
    ]
    const { dates, series } = computeAvailabilityByRole(dup, members, roles, [])
    expect(dates).toEqual(['2026-02-01'])
    const vm = series.find(s => s.role === 'vm')
    expect(vm.counts).toEqual([2])
    // required sums across both same-date events
    expect(vm.required).toEqual([2])
    expect(vm.slack).toEqual([0])
  })

  it('handles empty inputs gracefully', () => {
    expect(computeAvailabilityByRole([], members, roles, [])).toEqual({
      dates: [],
      series: [
        { role: 'vm', counts: [], required: [], slack: [] },
        { role: 'multi-vm', counts: [], required: [], slack: [] },
      ],
      maxCount: 0,
      scale: { min: 1, max: 1 }, // no slack cells → neutral default
    })
    expect(computeAvailabilityByRole(events, [], roles, [])).toMatchObject({ maxCount: 0 })
  })

  it('derives the roster-wide slack-ratio scale from cells with real slack', () => {
    const evs = [
      { date: 'd1', roster: [{ role: 'vm' }] },                 // req 1, avail 2 -> ratio 2 (slack)
      { date: 'd2', roster: [{ role: 'vm' }, { role: 'vm' }] }, // req 2, avail 2 -> exact, excluded
      { date: 'd3', roster: [{ role: 'vm' }, { role: 'vm' }, { role: 'vm' }] }, // req 3, avail 2 -> short, excluded
    ]
    const { scale } = computeAvailabilityByRole(evs, members, ['vm'], [])
    // Only the slack cell (ratio 2) contributes; exact & short are excluded.
    expect(scale).toEqual({ min: 2, max: 2 })
  })
})

describe('availabilityCellColor', () => {
  const scale = { min: 1.5, max: 3 }

  it('returns none (neutral) when there is no demand', () => {
    const { category } = availabilityCellColor(5, 0, scale)
    expect(category).toBe('none')
  })

  it('reserves red for shortage and exact cover regardless of scale', () => {
    expect(availabilityCellColor(1, 2, scale).category).toBe('short') // available < required
    expect(availabilityCellColor(2, 2, scale).category).toBe('exact') // exactly enough
  })

  it('gives slack cells a continuous single-hue ramp colour', () => {
    const { category, color } = availabilityCellColor(6, 2, scale) // ratio 3 -> top of scale
    expect(category).toBe('slack')
    expect(color).toMatch(/^hsla\(215,/) // always the slate hue
  })

  it('deepens (lower lightness) as coverage ratio falls within the scale', () => {
    // Same hue throughout; darker slate now means thinner still-coverable bench.
    const low = availabilityCellColor(3, 2, scale)  // ratio 1.5 = min → deep
    const high = availabilityCellColor(6, 2, scale) // ratio 3 = max → pale
    const lightLow = Number(low.color.match(/(\d+)%,\s*0\.72/)[1])
    const lightHigh = Number(high.color.match(/(\d+)%,\s*0\.72/)[1])
    expect(lightLow).toBeLessThan(lightHigh)
  })

  it('defaults a flat scale to the deepest (most concerning) end', () => {
    const { color } = availabilityCellColor(3, 1, undefined) // no scale → t = 1
    const light = Number(color.match(/(\d+)%,\s*0\.72/)[1])
    expect(light).toBe(30) // RAMP_DEEP.l
  })
})

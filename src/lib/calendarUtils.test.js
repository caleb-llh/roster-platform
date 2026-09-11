import { describe, it, expect } from 'vitest'
import {
  dayKey,
  parseDayKey,
  expandUnavailableDays,
  monthsFromDays,
  monthGridCells,
} from './calendarUtils'

describe('calendarUtils', () => {
  describe('dayKey / parseDayKey', () => {
    it('round-trips a YYYY-MM-DD string without timezone drift', () => {
      expect(dayKey(parseDayKey('2026-08-01'))).toBe('2026-08-01')
      expect(dayKey(parseDayKey('2026-12-31'))).toBe('2026-12-31')
    })

    it('zero-pads single-digit months and days', () => {
      expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05')
    })
  })

  describe('expandUnavailableDays', () => {
    it('collects single date strings', () => {
      const days = expandUnavailableDays(['2026-08-02', '2026-08-09'])
      expect([...days].sort()).toEqual(['2026-08-02', '2026-08-09'])
    })

    it('expands an inclusive {start,end} range into every day', () => {
      const days = expandUnavailableDays([{ start: '2026-08-01', end: '2026-08-03' }])
      expect([...days].sort()).toEqual(['2026-08-01', '2026-08-02', '2026-08-03'])
    })

    it('dedupes overlapping single dates and ranges', () => {
      const days = expandUnavailableDays([
        '2026-08-02',
        { start: '2026-08-01', end: '2026-08-03' },
      ])
      expect(days.size).toBe(3)
    })

    it('crosses a month boundary correctly', () => {
      const days = expandUnavailableDays([{ start: '2026-08-30', end: '2026-09-01' }])
      expect([...days].sort()).toEqual(['2026-08-30', '2026-08-31', '2026-09-01'])
    })

    it('skips reversed ranges rather than looping forever', () => {
      const days = expandUnavailableDays([{ start: '2026-08-05', end: '2026-08-01' }])
      expect(days.size).toBe(0)
    })

    it('tolerates non-array / empty input', () => {
      expect(expandUnavailableDays(undefined).size).toBe(0)
      expect(expandUnavailableDays([]).size).toBe(0)
    })
  })

  describe('monthsFromDays', () => {
    it('groups days into chronologically sorted months', () => {
      const days = new Set(['2026-09-06', '2026-08-02', '2026-10-04', '2026-08-30'])
      const months = monthsFromDays(days)
      expect(months.map(m => m.key)).toEqual(['2026-08', '2026-09', '2026-10'])
      expect(months[0].month).toBe(7) // August, 0-indexed
      expect([...months[0].unavailable].sort()).toEqual(['2026-08-02', '2026-08-30'])
    })

    it('returns empty for no days', () => {
      expect(monthsFromDays(new Set())).toEqual([])
    })
  })

  describe('monthGridCells', () => {
    it('pads leading days to the correct Sunday-start weekday', () => {
      // Aug 2026: Aug 1 is a Saturday (getDay() === 6), so 6 leading pads.
      const cells = monthGridCells(2026, 7, new Set())
      const leading = cells.slice(0, 6)
      expect(leading.every(c => c === null)).toBe(true)
      expect(cells[6]).toMatchObject({ day: 1 })
    })

    it('marks unavailable days and completes whole weeks', () => {
      const cells = monthGridCells(2026, 7, new Set(['2026-08-02']))
      expect(cells.length % 7).toBe(0)
      const aug2 = cells.find(c => c && c.key === '2026-08-02')
      expect(aug2.isUnavailable).toBe(true)
      const aug3 = cells.find(c => c && c.key === '2026-08-03')
      expect(aug3.isUnavailable).toBe(false)
    })

    it('renders all days of the month', () => {
      const cells = monthGridCells(2026, 7, new Set()) // August = 31 days
      const dayCells = cells.filter(c => c !== null)
      expect(dayCells.length).toBe(31)
    })
  })
})

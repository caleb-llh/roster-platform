/**
 * Pure date helpers for the member-availability calendar.
 *
 * A member's `unavailable_dates` is a polymorphic list: entries are either a
 * single `YYYY-MM-DD` string or a `{ start, end }` inclusive range object (the
 * same shape `isMemberUnavailable` handles). The calendar needs those expanded
 * into concrete day keys and grouped by month, so the UI can render one compact
 * month grid per month that actually contains an unavailable day.
 */

// A stable, timezone-proof day key. We parse the YYYY-MM-DD parts directly
// rather than `new Date(str)` so a UTC-midnight string can't slip to the
// previous day in a negative-offset timezone.
const pad2 = (n) => String(n).padStart(2, '0')

/** `Date` -> `YYYY-MM-DD` using the date's LOCAL calendar fields. */
export const dayKey = (date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`

/** Parse `YYYY-MM-DD` into a LOCAL midnight Date (no timezone shift). */
export const parseDayKey = (str) => {
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/**
 * Expand `unavailable_dates` into a Set of `YYYY-MM-DD` day keys.
 * Ranges are inclusive of both ends. Invalid entries are skipped.
 */
export const expandUnavailableDays = (unavailableDates) => {
  const days = new Set()
  if (!Array.isArray(unavailableDates)) return days

  for (const entry of unavailableDates) {
    if (typeof entry === 'string') {
      // Normalise through parse+format so `2026-8-1` etc. still land correctly.
      const d = parseDayKey(entry)
      if (!Number.isNaN(d.getTime())) days.add(dayKey(d))
    } else if (entry && entry.start && entry.end) {
      const cur = parseDayKey(entry.start)
      const end = parseDayKey(entry.end)
      if (Number.isNaN(cur.getTime()) || Number.isNaN(end.getTime())) continue
      // Guard against reversed ranges producing an infinite loop.
      while (cur <= end) {
        days.add(dayKey(cur))
        cur.setDate(cur.getDate() + 1)
      }
    }
  }
  return days
}

/**
 * Group a Set of day keys into a sorted list of months to render.
 * @returns {Array<{ year, month, key, unavailable: Set<string> }>}
 *   `month` is 0-indexed; `key` is `YYYY-MM`; `unavailable` holds the day keys
 *   in that month. Sorted chronologically.
 */
export const monthsFromDays = (dayKeys) => {
  const byMonth = new Map()
  for (const key of dayKeys) {
    const [y, m] = key.split('-').map(Number)
    const mk = `${y}-${pad2(m)}`
    if (!byMonth.has(mk)) {
      byMonth.set(mk, { year: y, month: m - 1, key: mk, unavailable: new Set() })
    }
    byMonth.get(mk).unavailable.add(key)
  }
  return [...byMonth.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/**
 * Build the day cells for a single month grid, padded to whole weeks starting
 * on Sunday. Leading/trailing pad cells are `null`.
 * @returns {Array<null | { key, date, day, isUnavailable }>}
 */
export const monthGridCells = (year, month, unavailable) => {
  const first = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const leadingPad = first.getDay() // 0 = Sunday

  const cells = []
  for (let i = 0; i < leadingPad; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${pad2(month + 1)}-${pad2(d)}`
    cells.push({ key, date: d, day: d, isUnavailable: unavailable.has(key) })
  }
  // Trailing pad to complete the last week row.
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

export const MONTH_LABEL = (year, month) =>
  new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

export const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

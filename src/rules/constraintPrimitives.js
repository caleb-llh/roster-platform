/**
 * Constraint primitives — the shared leaf helpers that higher layers compose.
 *
 * These are pure, low-level predicates and counters (availability, week/month
 * tallies, clash detection). They do NOT own the hard-rule policy — that
 * authority lives in the CONSTRAINTS registry (constraints.js), which composes
 * these primitives. Consumers (the generator's EligibilityChecker,
 * assignmentValidator, swapPolicy) read the registry, not this file's rules
 * directly, except for the raw counters they still need.
 *
 * This file is deliberately dependency-light: it imports nothing but itself.
 * The "who can fill each slot?" availability *judge* (which composes the
 * role-capability rules + the availability descriptor) is an evaluation
 * concern and lives in `evaluation/availableMembers.js`, not here.
 */

/**
 * Check if a member is unavailable on a specific date
 * @param {string} memberId - Member ID to check
 * @param {string} eventDate - Event date in YYYY-MM-DD format
 * @param {Array} constraints - Array of constraint objects from YAML
 * @returns {boolean} - True if member is unavailable
 */
export const isMemberUnavailable = (memberId, eventDate, constraints) => {
  if (!constraints || !Array.isArray(constraints)) return false

  const constraint = constraints.find(c => c.member_id === memberId)
  if (!constraint || !constraint.unavailable_dates) return false

  const checkDate = new Date(eventDate)

  for (const dateEntry of constraint.unavailable_dates) {
    // Handle single date string
    if (typeof dateEntry === 'string') {
      const unavailableDate = new Date(dateEntry)
      if (checkDate.getTime() === unavailableDate.getTime()) {
        return true
      }
    }
    // Handle date range object
    else if (dateEntry.start && dateEntry.end) {
      const rangeStart = new Date(dateEntry.start)
      const rangeEnd = new Date(dateEntry.end)
      if (checkDate >= rangeStart && checkDate <= rangeEnd) {
        return true
      }
    }
  }

  return false
}

/**
 * Resolve an event's time span as a half-open millisecond interval `[start, end)`.
 *
 * The model is additive and lossless (see specs/data-layer.md, "Time
 * granularity"): an event may carry explicit `start`/`end` datetime strings, but
 * a bare `date` (`YYYY-MM-DD`) is the whole-day range `[date 00:00, date+1 00:00)`.
 * Date-only inputs therefore keep colliding exactly as before — the interval
 * rule *subsumes* the old same-day behaviour. Parsing is local-midnight (never
 * `new Date('YYYY-MM-DD')`, which is UTC) so a day can't slip in a negative-offset
 * timezone, matching the calendar's `parseDayKey` invariant.
 *
 * @returns {{ start: number, end: number } | null} epoch ms, or null if unparseable.
 */
export const eventInterval = (event) => {
  if (!event) return null

  // Explicit datetime range takes precedence when present.
  if (event.start) {
    const start = new Date(event.start).getTime()
    // A missing/blank end means an instantaneous point → zero-width at start.
    const end = event.end ? new Date(event.end).getTime() : start
    if (Number.isNaN(start) || Number.isNaN(end)) return null
    return { start, end: Math.max(start, end) }
  }

  if (!event.date) return null
  const [y, m, d] = String(event.date).split('-').map(Number)
  if (!y || !m || !d) return null
  const start = new Date(y, m - 1, d).getTime()
  const end = new Date(y, m - 1, d + 1).getTime() // next local midnight
  return { start, end }
}

/**
 * Do two half-open intervals `[start, end)` overlap? Touching boundaries
 * (a.end === b.start) do NOT overlap — back-to-back services are not a clash.
 */
export const intervalsOverlap = (a, b) => {
  if (!a || !b) return false
  return a.start < b.end && b.start < a.end
}

/**
 * Do two events' time spans overlap? This is the single clash rule every
 * placement-time consumer (generator, validator, swap) and the future
 * cross-team clash check are written against.
 */
export const eventsClash = (eventA, eventB) =>
  intervalsOverlap(eventInterval(eventA), eventInterval(eventB))

/**
 * Get Monday of the week for a given date
 * Week starts on Monday and ends on Sunday
 */
export const getMondayOfWeek = (date) => {
  const d = new Date(date)
  // Return null if invalid date
  if (isNaN(d.getTime())) {
    return null
  }
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day // Sunday is 0, adjust to Monday
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Get week key (Monday's date as ISO string) for grouping events by week
 */
export const getWeekKey = (date) => {
  const monday = getMondayOfWeek(date)
  // Return null if invalid date
  if (!monday) {
    return null
  }
  return monday.toISOString().split('T')[0]
}

/**
 * Is the member available on a specific date? (Inverse of isMemberUnavailable.)
 */
export const isMemberAvailable = (memberId, date, memberConstraints) => {
  return !isMemberUnavailable(memberId, date, memberConstraints)
}

/**
 * Check ONLY_ONCE_PER_EVENT constraint
 * Returns true if member is already assigned to the event roster
 */
export const isAssignedToEvent = (memberId, eventRoster) => {
  if (!eventRoster || !Array.isArray(eventRoster)) return false
  return eventRoster.some(r => r.member_id === memberId)
}

/**
 * Count assignments for a member in a specific month
 */
export const countMonthlyAssignments = (memberId, targetDate, allEvents) => {
  const targetDate_ = new Date(targetDate)
  const targetMonth = targetDate_.getMonth()
  const targetYear = targetDate_.getFullYear()
  
  return allEvents.filter(event => {
    const eventDate = new Date(event.date)
    return eventDate.getMonth() === targetMonth &&
           eventDate.getFullYear() === targetYear &&
           event.slots?.some(r => r.member_id === memberId)
  }).length
}

/**
 * Get all events where a member is assigned in the same week as target date
 */
export const getWeekAssignments = (memberId, targetDate, allEvents) => {
  const targetWeekKey = getWeekKey(targetDate)
  if (!targetWeekKey) return []  // Invalid date
  
  return allEvents.filter(event => {
    const eventWeekKey = getWeekKey(event.date)
    return eventWeekKey && eventWeekKey === targetWeekKey && 
           event.slots?.some(r => r.member_id === memberId)
  })
}

/**
 * Check if two dates are consecutive weekends
 * Returns true if date2 is the weekend immediately following date1
 */
export const areConsecutiveWeekends = (date1, date2) => {
  const d1 = new Date(date1)
  const d2 = new Date(date2)
  
  const day1 = d1.getDay()
  const day2 = d2.getDay()
  
  // Both must be weekend days
  if ((day1 !== 0 && day1 !== 6) || (day2 !== 0 && day2 !== 6)) {
    return false
  }
  
  // Calculate days difference
  const daysDiff = Math.ceil((d2 - d1) / (1000 * 60 * 60 * 24))
  
  // Consecutive weekends are 6-8 days apart
  return daysDiff >= 6 && daysDiff <= 8
}

/**
 * Get all members assigned to multiple roles in the same event
 */
export const getMembersWithMultipleRoles = (eventRoster) => {
  if (!eventRoster || !Array.isArray(eventRoster)) return []
  
  const memberRoles = {}
  eventRoster.forEach(assignment => {
    if (assignment.member_id) {
      if (!memberRoles[assignment.member_id]) {
        memberRoles[assignment.member_id] = []
      }
      memberRoles[assignment.member_id].push(assignment.role)
    }
  })
  
  return Object.entries(memberRoles)
    .filter(([_, roles]) => roles.length > 1)
    .map(([memberId, roles]) => ({ memberId, roles }))
}

// ============================================================================
// Cross-team fold (multi-tenant Phase 2)
//
// `externalAssignments` is the single cross-team primitive — a read-only
// snapshot of each member's assignments in OTHER teams' rosters, shaped
// `{ memberId: [entry, ...] }`. An entry is one of:
//   - a bare date string 'YYYY-MM-DD'            → whole-day interval
//   - a datetime string 'YYYY-MM-DDTHH:mm'       → point/day depending on end
//   - an object { date }                          → whole-day interval
//   - an object { start, end }                    → explicit half-open interval
// Every cross-team count/clash is DERIVED from this list by folding it through
// the SAME primitives local assignments use (eventInterval/eventsClash, week/
// month keys) — never a separate precomputed load, so it can't drift. All
// helpers are no-ops on an empty/absent snapshot, keeping single-team identical.
// ============================================================================

/** Normalize one externalAssignments entry to an event-like `{ date?, start?, end? }`. */
const externalEntryToEvent = (entry) => {
  if (entry == null) return null
  if (typeof entry === 'string') {
    // A datetime keeps its time (eventInterval reads `start`); a bare date is a day.
    return entry.includes('T') ? { start: entry } : { date: entry }
  }
  if (typeof entry === 'object') {
    if (entry.start) return { start: entry.start, end: entry.end }
    if (entry.date) return { date: entry.date }
  }
  return null
}

/**
 * A member's external assignments as event-like objects (for clash checks).
 * Each carries a one-slot `slots` array naming the member so the shared
 * `no-clash` descriptor — which asks `other.slots.some(s => s.member_id === …)`
 * — matches unchanged; and a `_external: true` marker so consumers can word the
 * message as a cross-team clash. `date` is set (falling back from an explicit
 * start) so the descriptor's `params.otherDate` is always populated.
 */
export const externalEventsFor = (memberId, externalAssignments) => {
  const entries = (externalAssignments && externalAssignments[memberId]) || []
  return entries
    .map(externalEntryToEvent)
    .filter(Boolean)
    .map(e => ({ ...e, date: e.date || e.start, _external: true, slots: [{ member_id: memberId }] }))
}

/** Count a member's external assignments falling in the SAME week as `date`. */
export const externalWeeklyCount = (memberId, date, externalAssignments) => {
  const target = getWeekKey(date)
  if (!target) return 0
  return externalEventsFor(memberId, externalAssignments).filter(e => {
    const d = e.date || e.start
    return d && getWeekKey(d) === target
  }).length
}

/** Count a member's external assignments falling in the SAME month as `date`. */
export const externalMonthlyCount = (memberId, date, externalAssignments) => {
  const t = new Date(date)
  const tm = t.getMonth()
  const ty = t.getFullYear()
  return externalEventsFor(memberId, externalAssignments).filter(e => {
    const d = new Date(e.date || e.start)
    return !Number.isNaN(d.getTime()) && d.getMonth() === tm && d.getFullYear() === ty
  }).length
}

import { understudySlotRole, isUnderstudyRole } from '../schema/understudyRoles'

/**
 * Roster → tabular export projection (CSV / clipboard-TSV).
 *
 * A read-only **view** of the roster as a wide table: one row per event, one
 * column per role slot. It lives in `readmodel/` beside the other aggregate
 * views (stats, charts, diff) because it is exactly that — a projection of
 * State for display/export, not a mutation or a policy. It reads only the
 * understudy-slot *vocabulary* from Schema (column ordering); membership
 * labelling is injected by the caller (`memberLabel`) so this stays free of the
 * component's `members` prop.
 *
 * The engine is split from its side effects on purpose: these functions are
 * pure string/array builders (unit-testable); the browser download and
 * clipboard write stay in the view.
 */

/**
 * Column layout for the wide table. An event may contain the same role more
 * than once (e.g. two "roving-cam" slots), so we widen to the MAX count of each
 * role across all events. Columns are ordered: all REAL roles first (catalog
 * order), then all UNDERSTUDY columns ("X-understudy"); duplicate columns get a
 * numbered label ("roving-cam 2"). Roles present in data but absent from the
 * catalog are appended (real ones with the real block, understudy ones last).
 *
 * @param {Array} events - all events
 * @param {Array} roles - the ordered base-role catalog
 * @returns {{ columns: Array<{role,index,label}>, maxCount: Object }}
 */
export function buildExportColumns(events, roles) {
  const maxCount = {}
  ;(events || []).forEach(e => {
    const perEvent = {}
    e.roster?.forEach(s => { if (s.role) perEvent[s.role] = (perEvent[s.role] || 0) + 1 })
    Object.entries(perEvent).forEach(([role, n]) => {
      if (n > (maxCount[role] || 0)) maxCount[role] = n
    })
  })

  const columns = []
  const pushRole = (role) => {
    const n = maxCount[role] || 0
    for (let i = 0; i < n; i++) {
      columns.push({ role, index: i, label: i === 0 ? role : `${role} ${i + 1}` })
    }
  }
  const allRoles = roles || []
  allRoles.forEach(role => pushRole(role))
  allRoles.forEach(role => pushRole(understudySlotRole(role)))
  Object.keys(maxCount).forEach(role => {
    if (columns.some(c => c.role === role)) return
    if (!isUnderstudyRole(role)) pushRole(role)
  })
  Object.keys(maxCount).forEach(role => {
    if (columns.some(c => c.role === role)) return
    if (isUnderstudyRole(role)) pushRole(role)
  })
  return { columns, maxCount }
}

/** The header row: fixed metadata columns, the role columns, then the two issue columns. */
export function buildExportHeader(columns) {
  return ['Date', 'Day', 'Reporting Time', 'Event Name', ...columns.map(c => c.label), 'Errors', 'Warnings']
}

/**
 * Build the data rows.
 *
 * @param {Array} events - the events to export (already search-filtered by the caller)
 * @param {Array} columns - from buildExportColumns
 * @param {Object} opts
 * @param {Object} [opts.validationResults] - date -> { errors, warnings }
 * @param {(memberId: string) => string} opts.memberLabel - member display label
 * @returns {Array<Array<string>>}
 */
export function buildExportRows(events, columns, { validationResults, memberLabel }) {
  return (events || []).map(event => {
    const validation = validationResults?.[event.date] || { errors: [], warnings: [] }
    const errorSummary = validation.errors.length > 0 ? validation.errors.join('; ') : ''
    const warningSummary = validation.warnings.length > 0 ? validation.warnings.join('; ') : ''

    // Group this event's assignments by role so duplicate roles (e.g. two
    // "roving-cam" slots) can be placed into their own columns positionally.
    const byRole = {}
    if (event.roster) {
      event.roster.forEach(assignment => {
        ;(byRole[assignment.role] = byRole[assignment.role] || []).push(assignment.member_id)
      })
    }

    return [
      event.date,
      event.day_of_week,
      event.reporting_time,
      event.name,
      ...columns.map(col => {
        const memberId = byRole[col.role]?.[col.index]
        return memberId !== undefined && memberId !== null ? memberLabel(memberId) : '-'
      }),
      errorSummary,
      warningSummary,
    ]
  })
}

/** Render header + rows as CSV (every cell quoted). */
export function toCSV(header, rows) {
  return [
    header.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
  ].join('\n')
}

/** Render header + rows as tab-separated values (for pasting into a spreadsheet). */
export function toTSV(header, rows) {
  return [
    header.join('\t'),
    ...rows.map(row => row.join('\t')),
  ].join('\n')
}

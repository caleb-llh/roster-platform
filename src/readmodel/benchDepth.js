import { isUnderstudyRole } from '../schema/understudyRoles'
import { canFillSlotRole } from '../rules/understudyPolicy'
import { isMemberUnavailable } from '../rules/constraintPrimitives'
import { isMemberIncluded } from '../schema/rosterSchema'

/**
 * Compute, for each real role, how many members are AVAILABLE for that role on
 * each event date -- the "bench depth" behind the roster-stats availability
 * heatmap. This is pure DATA (counts, required, slack, scale); the heatmap's
 * colour is a separate view concern (`availabilityCellColor` in
 * rosterStatsCharts, built on the shared `design/slateRamp` token).
 *
 * "Available for role R on date D" means the member (a) is included in the
 * roster (`include !== false`), (b) can fully perform R (`canFillSlotRole`,
 * i.e. R is in their `roles` — trainees who only understudy R are NOT counted,
 * matching how the app treats real-role capability), and (c) is not marked
 * unavailable on D (`isMemberUnavailable`).
 *
 * Design decisions (see specs/events-ui.md):
 * - X axis is one point PER EVENT DATE (constraints are date-based, so events
 *   are the natural sample points), sorted chronologically. Multiple events on
 *   the same date collapse to a single point (availability is a function of the
 *   date + role, not of a specific event's slots).
 * - Understudy slot roles are excluded (real roles only) for readability.
 * - Availability is capability-AND-free, independent of whether an event
 *   actually has a slot for that role — it answers "how many COULD I field",
 *   not "how many did I use".
 *
 * @param {Array} events            events, each `{ date, roster? }`
 * @param {Array} members           normalized members (`roles`, `understudyFor`)
 * @param {Array} roles             the role catalog (strings)
 * @param {Array} memberConstraints constraint objects (`member_id`, `unavailable_dates`)
 * @returns {{
 *   dates: string[],
 *   series: Array<{ role: string, counts: number[], required: number[], slack: number[] }>,
 *   maxCount: number,
 *   scale: { min: number, max: number }
 * }}
 *   `counts[i]` = members available for the role on `dates[i]`; `required[i]` =
 *   how many slots that role has across the event(s) on that date; `slack[i]` =
 *   `counts[i] - required[i]` (negative = short of members). `scale` is the
 *   roster-wide range of coverage RATIOS (`available/required`) over cells with
 *   real slack, used as the continuous gradient's endpoints so the slate ramp
 *   adapts to this roster's actual bench (see `availabilityCellColor` in
 *   rosterStatsCharts, which renders this data as the availability heatmap).
 */
export function computeAvailabilityByRole(events, members, roles, memberConstraints) {
  const realRoles = (roles || []).filter(r => typeof r === 'string' && !isUnderstudyRole(r))
  const activeMembers = (members || []).filter(isMemberIncluded)

  // Unique event dates, chronological.
  const dates = Array.from(new Set((events || []).map(e => e && e.date).filter(Boolean)))
    .sort((a, b) => new Date(a) - new Date(b))

  // Required slots per role per date: count slots whose `role` matches, summed
  // across all events sharing that date.
  const requiredByDateRole = {} // date -> { role -> count }
  for (const date of dates) requiredByDateRole[date] = {}
  for (const event of events || []) {
    if (!event || !event.date || !Array.isArray(event.roster)) continue
    const bucket = requiredByDateRole[event.date]
    if (!bucket) continue
    for (const slot of event.roster) {
      if (slot && slot.role) bucket[slot.role] = (bucket[slot.role] || 0) + 1
    }
  }

  const series = realRoles.map(role => {
    const capable = activeMembers.filter(m => canFillSlotRole(m, role))
    const counts = dates.map(date =>
      capable.reduce(
        (n, m) => n + (isMemberUnavailable(m.id, date, memberConstraints) ? 0 : 1),
        0
      )
    )
    const required = dates.map(date => requiredByDateRole[date][role] || 0)
    const slack = counts.map((c, i) => c - required[i])
    return { role, counts, required, slack }
  })

  const maxCount = series.reduce(
    (max, s) => Math.max(max, ...(s.counts.length ? s.counts : [0])),
    0
  )

  // Roster-wide colour scale for the CONTINUOUS gradient: the range of coverage
  // ratios (available / required) over cells with real slack (required > 0 and
  // available > required). Shortages and exactly-enough cells are excluded —
  // they get a reserved flat red (see availabilityCellColor) and must not
  // stretch the gradient. `scale.min`/`scale.max` are the gradient endpoints, so
  // the amber→emerald ramp adapts to how much bench THIS roster actually has
  // rather than a fixed ratio that paints an abundant roster all-green.
  let min = Infinity
  let max = -Infinity
  for (const s of series) {
    for (let i = 0; i < s.counts.length; i++) {
      if (s.required[i] > 0 && s.counts[i] > s.required[i]) {
        const ratio = s.counts[i] / s.required[i]
        if (ratio < min) min = ratio
        if (ratio > max) max = ratio
      }
    }
  }
  const scale = Number.isFinite(min) ? { min, max } : { min: 1, max: 1 }

  return { dates, series, maxCount, scale }
}

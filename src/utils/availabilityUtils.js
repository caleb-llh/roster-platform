import { canFillSlotRole, isUnderstudyRole } from './understudy'
import { isMemberUnavailable } from '../rules/constraintPrimitives'
import { isMemberIncluded } from '../schema/rosterSchema'

/**
 * Compute, for each real role, how many members are AVAILABLE for that role on
 * each event date — the data behind the roster-stats availability line chart.
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
 *   adapts to this roster's actual bench (see `availabilityCellColor`).
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

// Monochrome slack ramp: the same muted SLATE hue the rest of the roster-stats
// panel uses, varying only in lightness so CONCERN reads darker. Short/exact
// cells already reserve red; within the still-coverable slack cells, the user
// now reads "thinner bench = darker slate, comfortable bench = lighter slate".
// One hue keeps the heatmap consistent with its neighbours while preserving
// red as the only true danger colour.
const RAMP_HUE = 215
const RAMP_LIGHT = { s: 16, l: 74 } // comfortable cover: pale slate
const RAMP_DEEP = { s: 25, l: 30 }  // thin-but-coverable cover: deep slate, aligned with sibling charts

/**
 * Colour for one heatmap cell. Reserved flat colours apply first (independent
 * of the roster scale, so a real shortage is never painted healthy):
 *  - no demand  → neutral slate
 *  - short (available < required) or exactly enough (=== required) → RED
 * Cells with real slack (available > required) get a CONTINUOUS single-hue
 * (slate) ramp, deepening as the cell's coverage ratio FALLS within the
 * roster's slack-ratio range (`scale`). Returns an rgb/hsl CSS colour string
 * plus a `category` for tooltips/tests.
 *
 * @returns {{ category: 'none'|'short'|'exact'|'slack', color: string }}
 */
export function availabilityCellColor(available, required, scale) {
  if (!required || required <= 0) return { category: 'none', color: 'rgba(226,232,240,0.4)' } // slate-200/40
  if (available < required) return { category: 'short', color: 'rgba(220,38,38,0.62)' }        // muted red
  if (available === required) return { category: 'exact', color: 'rgba(220,38,38,0.42)' }      // muted red, lighter

  const { min = 1, max = 1 } = scale || {}
  const ratio = available / required
  // Normalized concern in [0,1] across the roster's slack range. The thinnest
  // still-coverable cell (the roster's slack minimum) is the darkest slate;
  // the most comfortable cover is the palest.
  const t = max > min ? 1 - Math.min(1, Math.max(0, (ratio - min) / (max - min))) : 1
  const s = RAMP_LIGHT.s + (RAMP_DEEP.s - RAMP_LIGHT.s) * t
  const l = RAMP_LIGHT.l + (RAMP_DEEP.l - RAMP_LIGHT.l) * t
  return { category: 'slack', color: `hsla(${RAMP_HUE}, ${s.toFixed(0)}%, ${l.toFixed(0)}%, 0.72)` }
}

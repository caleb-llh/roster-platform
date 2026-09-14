// Named `rosterStatsCharts`, not `distributionUtils`: this module produces the
// roster-stats panel's charts and their helpers -- the shift-distribution bell
// curve, the concern gradients, the availability-heatmap cell colour, and the
// `BellCurveChart` / `AvailabilityHeatmap` components. The old "distribution
// Utils" name described only one of those concerns and named a shape, not the
// product.
import { useState } from 'react'
import { glassPopup, glassArrow, tierUnit } from '../design/designSystem'
import { formatDate } from '../design/colorUtils'
import { SLATE_HUE, slateRampColor } from '../design/slateRamp'
import { isMemberIncluded } from '../schema/rosterSchema'

/**
 * Calculate shift distribution from generation result
 * @param {Object} generationResult - The result from roster generation
 * @param {Array} members - Array of member objects
 * @returns {Object} Distribution data with sortedDistribution, maxMemberCount, averageShifts
 */
export function calculateDistribution(generationResult, members) {
  if (!generationResult) {
    return {
      sortedDistribution: [],
      maxMemberCount: 1,
      averageShifts: '0.0'
    }
  }

  const assignmentsByMember = generationResult.fairnessMetrics.assignmentsByMember || {}
  const distribution = {}
  
  if (typeof assignmentsByMember === 'object') {
    Object.entries(assignmentsByMember).forEach(([memberId, data]) => {
      let shiftCount
      if (typeof data === 'object' && data !== null) {
        shiftCount = data.total || data.count || data.assignments || Object.keys(data).length
      } else {
        shiftCount = typeof data === 'number' ? data : parseInt(data, 10)
      }
      
      if (!isNaN(shiftCount) && shiftCount > 0) {
        if (!distribution[shiftCount]) {
          distribution[shiftCount] = {
            memberCount: 0,
            memberIds: []
          }
        }
        distribution[shiftCount].memberCount++
        distribution[shiftCount].memberIds.push(memberId)
      }
    })
  }

  const sortedDistribution = Object.entries(distribution)
    .map(([shiftCount, data]) => ({
      shiftCount: parseInt(shiftCount, 10),
      memberCount: data.memberCount,
      memberIds: data.memberIds
    }))
    .filter(d => !isNaN(d.shiftCount) && !isNaN(d.memberCount) && d.shiftCount > 0)
    .sort((a, b) => a.shiftCount - b.shiftCount)

  const maxMemberCount = sortedDistribution.length > 0 
    ? Math.max(...sortedDistribution.map(d => d.memberCount)) 
    : 1
    
  const activeMembers = members?.filter(isMemberIncluded) || []
  const averageShifts = activeMembers.length > 0 
    ? (generationResult.stats.assignedRoles / activeMembers.length).toFixed(1)
    : '0.0'

  return {
    sortedDistribution,
    maxMemberCount,
    averageShifts
  }
}

// Slate-ramp endpoints for the roster-stats bars. Hue + interpolation live in
// the shared `design/slateRamp` token; only these per-chart endpoints stay
// local. The deep endpoint is intentionally aligned to the availability
// heatmap's darkest slate (see `availabilityCellColor` / HEATMAP_* below) so the
// compact charts share one common "maximum concern" shade.
const STATS_SLATE_LIGHT = { s: 16, l: 80, a: 0.72 }
const STATS_SLATE_DEEP = { s: 25, l: 30, a: 0.72 }

const clamp01 = (n) => Math.min(1, Math.max(0, n))

export function normalizeMetricRange(value, min, max, fallback = 0.5) {
  if (!Number.isFinite(value)) return fallback
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return fallback
  return clamp01((value - min) / (max - min))
}

const mixStatSlate = (concern) => slateRampColor(STATS_SLATE_LIGHT, STATS_SLATE_DEEP, concern)

const tintTowardsLight = (concern, delta = 12) => {
  const t = clamp01(concern)
  const lBase = STATS_SLATE_LIGHT.l + (STATS_SLATE_DEEP.l - STATS_SLATE_LIGHT.l) * t
  const l = Math.max(18, Math.min(92, lBase + delta))
  const s = STATS_SLATE_LIGHT.s + (STATS_SLATE_DEEP.s - STATS_SLATE_LIGHT.s) * t
  return `hsla(${SLATE_HUE}, ${s.toFixed(0)}%, ${l.toFixed(0)}%, 0.72)`
}

export function distributionConcern(shiftCount, minShiftCount, maxShiftCount) {
  if (!Number.isFinite(shiftCount)) return 0
  return normalizeMetricRange(shiftCount, minShiftCount, maxShiftCount, 0.5)
}

export function roleRotationConcern(rotationRatio) {
  return clamp01(1 - (rotationRatio ?? 0))
}

export function spacingDotConcern(assignmentDates, index, periodSpanMs) {
  if (!Array.isArray(assignmentDates) || assignmentDates.length <= 1 || !Number.isFinite(periodSpanMs) || periodSpanMs <= 0) {
    return 0.12
  }
  const current = new Date(assignmentDates[index]?.date).getTime()
  if (!Number.isFinite(current)) return 0.12
  const prev = index > 0 ? new Date(assignmentDates[index - 1]?.date).getTime() : null
  const next = index < assignmentDates.length - 1 ? new Date(assignmentDates[index + 1]?.date).getTime() : null
  const gaps = [prev, next]
    .filter(Number.isFinite)
    .map(t => Math.abs(t - current))
  if (gaps.length === 0) return 0.12
  const nearestGap = Math.min(...gaps)
  // Compare the nearest gap to the member's own "expected" spacing across the
  // roster period. This is easier to distinguish than a raw period-relative
  // scale, which made most dots look similarly intense.
  const expectedGap = periodSpanMs / Math.max(1, assignmentDates.length)
  const closeness = 1 - clamp01(nearestGap / Math.max(expectedGap, 1))
  return clamp01(closeness * 0.75)
}

export function verticalConcernGradient(concern) {
  return `linear-gradient(to top, ${mixStatSlate(concern)}, ${tintTowardsLight(concern, 10)})`
}

export function horizontalConcernGradient(concern) {
  return `linear-gradient(to right, ${mixStatSlate(concern)}, ${tintTowardsLight(concern, 10)})`
}

export function fullTrackConcernGradient() {
  return `linear-gradient(to right, ${mixStatSlate(1)}, ${mixStatSlate(0)})`
}

// Availability-heatmap slate ramp: comfortable cover is pale slate, thin-but-
// coverable cover is deep slate. Endpoints stay local; the hue + interpolation
// are the shared `slateRamp` token. The deep endpoint is aligned to the sibling
// bars' darkest slate (STATS_SLATE_DEEP) so the whole panel shares one "maximum
// concern" shade. Alpha is fixed at 0.72 across the ramp.
const HEATMAP_SLATE_LIGHT = { s: 16, l: 74, a: 0.72 } // comfortable cover
const HEATMAP_SLATE_DEEP = { s: 25, l: 30, a: 0.72 }  // thin-but-coverable cover

/**
 * Colour for one availability-heatmap cell. Reserved flat colours apply first
 * (independent of the roster scale, so a real shortage is never painted
 * healthy):
 *  - no demand  → neutral slate
 *  - short (available < required) or exactly enough (=== required) → RED
 * Cells with real slack (available > required) get a CONTINUOUS single-hue
 * (slate) ramp, deepening as the cell's coverage ratio FALLS within the
 * roster's slack-ratio range (`scale`). Returns a CSS colour string plus a
 * `category` for tooltips/tests.
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
  // still-coverable cell (the roster's slack minimum) is the darkest slate; the
  // most comfortable cover is the palest.
  const t = max > min ? 1 - Math.min(1, Math.max(0, (ratio - min) / (max - min))) : 1
  return { category: 'slack', color: slateRampColor(HEATMAP_SLATE_LIGHT, HEATMAP_SLATE_DEEP, t) }
}

// Static legend swatch for the heatmap's coverable-cell ramp: deep (low cover)
// on the left to light (high cover) on the right. The deep end is nudged 2pts
// darker than the cell ramp so the tiny swatch reads clearly. Built from the
// shared slate token so the hue is never hardcoded.
function heatmapLegendGradient() {
  const deep = slateRampColor({ s: 25, l: 28, a: 0.72 }, { s: 25, l: 28, a: 0.72 }, 0)
  const light = slateRampColor(HEATMAP_SLATE_LIGHT, HEATMAP_SLATE_LIGHT, 0)
  return `linear-gradient(to right, ${deep}, ${light})`
}

/**
 * Render bell curve bars
 * @param {Array} sortedDistribution - Sorted distribution array with memberIds
 * @param {number} maxMemberCount - Maximum member count for scaling
 * @param {Array} members - Array of member objects to get names
 * @param {number} barWidth - Width of each bar in pixels (default: 32)
 * @returns {JSX} Bell curve visualization
 */
export function BellCurveChart({ sortedDistribution, maxMemberCount, members = [], barWidth = 32 }) {
  const [hoveredBar, setHoveredBar] = useState(null)
  
  if (sortedDistribution.length === 0) {
    return (
      <div className="text-center text-sm text-gray-500 py-4">
        No distribution data available
      </div>
    )
  }

  // Helper to get member name from ID
  const getMemberName = (memberId) => {
    const member = members.find(m => m.id === memberId)
    return member?.name || memberId
  }
  const minShiftCount = Math.min(...sortedDistribution.map(d => d.shiftCount))
  const maxShiftCount = Math.max(...sortedDistribution.map(d => d.shiftCount))

  return (
    <div className="relative">
      <div className="flex items-end justify-center gap-3 px-8" style={{ height: '116px' }}>
        {sortedDistribution.map(({ shiftCount, memberCount, memberIds }) => {
          // Reserve space for the count label above (~16px), the shift-count
          // label below (~20px), and gaps.
          const maxBarHeight = 72
          const heightPixels = Math.max((memberCount / maxMemberCount) * maxBarHeight, 8)
          const isHovered = hoveredBar === shiftCount
          const concern = distributionConcern(shiftCount, minShiftCount, maxShiftCount)
          
          return (
            <div 
              key={shiftCount} 
              className="flex flex-col items-center justify-end gap-1 relative" 
              style={{ width: `${barWidth}px` }}
              onMouseEnter={() => setHoveredBar(shiftCount)}
              onMouseLeave={() => setHoveredBar(null)}
            >
              {/* Count sits ABOVE the bar so it never spills out of short bars. */}
              <div className="text-slate-500 text-xs font-bold leading-none">
                {memberCount}
              </div>
              <div
                className={`w-full rounded-t transition-all cursor-pointer ${
                  isHovered ? 'ring-2 ring-slate-300' : ''
                }`}
                style={{
                  height: `${heightPixels}px`,
                  background: verticalConcernGradient(concern),
                  filter: isHovered ? 'brightness(0.95)' : undefined,
                }}
              />
              <div className="text-xs font-semibold text-gray-700">{shiftCount}</div>
              
              {/* Tooltip with member names — light translucent glass, matching
                  the roster-stats theme */}
              {isHovered && memberIds && memberIds.length > 0 && (
                <div className={`absolute bottom-full mb-2 py-2 px-3 text-xs z-50 whitespace-nowrap max-w-xs ${glassPopup}`}>
                  <div className="font-semibold mb-1">
                    {memberCount} member{memberCount > 1 ? 's' : ''} with {shiftCount} shift{shiftCount > 1 ? 's' : ''}:
                  </div>
                  <div className="space-y-0.5 text-slate-600">
                    {memberIds.map((memberId, idx) => (
                      <div key={idx}>• {getMemberName(memberId)}</div>
                    ))}
                  </div>
                  {/* Arrow */}
                  <div className={`absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 ${glassArrow}`}></div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Availability heatmap: a role × event-date grid whose cell colour encodes how
 * well that role is covered on that date (members available vs. slots required).
 * See `computeAvailabilityByRole` (benchDepth.js) for the data and
 * `availabilityCellColor` below for the colour semantics; see specs/events-ui.md.
 *
 * Replaces the earlier multi-line chart, which turned into unreadable spaghetti
 * once several roles tracked each other; a grid keeps every role on its own row
 * and makes the planning signal — the thin/short cells — pop. Red is reserved
 * for real trouble (short / exactly-enough); coverable cells get a CONTINUOUS
 * single-hue (slate) ramp that darkens when the still-coverable bench is thin.
 *
 * @param {{ dates: string[], series: Array<{role, counts:number[], required:number[], slack:number[]}>, scale: {min:number,max:number} }} data
 */
export function AvailabilityHeatmap({ data }) {
  const [hover, setHover] = useState(null) // { role, i } | null
  const { dates = [], series = [], scale = { min: 1, max: 1 } } = data || {}

  if (dates.length === 0 || series.length === 0) {
    return (
      <div className="text-center text-sm text-gray-500 py-4">
        No availability data available
      </div>
    )
  }

  // Thin the date header labels so they don't collide when there are many
  // events (show ~every Nth, plus the last).
  const labelStep = Math.ceil(dates.length / 8)

  const hovered = hover
    ? series.find(s => s.role === hover.role)
    : null

  return (
    <div className="relative overflow-x-auto">
      <div className="min-w-max">
        {/* Date header row */}
        <div className="flex">
          <div className="w-24 shrink-0" />
          {dates.map((d, i) => (
            <div key={d} className="flex-1 min-w-[14px] text-center">
              <span className={`${tierUnit} ${(i % labelStep === 0 || i === dates.length - 1) ? '' : 'invisible'}`}>
                {formatDate(d, { month: 'numeric', day: 'numeric' })}
              </span>
            </div>
          ))}
        </div>

        {/* One row per role */}
        {series.map((s) => (
          <div key={s.role} className="flex items-center mt-1">
            <div className="w-24 shrink-0 pr-2 truncate text-xs text-slate-600 text-right">{s.role}</div>
            {s.counts.map((available, i) => (
              <div
                key={i}
                className={`flex-1 min-w-[14px] h-5 mx-px rounded-sm cursor-default transition-transform ${hover && hover.role === s.role && hover.i === i ? 'ring-1 ring-slate-500 scale-110' : ''}`}
                style={{ backgroundColor: availabilityCellColor(available, s.required[i], scale).color }}
                onMouseEnter={() => setHover({ role: s.role, i })}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Legend: reserved red for short/exactly-enough, a continuous
          low-cover→high-cover slate gradient for coverable cells,
          neutral slate for no demand. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 justify-center text-[11px] text-slate-500">
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: 'rgba(220,38,38,0.62)' }} /> short / exactly enough</span>
        <span className="flex items-center gap-1">
          <span className="text-slate-400">low</span>
          <span className="inline-block h-2.5 w-16 rounded-sm" style={{ backgroundImage: heatmapLegendGradient() }} />
          <span className="text-slate-400">high cover</span>
        </span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: 'rgba(226,232,240,0.6)' }} /> no demand</span>
      </div>

      {/* Hover tooltip */}
      {hover && hovered && (
        <div className={`pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 py-2 px-3 text-xs z-50 whitespace-nowrap ${glassPopup}`}>
          <div className="font-semibold">{hover.role} · {formatDate(dates[hover.i], { month: 'short', day: 'numeric' })}</div>
          <div className="mt-1 space-y-0.5 text-slate-600">
            <div>Available: <span className="font-semibold text-slate-700">{hovered.counts[hover.i]}</span></div>
            <div>Required: <span className="font-semibold text-slate-700">{hovered.required[hover.i]}</span></div>
            <div>Slack: <span className="font-semibold text-slate-700">{hovered.slack[hover.i] > 0 ? '+' : ''}{hovered.slack[hover.i]}</span></div>
          </div>
          <div className={`absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 ${glassArrow}`}></div>
        </div>
      )}
    </div>
  )
}

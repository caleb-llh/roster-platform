import {
  calculateDistribution,
  BellCurveChart,
  spacingDotConcern,
  normalizeMetricRange,
  fullTrackConcernGradient,
} from '../readmodel/distributionUtils.jsx'
import { tierTitle, tierSection, tierUnit, helperText, glassCard, glassPopup, glassArrow } from '../utils/statsTheme'

/**
 * Light, translucent "glass" tooltip shown above its parent on hover. The
 * parent must carry the `group/tt` class. Includes a downward-pointing arrow
 * (a rotated, border-matched square) anchored to the parent's center/edge.
 */
function Tooltip({ children }) {
  return (
    <span className="pointer-events-none absolute bottom-4 left-1/2 z-30 hidden -translate-x-1/2 group-hover/tt:block">
      <span className={`relative block whitespace-nowrap px-2 py-1 text-[11px] font-medium ${glassPopup}`}>
        {children}
        {/* arrow */}
        <span className={`absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 ${glassArrow}`} />
      </span>
    </span>
  )
}

/**
 * Shared component for displaying quality metrics (shift balance, time spacing, role rotation)
 * Used by RosterStatsPanel (compact and full views)
 */
export default function QualityMetrics({ generationResult, members, stats, showRoleDiversity = true, compact = false }) {
  if (!generationResult) return null

  const { sortedDistribution, maxMemberCount, averageShifts } = calculateDistribution(generationResult, members)

  if (compact) {
    // Compact view for RosterStatsPanel
    // Time Spacing timeline: plot each member's shift dates as dots on a shared
    // date axis (roster period). Tightly packed dots are darker, but the ramp is
    // intentionally softened so medium spacing differences remain readable.
    const timelineMembers = (stats?.memberStats || []).filter(m => m.assignmentDates?.length > 0)
    const periodStartMs = stats?.periodStart ? new Date(stats.periodStart).getTime() : null
    const periodEndMs = stats?.periodEnd ? new Date(stats.periodEnd).getTime() : null
    const periodSpan = (periodStartMs != null && periodEndMs != null) ? Math.max(1, periodEndMs - periodStartMs) : null
    const datePct = (dateStr) => {
      if (periodSpan == null) return 0
      const t = new Date(dateStr).getTime()
      return Math.min(100, Math.max(0, ((t - periodStartMs) / periodSpan) * 100))
    }
    // Whole-week gap between two dates, for the between-dots hover tooltip.
    const weeksBetween = (a, b) => {
      const days = Math.round((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24))
      const weeks = Math.round(days / 7)
      const label = weeks <= 0
        ? `${days} day${days === 1 ? '' : 's'}`
        : `${weeks} week${weeks === 1 ? '' : 's'}`
      return { days, label }
    }
    const rawDotConcerns = timelineMembers.flatMap(member =>
      member.assignmentDates.map((_, i) => spacingDotConcern(member.assignmentDates, i, periodSpan))
    )
    const dotConcernMin = rawDotConcerns.length ? Math.min(...rawDotConcerns) : 0
    const dotConcernMax = rawDotConcerns.length ? Math.max(...rawDotConcerns) : 1

    return (
      <div className="space-y-4">
        {/* Bell Curve */}
        <div>
          <div className={`${glassCard} p-4`}>
            <div className={`${tierSection} mb-3`}>Shift Distribution</div>
            <BellCurveChart sortedDistribution={sortedDistribution} maxMemberCount={maxMemberCount} members={members} />
            <div className={`text-center ${tierUnit} mt-2`}>
              Shifts per member (Avg: {averageShifts})
            </div>
          </div>
        </div>

        {/* Time Spacing — a timeline of dots per member. Position encodes when
            each shift falls in the roster period, so clustering is intuitive. */}
        {timelineMembers.length > 0 && periodSpan != null && (
          <div className={`${glassCard} p-4`}>
            <div className={`${tierSection} mb-3`}>Time Spacing</div>
            {/* pt-6 leaves room for the first row's tooltip (it sits above the
                dot); no overflow clipping so tooltips aren't cut off. */}
            <div className="space-y-2 pt-6">
              {timelineMembers.map(member => (
                <div key={member.id} className="flex items-center gap-2 text-xs">
                  <span className="min-w-[100px] truncate font-medium text-gray-900">{member.name}</span>
                  <div className="relative flex-1 h-4">
                    {/* baseline */}
                    <div className="absolute top-1/2 left-0 right-0 h-px -translate-y-1/2 bg-slate-200" />
                    {/* gap segments between consecutive dots — hover shows the
                        number of weeks between the two shifts */}
                    {member.assignmentDates.slice(1).map((d, i) => {
                      const prev = member.assignmentDates[i]
                      const startPct = datePct(prev.date)
                      const endPct = datePct(d.date)
                      const gap = weeksBetween(prev.date, d.date)
                      return (
                        <span
                          key={`gap-${prev.date}-${d.date}-${i}`}
                          className="group/tt absolute top-1/2 z-0 h-3 -translate-y-1/2 hover:z-40"
                          style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
                        >
                          <Tooltip>{gap.label} apart</Tooltip>
                        </span>
                      )
                    })}
                    {member.assignmentDates.map((d, i) => {
                      const rawConcern = spacingDotConcern(member.assignmentDates, i, periodSpan)
                      const concern = normalizeMetricRange(rawConcern, dotConcernMin, dotConcernMax, rawConcern)
                      return (
                        <span
                          key={`${d.date}#${i}`}
                          className="group/tt absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 hover:z-40"
                          style={{ left: `${datePct(d.date)}%` }}
                        >
                          <span
                            className="block h-2.5 w-2.5 rounded-full backdrop-blur-sm"
                            style={{
                              backgroundColor: `hsla(215, ${(15 + concern * 10).toFixed(0)}%, ${(92 - concern * 62).toFixed(0)}%, ${(0.42 + concern * 0.30).toFixed(2)})`,
                              border: `1px solid hsla(215, ${(18 + concern * 7).toFixed(0)}%, ${(68 - concern * 24).toFixed(0)}%, ${(0.56 + concern * 0.16).toFixed(2)})`,
                            }}
                          />
                          <Tooltip>{d.role ? `${d.date} · ${d.role}` : d.date}</Tooltip>
                        </span>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Role Rotation Quality — one bar per role showing the rotation ratio
            (distinct members ÷ shifts). Full bar = every shift went to a
            different person; short bar = the same few people repeat the role.
            The filled width shows the ratio; every bar uses the SAME full-width
            dark→light track gradient, so the left edge intensity is identical
            across rows and only the amount of track reached varies. */}
        {showRoleDiversity && stats?.roleDiversity?.roleStats && (
          <div className={`${glassCard} p-4`}>
            <div className={`${tierSection} mb-3`}>Role Rotation Quality</div>
            <div className="space-y-2">
              {stats.roleDiversity.roleStats
                .slice()
                .sort((a, b) => b.rotationRatio - a.rotationRatio)
                .map(roleStat => (
                  <div key={roleStat.role} className="text-xs">
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="font-medium text-gray-900">{roleStat.role}</span>
                      <span className="text-gray-500">
                        {roleStat.uniqueMembers}/{roleStat.totalAssignments} · {Math.round(roleStat.rotationRatio * 100)}%
                      </span>
                    </div>
                    <div
                      className="relative h-2 bg-slate-100 rounded-full overflow-hidden"
                      style={{ backgroundImage: fullTrackConcernGradient() }}
                    >
                      <div
                        className="absolute inset-y-0 right-0 bg-slate-100/95 rounded-r-full transition-all"
                        style={{ width: `${100 - Math.round(roleStat.rotationRatio * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
            <p className={`${helperText} mt-2 pb-2`}>
              Distinct members ÷ shifts per role. Fuller bars mean the role rotates through more people.
            </p>
          </div>
        )}
      </div>
    )
  }

  // Full view (RosterStatsPanel "Show Details")
  return (
    <div className="rounded-lg">
      <h3 className={`${tierTitle} mb-2`}>Quality Metrics</h3>
      <p className="text-xs text-gray-500 mb-4">Lower scores are better (left on scale = better)</p>
      <div className="space-y-6">
        {/* Shift Balance */}
        <div className={`${glassCard} p-4`}>
          <div className="flex justify-between items-center mb-3">
            <div>
              <span className={tierSection}>Shift Balance</span>
              <p className="text-xs text-gray-500 mt-0.5">Are shifts distributed fairly?</p>
            </div>
            <span className="text-xl font-bold text-gray-900">
              {generationResult.fairnessMetrics.assignmentStdDev.toFixed(2)}
            </span>
          </div>
          <div className="relative h-2 bg-slate-200 rounded-full overflow-hidden">
            <div 
              className="absolute top-0 bottom-0 w-1 bg-slate-600 rounded-full"
              style={{ 
                left: `${Math.min(100, (generationResult.fairnessMetrics.assignmentStdDev / 3) * 100)}%`,
                transform: 'translateX(-50%)'
              }}
            ></div>
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>Excellent</span>
            <span>Good</span>
            <span>Unbalanced</span>
          </div>
          <p className="text-xs text-gray-500 italic mt-3">
            {generationResult.fairnessMetrics.assignmentStdDev < 1.0 
              ? "Everyone has a similar number of assignments"
              : generationResult.fairnessMetrics.assignmentStdDev < 2.0
              ? "Assignments are fairly distributed"
              : "Some members have significantly more assignments than others"}
          </p>

          {/* Distribution Details */}
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className={`${tierSection} mb-3`}>Distribution Details</div>
            
            <div className={`${glassCard} p-3 mb-3`}>
              <div className="text-2xl font-bold text-slate-700">{averageShifts}</div>
              <div className="text-xs text-gray-600">Average shifts per member</div>
            </div>
            
            <div className={`${glassCard} p-3 mb-3`}>
              <BellCurveChart sortedDistribution={sortedDistribution} maxMemberCount={maxMemberCount} members={members} />
              <div className="text-center text-xs text-gray-500 mt-2">
                Shifts per member
              </div>
            </div>
          </div>
        </div>

        {/* Time Spacing */}
        <div className={`${glassCard} p-4`}>
          <div className="flex justify-between items-center mb-3">
            <div>
              <span className={tierSection}>Time Spacing</span>
              <p className="text-xs text-gray-500 mt-0.5">Are shifts spread over time?</p>
            </div>
            <span className="text-xl font-bold text-gray-900">
              {generationResult.fairnessMetrics.spreadStdDev.toFixed(2)}
            </span>
          </div>
          <div className="relative h-2 bg-slate-200 rounded-full overflow-hidden">
            <div 
              className="absolute top-0 bottom-0 w-1 bg-slate-600 rounded-full"
              style={{ 
                left: `${Math.min(100, (generationResult.fairnessMetrics.spreadStdDev / 15) * 100)}%`,
                transform: 'translateX(-50%)'
              }}
            ></div>
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>Well-spaced</span>
            <span>Good</span>
            <span>Clustered</span>
          </div>
          <p className="text-xs text-gray-500 italic mt-3">
            {generationResult.fairnessMetrics.spreadStdDev < 5.0
              ? "Assignments are well-spaced throughout the period"
              : generationResult.fairnessMetrics.spreadStdDev < 10.0
              ? "Assignments have reasonable spacing"
              : "Some members may have clustered assignments"}
          </p>
        </div>
        
        {/* Role Rotation */}
        {showRoleDiversity && stats?.roleDiversity?.roleStats && (
          <div className={`${glassCard} p-4`}>
            <div className="flex justify-between items-center mb-3">
              <div>
                <span className={tierSection}>Role Rotation</span>
                <p className="text-xs text-gray-500 mt-0.5">Are different members trying each role?</p>
              </div>
              <span className="text-xl font-bold text-gray-900">
                {stats.roleDiversity.avgMembersPerRole}
              </span>
            </div>
            <div className="relative h-2 bg-slate-200 rounded-full overflow-hidden">
              <div 
                className="absolute top-0 bottom-0 w-1 bg-slate-600 rounded-full"
                style={{ 
                  left: `${Math.min(100, (stats.roleDiversity.avgMembersPerRole / 6) * 100)}%`,
                  transform: 'translateX(-50%)'
                }}
              ></div>
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>Limited</span>
              <span>Good</span>
              <span>Excellent</span>
            </div>
            
            <div className="space-y-2 max-h-32 overflow-y-auto mt-3">
              {stats.roleDiversity.roleStats
                .sort((a, b) => b.uniqueMembers - a.uniqueMembers)
                .map(roleStat => (
                  <div key={roleStat.role} className={`${glassCard} p-3 text-xs`}>
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 sm:gap-3">
                      <span className="font-medium text-gray-900">{roleStat.role}</span>
                      <div className="flex items-center gap-2 text-[11px] sm:text-xs">
                        <span className="text-gray-600 font-medium">{roleStat.uniqueMembers} different members</span>
                        <span className="text-gray-400">({roleStat.totalAssignments} assignments)</span>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

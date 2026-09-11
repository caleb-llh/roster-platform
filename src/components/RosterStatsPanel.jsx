import { useState } from 'react'
import QualityMetrics from './QualityMetrics'
import { AvailabilityHeatmap } from '../utils/distributionUtils'
import { formatEntry } from '../generation/actionLog'
import { tierTitle, tierLabel, tierSection, tierUnit, helperText, glassPanel, glassCard, semanticError, monoChip } from '../utils/statsTheme'

const CATEGORY_LABEL = {
  generation: 'gen',
  swap: 'swap',
  update: 'update',
  replace: 'replace',
  delete: 'delete',
  insert: 'insert',
}

const CATEGORY_STYLE = {
  generation: monoChip,
  swap: monoChip,
  update: 'bg-amber-100 text-amber-700',
  replace: 'bg-amber-100 text-amber-700',
  delete: 'bg-rose-100 text-rose-700',
  insert: 'bg-emerald-100 text-emerald-700',
}

export default function RosterStatsPanel({ stats, members, actionLog = [], availability = null }) {
  const [showDetails, setShowDetails] = useState(false)

  if (!stats || stats.totalSlots === 0) {
    return null
  }

  const { totalSlots, totalEvents, monthCount, avgSlotsPerEvent, avgSlotsPerMonth, avgSlotsPerMember } = stats

  return (
    <div className={`${glassPanel} p-4 mb-6`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className={tierTitle}>Roster Statistics</h3>
        <button
          onClick={() => setShowDetails(!showDetails)}
          className={`${tierLabel} hover:text-gray-800`}
        >
          {showDetails ? '▼ Hide Details' : '▶ Show Details'}
        </button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div className={`${glassCard} p-3`}>
          <div className={`${tierLabel} mb-1`}>Total Shifts Required</div>
          <div className="text-2xl font-bold tracking-tight text-gray-900">{totalSlots}</div>
          <div className={`${helperText} mt-1`}>
            Across {totalEvents} events over {monthCount} {monthCount === 1 ? 'month' : 'months'}
          </div>
        </div>

        <div className={`${glassCard} p-3`}>
          <div className={`${tierLabel} mb-1`}>Average Shifts Per Member</div>
          <div className="text-2xl font-bold tracking-tight text-gray-900">{avgSlotsPerMember}
            <span className={`ml-1 ${tierUnit}`}>
                shifts/roster
            </span>
          </div>
          <div className={`${helperText} mt-1`}>
            {Math.round(avgSlotsPerMember / monthCount * 10) / 10} shifts/month
          </div>
        </div>
      </div>

      {/* Unassignable Roles Warning — driven by the LIVE roster stats (empty
          slots with no eligible member), not the frozen generation snapshot, so
          it updates in real time as slots are filled/emptied. */}
      {stats.unassignableRoles && stats.unassignableRoles.length > 0 && (
        <div className={`rounded-lg p-3 mb-3 ${semanticError}`}>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-red-700 mb-2">
            Unassignable Roles ({stats.unassignableRoles.length})
          </div>
          <div className="space-y-1.5 text-xs max-h-32 overflow-y-auto">
            {stats.unassignableRoles.map((item, idx) => (
              <div key={idx} className={`${glassCard} p-2`}>
                <div className="font-medium text-gray-900">{item.event}</div>
                <div className="text-gray-600">{item.date} - {item.role}</div>
                <div className="text-red-600 text-xs mt-0.5">{item.reason}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detailed Stats — everything here is computed from the CURRENT roster
          state (`stats`) so quality metrics and the unassignable-roles warning
          above stay real-time. QualityMetrics is fed a `generationResult`-shaped
          object built from the live stats purely to match its prop contract. */}
      {showDetails && (
        <div className="border-t border-gray-200 pt-3">
          {/* Members-available vs. required per role over time. Cell colour =
              coverage on a roster-normalized scale (red = short/exactly-enough;
              slate ramp = this roster's low→high coverage). Placed above the
              QualityMetrics sections (Shift Distribution etc.) as the first
              detail. Read-only insight; not tied to generation. */}
          {availability && availability.series.length > 0 && (
            <div className={`${glassCard} p-4 mb-4`}>
              <div className={`${tierSection} mb-3`}>Member Availability</div>
              <AvailabilityHeatmap data={availability} />
            </div>
          )}

          <QualityMetrics
            generationResult={{
              fairnessMetrics: stats.fairnessMetrics,
              stats: { assignedRoles: stats.assignedRoles }
            }}
            members={members}
            stats={stats}
            showRoleDiversity={true}
            compact={true}
          />

          {/* Generic Log — captures generation and manual swaps/updates/deletes/inserts */}
          {actionLog.length > 0 && (
            <details className={`mt-3 ${glassCard}`}>
              <summary className={`cursor-pointer select-none px-3 py-2 ${tierSection} hover:text-gray-900`}>
                Log <span className="font-normal normal-case tracking-normal text-gray-400">({actionLog.length} entries)</span>
              </summary>
              <div className="border-t border-gray-200 px-3 py-3">
                <div className="flex justify-end mb-2">
                  <button
                    onClick={() => navigator.clipboard?.writeText(actionLog.map(formatEntry).join('\n'))}
                    className={`${tierUnit} hover:text-gray-700`}
                  >
                    Copy
                  </button>
                </div>
                <div className="max-h-72 overflow-auto rounded bg-gray-900 p-3 font-mono text-[11px] leading-relaxed text-gray-100">
                  {actionLog.map((entry, idx) => (
                    <div key={idx} className="flex items-start gap-2 whitespace-pre-wrap break-words">
                      <span className={`shrink-0 rounded px-1 ${CATEGORY_STYLE[entry.category] || 'bg-gray-200 text-gray-700'}`}>
                        {CATEGORY_LABEL[entry.category] || entry.category || 'log'}
                      </span>
                      <span>{formatEntry(entry)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

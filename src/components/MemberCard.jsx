// Member card + its per-month availability calendar. These are members-domain
// UI (not app-wide primitives), so they live in their own module rather than
// the shared grab-bag. Reusable primitives/hooks stay in SharedComponents.jsx.
import { useState } from 'react'
import { monoChip, glassPanel, tierSection } from '../utils/statsTheme'
import { expandUnavailableDays, monthsFromDays, monthGridCells, MONTH_LABEL, WEEKDAY_INITIALS } from '../lib/calendarUtils'

/**
 * A minimalist month grid for member unavailability. Unavailable days are
 * shaded (muted slate, matching the app's monochrome availability cue);
 * everything else is a plain neutral day. Only rendered for months that
 * actually contain an unavailable day (see MemberCard).
 */
const MonthCalendar = ({ year, month, unavailable }) => {
  const cells = monthGridCells(year, month, unavailable)
  return (
    <div>
      <div className="mt-1 mb-2 text-center text-[10px] font-medium uppercase tracking-wide text-gray-500">{MONTH_LABEL(year, month)}</div>
      <div className="grid grid-cols-7 gap-px text-center">
        {WEEKDAY_INITIALS.map((wd, i) => (
          <div key={`wd-${i}`} className="text-[9px] text-gray-500">{wd}</div>
        ))}
        {cells.map((cell, i) =>
          cell === null ? (
            <div key={`pad-${i}`} />
          ) : (
            <div
              key={cell.key}
              title={cell.isUnavailable ? 'Unavailable' : undefined}
              className={`aspect-square flex items-center justify-center rounded-sm text-[11px] leading-none ${
                cell.isUnavailable
                  ? 'bg-slate-500/70 text-white font-medium'
                  : 'text-gray-500'
              }`}
            >
              {cell.day}
            </div>
          )
        )}
      </div>
    </div>
  )
}

export const MemberCard = ({ member, roleColorMap, memberConstraints, memberPreferences, activeTeamName, otherTeams = [] }) => {
  const [showUnavailability, setShowUnavailability] = useState(false)
  const [showPreferences, setShowPreferences] = useState(false)
  
  // Find constraints for this member using member.id
  const memberConstraintData = memberConstraints?.find(c => c.member_id === member.id)
  const unavailableDates = memberConstraintData?.unavailable_dates || []
  const constraintNote = memberConstraintData?.note

  // Expand the (polymorphic single-date | {start,end} range) list into concrete
  // days, then group into the months to render as compact calendars. Only
  // months that actually contain an unavailable day get a grid.
  const unavailableDays = expandUnavailableDays(unavailableDates)
  const unavailableMonths = monthsFromDays(unavailableDays)
  const hasUnavailability = unavailableDays.size > 0

  // Find preferences for this member
  const memberPreferenceData = memberPreferences?.find(p => p.member_id === member.id)
  const preferredDays = memberPreferenceData?.days || []
  const preferredRoles = memberPreferenceData?.roles || []
  const hasPreferences = preferredDays.length > 0 || preferredRoles.length > 0
  
  return (
    <div className={`${glassPanel} p-4 h-full flex flex-col hover:shadow-xl hover:bg-white/50 transition-all ${member.include === false ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-gray-900">{member.name}</h3>
        {member.include === false && (
          <span className={`px-2 py-1 text-xs font-medium rounded ${monoChip}`}>Inactive</span>
        )}
      </div>
      {member.telegram && (
        <div className="text-xs text-gray-400 mb-3">{member.telegram}</div>
      )}
      {/* Multi-tenant: divider + label marking the transition from tenant-level
          IDENTITY (name/telegram/global unavailability above) to this team's
          CAPABILITY (roles/understudy below). Only shown in a tenant context
          (activeTeamName present); flat/single-team cards look unchanged. */}
      {activeTeamName && (
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">on {activeTeamName}</span>
          <span className="h-px flex-1 bg-gray-200" />
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {member.roles?.map((role, i) => (
          <span key={i} className={`px-1.5 py-0.5 rounded border border-gray-200/70 bg-white/30 text-xs font-medium ${roleColorMap[role] || 'text-gray-700'}`}>
            {role}
          </span>
        ))}
        {member.understudyFor?.map((role, i) => (
          <span
            key={`u-${i}`}
            title={`Training as understudy for ${role}`}
            className={`px-1.5 py-0.5 rounded border border-dashed border-gray-300/70 bg-white/30 text-xs font-medium italic opacity-80 ${roleColorMap[role] || 'text-gray-700'}`}
          >
            {role} (understudy)
          </span>
        ))}
      </div>
      {/* Cross-team visibility — only for members who also serve on OTHER teams. */}
      {otherTeams.length > 0 && (
        <div className="text-xs text-gray-400 mb-3">
          Also on: <span className="text-gray-500">{otherTeams.join(', ')}</span>
        </div>
      )}
      {constraintNote && (
        <div className="text-xs text-gray-600 bg-gray-100/70 px-2 py-1.5 rounded border border-gray-200/60 mb-3">
          {constraintNote}
        </div>
      )}
      
      {/* Footer section — always rendered and flushed to the bottom (mt-auto)
          so it anchors every card's bottom edge for visual consistency across
          the equal-height grid row. Unavailable is ALWAYS shown (even when the
          member has no unavailable days, mirroring the always-present event
          "Availability Details"); Preferences stays conditional. */}
      <div className="mt-auto pt-2 border-t border-gray-200 space-y-2">
          {/* Unavailable Period — a compact month calendar per month that has
              unavailable days, instead of a flat list of date ranges. */}
          <div>
            <button
              onClick={() => hasUnavailability && setShowUnavailability(!showUnavailability)}
              disabled={!hasUnavailability}
              className={`flex items-center gap-1 w-full text-left ${tierSection} ${hasUnavailability ? 'hover:text-gray-700' : 'cursor-default'}`}
            >
              {hasUnavailability ? (showUnavailability ? '▼' : '▶') : <span className="opacity-0">▶</span>} {activeTeamName ? 'Unavailable (global)' : 'Unavailable'}{' '}
              <span className="text-gray-400 font-normal normal-case tracking-normal">
                {hasUnavailability ? `(${unavailableDays.size} day${unavailableDays.size !== 1 ? 's' : ''})` : '(none)'}
              </span>
            </button>
            {hasUnavailability && showUnavailability && (
              <div className="mt-2 space-y-3">
                {unavailableMonths.map(m => (
                  <MonthCalendar key={m.key} year={m.year} month={m.month} unavailable={m.unavailable} />
                ))}
              </div>
            )}
          </div>
          
          {/* Preferences */}
          {hasPreferences && (
            <div>
              <button
                onClick={() => setShowPreferences(!showPreferences)}
                className={`flex items-center gap-1 w-full text-left ${tierSection} hover:text-gray-700`}
              >
                {showPreferences ? '▼' : '▶'} Preferences
              </button>
              {showPreferences && (
                <div className="mt-2 space-y-1">
                  {preferredDays.length > 0 && (
                    <div className={`text-xs text-gray-700 px-2 py-1.5 rounded ${monoChip}`}>
                      Prefers days: {preferredDays.join(', ')}
                    </div>
                  )}
                  {preferredRoles.length > 0 && (
                    <div className={`text-xs text-gray-700 px-2 py-1.5 rounded ${monoChip}`}>
                      Prefers roles: {preferredRoles.join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
    </div>
  )
}

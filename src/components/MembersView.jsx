import { useState } from 'react'
import { IssueSummary } from './SharedComponents'
import { MemberCard } from './MemberCard'
import { headingPage, hoverRow } from '../utils/statsTheme'

export default function MembersView({ members, roles, roleColorMap, warnings, searchQuery, memberConstraints, memberPreferences, activeTeamName, memberTeams = {} }) {
  const [selectedRole, setSelectedRole] = useState('All')

  const searchLower = searchQuery.toLowerCase()
  const isActive = (m) => m.include !== false

  // A member matches a selected role if they can perform it OR are training for
  // it as an understudy.
  const matchesRole = (m, role) =>
    role === 'All' || m.roles?.includes(role) || m.understudyFor?.includes(role)

  // Show everyone (active + inactive), inactive members sorted last and marked
  // as such on their card.
  const filteredMembers = members
    .filter(m =>
      matchesRole(m, selectedRole) &&
      (!searchQuery || m.name.toLowerCase().includes(searchLower) || m.telegram?.toLowerCase().includes(searchLower))
    )
    .sort((a, b) =>
      (isActive(a) === isActive(b)) ? a.name.localeCompare(b.name) : (isActive(a) ? -1 : 1)
    )

  // Counts reflect active members only (inactive members aren't rostered).
  const roleCount = (role) => members.filter(m => isActive(m) && matchesRole(m, role)).length

  const warningItems = (warnings || []).map(w => ({ level: 'warning', msg: w }))

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 sm:mb-6">
        <div className="flex items-center gap-3">
          <h2 className={headingPage}>Members</h2>
          <IssueSummary warningCount={warnings?.length || 0} items={warningItems} />
        </div>
      </div>
      
      {/* Role Filter Buttons — neutral glass chips; the role hue shows only in
          the label text (matching the coloured-font role tags elsewhere). */}
      <div className="mb-6 flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedRole('All')}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${selectedRole === 'All' ? 'bg-gray-800 text-white shadow-sm' : `bg-white/50 backdrop-blur-sm border border-white/40 text-gray-700 ${hoverRow}`}`}
        >
          All ({roleCount('All')})
        </button>
        {roles.map(role => (
          <button
            key={role}
            onClick={() => setSelectedRole(role)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all bg-white/50 backdrop-blur-sm border ${selectedRole === role ? 'border-gray-400 shadow-sm' : `border-white/40 opacity-70 hover:opacity-100 ${hoverRow}`}`}
          >
            <span className={roleColorMap[role]}>{role}</span>
            <span className="ml-1 text-gray-500">({roleCount(role)})</span>
          </button>
        ))}
      </div>

      {/* Member Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {filteredMembers.map((member, i) => {
          // Cross-team visibility: other teams this member serves on, excluding
          // the active team. Only present in multi-team tenants (empty otherwise),
          // so the "Also on" line only shows for multi-team members.
          const otherTeams = (memberTeams[member.id] || []).filter(t => t !== activeTeamName)
          return (
            <MemberCard
              key={i}
              member={member}
              roleColorMap={roleColorMap}
              memberConstraints={memberConstraints}
              memberPreferences={memberPreferences}
              activeTeamName={activeTeamName}
              otherTeams={otherTeams}
            />
          )
        })}
      </div>

      {filteredMembers.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          No members found matching your criteria
        </div>
      )}
    </div>
  )
}

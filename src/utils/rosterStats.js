/**
 * Calculate roster statistics for members
 * @param {Array} events - All events with roster assignments
 * @param {Array} members - All members
 * @param {Object} rosterPeriod - Roster period with start_date and end_date
 * @returns {Object} - Statistics including total slots, per-member stats, etc.
 */
import { AssignmentTracker } from '../state/assignmentTracker'
import { EligibilityChecker } from './rosterGenerator/eligibilityChecker'
import { isMemberIncluded } from '../schema/rosterSchema'

export const calculateRosterStats = (events, members, rosterPeriod, memberConstraints = {}, rosterConstraints = {}) => {
  if (!events || !members || !rosterPeriod) {
    return {
      totalSlots: 0,
      totalEvents: 0,
      monthCount: 0,
      avgSlotsPerEvent: 0,
      avgSlotsPerMonth: 0,
      avgSlotsPerMember: 0,
      memberStats: [],
      unassignableRoles: []
    }
  }

  const activeMembers = members.filter(isMemberIncluded)
  
  // Count total slots needed across all events
  let totalSlots = 0
  const memberAssignments = {}
  const memberRoleAssignments = {} // Track role diversity per member
  const memberDates = {} // Track each member's assignment dates for time-spacing

  events.forEach(event => {
    if (event.roster && Array.isArray(event.roster)) {
      event.roster.forEach(assignment => {
        totalSlots++ // Count all slots, not just assigned ones
        
        // Count assignments per member (using both member_id and id fields)
        const memberId = assignment.member_id || assignment.id
        if (memberId) {
          memberAssignments[memberId] = (memberAssignments[memberId] || 0) + 1
          if (event.date) {
            if (!memberDates[memberId]) memberDates[memberId] = []
            memberDates[memberId].push({ date: event.date, role: assignment.role || null })
          }
          
          // Track role diversity
          if (!memberRoleAssignments[memberId]) {
            memberRoleAssignments[memberId] = {}
          }
          if (assignment.role) {
            memberRoleAssignments[memberId][assignment.role] = 
              (memberRoleAssignments[memberId][assignment.role] || 0) + 1
          }
        }
      })
    }
  })

  // Calculate months in roster period
  const startDate = new Date(rosterPeriod.start_date)
  const endDate = new Date(rosterPeriod.end_date)
  const monthsDiff = (endDate.getFullYear() - startDate.getFullYear()) * 12 + 
                     (endDate.getMonth() - startDate.getMonth()) + 1

  // Calculate statistics
  const totalEvents = events.length
  const avgSlotsPerEvent = totalEvents > 0 ? totalSlots / totalEvents : 0
  const avgSlotsPerMonth = monthsDiff > 0 ? totalSlots / monthsDiff : 0
  const avgSlotsPerMember = activeMembers.length > 0 ? totalSlots / activeMembers.length : 0

  // Calculate per-member statistics
  const memberStats = activeMembers.map(member => {
    const assignments = memberAssignments[member.id] || 0
    const avgPerMonth = monthsDiff > 0 ? assignments / monthsDiff : 0
    const percentageOfTotal = totalSlots > 0 ? (assignments / totalSlots) * 100 : 0
    
    // Calculate role diversity per member
    const roles = memberRoleAssignments[member.id] || {}
    const uniqueRoles = Object.keys(roles).length
    const roleDistribution = roles

    // Sorted (ascending) assignment entries {date, role}, so the UI can plot a
    // timeline of dots (dot tooltip = the event assignment) and compute the
    // week-gap between consecutive dots.
    const assignmentDates = (memberDates[member.id] || [])
      .slice()
      .sort((a, b) => new Date(a.date) - new Date(b.date))
    // Time spacing: average number of days between this member's consecutive
    // shifts. Meaningful to a scheduler ("roughly every N days"); null when the
    // member has fewer than two shifts (no gap to measure).
    const avgGapDays = averageGapDays(assignmentDates.map(a => a.date))
    
    return {
      id: member.id,
      name: member.name,
      totalAssignments: assignments,
      avgPerMonth: avgPerMonth,
      percentageOfTotal: percentageOfTotal,
      uniqueRoles: uniqueRoles,
      roleDistribution: roleDistribution,
      avgGapDays: avgGapDays,
      assignmentDates: assignmentDates
    }
  }).sort((a, b) => b.totalAssignments - a.totalAssignments)
  
  // Calculate role diversity: measure variety of members per role
  const roleVariety = {}
  events.forEach(event => {
    if (event.roster && Array.isArray(event.roster)) {
      event.roster.forEach(assignment => {
        const memberId = assignment.member_id || assignment.id
        if (memberId && assignment.role) {
          if (!roleVariety[assignment.role]) {
            roleVariety[assignment.role] = new Set()
          }
          roleVariety[assignment.role].add(memberId)
        }
      })
    }
  })
  
  const roleStats = Object.entries(roleVariety).map(([role, memberSet]) => {
    const totalAssignments = Object.values(memberRoleAssignments).reduce(
      (sum, roles) => sum + (roles[role] || 0), 0
    )
    return {
      role,
      uniqueMembers: memberSet.size,
      totalAssignments,
      // Rotation ratio: fraction of a role's shifts filled by distinct people.
      // 1.0 = every shift went to a different member (max rotation); low = the
      // same few people repeat the role. This is the per-role rotation bar.
      rotationRatio: totalAssignments > 0 ? memberSet.size / totalAssignments : 0
    }
  })
  
  const avgMembersPerRole = roleStats.length > 0 
    ? roleStats.reduce((sum, r) => sum + r.uniqueMembers, 0) / roleStats.length 
    : 0

  // Live fairness metrics computed from the CURRENT roster state (not a
  // generation snapshot), so statistics update in real time as slots are
  // edited/swapped. Reuses AssignmentTracker so the formulas stay identical to
  // the generator's fairness/spread scores.
  const tracker = new AssignmentTracker(activeMembers, events, rosterPeriod)
  const assignmentsByMember = {}
  let assignedRoles = 0
  activeMembers.forEach(m => {
    const total = tracker.getAssignmentCount(m.id)
    assignmentsByMember[m.id] = { total }
    assignedRoles += total
  })
  const fairnessMetrics = {
    assignmentStdDev: tracker.getFairnessScore(),
    spreadStdDev: tracker.getSpreadScore(),
    assignmentsByMember
  }

  // Live "unassignable roles": slots that are CURRENTLY empty and for which no
  // active member is eligible under the current roster + constraints. Computed
  // from the live `events` (not a generation snapshot) so the warning clears the
  // moment a slot is filled — manually or by generation — and reappears if an
  // eligible-less slot is emptied. Once-per-event eligibility is judged against
  // the event's already-filled slots. See README → "Unassignable-roles warning
  // is live, not a generation snapshot".
  const eligibilityChecker = new EligibilityChecker(activeMembers, memberConstraints, rosterConstraints, tracker)
  const unassignableRoles = []
  events.forEach(event => {
    if (!event.roster || !Array.isArray(event.roster)) return
    const filledRoster = event.roster.filter(s => s.member_id)
    event.roster.forEach(assignment => {
      if (assignment.member_id) return // filled → not unassignable
      if (eligibilityChecker.getEligibleMembers(assignment.role, event, filledRoster).length === 0) {
        unassignableRoles.push({
          event: event.name,
          date: event.date,
          role: assignment.role,
          reason: 'No eligible members available'
        })
      }
    })
  })

  return {
    totalSlots,
    totalEvents,
    monthCount: monthsDiff,
    avgSlotsPerEvent: Math.round(avgSlotsPerEvent * 10) / 10,
    avgSlotsPerMonth: Math.round(avgSlotsPerMonth * 10) / 10,
    avgSlotsPerMember: Math.round(avgSlotsPerMember * 10) / 10,
    memberStats,
    fairnessMetrics,
    assignedRoles,
    unassignableRoles,
    // Roster date bounds, so the Time Spacing timeline can position dots on a
    // shared axis across all members.
    periodStart: rosterPeriod.start_date,
    periodEnd: rosterPeriod.end_date,
    roleDiversity: {
      roleStats: roleStats,
      avgMembersPerRole: Math.round(avgMembersPerRole * 10) / 10,
      totalRoles: roleStats.length
    }
  }
}

/**
 * Average number of days between consecutive (date-sorted) assignments.
 * Returns null when there are fewer than two dates — a single shift has no gap
 * to measure, so callers can render "—" rather than a misleading 0.
 * @param {string[]|undefined} dates
 * @returns {number|null}
 */
function averageGapDays(dates) {
  if (!dates || dates.length < 2) return null
  const sorted = dates.map(d => new Date(d).getTime()).sort((a, b) => a - b)
  let totalGap = 0
  for (let i = 1; i < sorted.length; i++) {
    totalGap += (sorted[i] - sorted[i - 1]) / (1000 * 60 * 60 * 24)
  }
  return Math.round((totalGap / (sorted.length - 1)) * 10) / 10
}

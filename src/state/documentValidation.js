/**
 * Validation Builder for extensible validation rules
 */

import { normalizeMemberRoles, understudySlotRole, isUnderstudyRole, baseRoleOf } from '../utils/understudy'
import { isMemberIncluded } from '../schema/rosterSchema'

export class ValidationBuilder {
  constructor(data) {
    this.data = data
    this.errors = []
    this.warnings = []
  }

  validate(validatorFn) {
    const result = validatorFn(this.data)
    if (result.errors) {
      this.errors.push(...result.errors)
    }
    if (result.warnings) {
      this.warnings.push(...result.warnings)
    }
    return this
  }

  getResults() {
    return {
      isValid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
      hasWarnings: this.warnings.length > 0
    }
  }
}

export const validateYamlStructure = (data) => {
  const errors = []
  const warnings = []

  if (!data) {
    errors.push('YAML data is empty or invalid')
    return { errors, warnings }
  }

  if (!data.members || !Array.isArray(data.members)) {
    errors.push('Missing or invalid "members" array in YAML')
  }

  if (data.events !== undefined && !Array.isArray(data.events)) {
    errors.push('"events" must be an array if defined')
  }

  return { errors, warnings }
}

export const validateMembers = (data) => {
  const errors = []
  const warnings = []

  if (!data?.members) return { errors, warnings }

  data.members.forEach((member, index) => {
    const memberRef = `Member #${index + 1}${member.name ? ` (${member.name})` : ''}`

    if (!member.name) {
      errors.push(`${memberRef}: Missing required field "name"`)
    }

    if (!member.roles || !Array.isArray(member.roles) || member.roles.length === 0) {
      errors.push(`${memberRef}: Missing or empty "roles" array`)
    }

    if (!member.telegram) {
      warnings.push(`${member.name || memberRef}: No telegram handle provided`)
    }

    if (member.include === undefined) {
      warnings.push(`${memberRef}: "include" field not set, defaulting to true`)
    }

    const duplicates = data.members.filter(m => m.name === member.name)
    if (duplicates.length > 1 && index === data.members.findIndex(m => m.name === member.name)) {
      warnings.push(`${memberRef}: Duplicate name detected`)
    }
  })

  return { errors, warnings }
}

export const validateTelegramHandles = (data) => {
  const errors = []
  const warnings = []

  if (!data?.members) return { errors, warnings }

  data.members.forEach((member, index) => {
    if (member.telegram) {
      const memberRef = `${member.name || `Member #${index + 1}`}`
      
      if (!member.telegram.startsWith('@')) {
        warnings.push(`${memberRef}: Telegram handle should start with @`)
      }

      if (member.telegram.length < 6) {
        warnings.push(`${memberRef}: Telegram handle seems too short`)
      }

      if (!/^@[a-zA-Z0-9_]+$/.test(member.telegram)) {
        warnings.push(`${memberRef}: Telegram handle contains invalid characters`)
      }
    }
  })

  return { errors, warnings }
}

export const validateRoles = (data) => {
  const errors = []
  const warnings = []

  if (!data?.members) return { errors, warnings }

  let baseRoles
  if (data.roles && Array.isArray(data.roles)) {
    baseRoles = data.roles.map(r => r.name || r).filter(Boolean).filter(r => !isUnderstudyRole(r))
    if (baseRoles.length === 0) {
      errors.push('Roles section is empty or invalid')
      return { errors, warnings }
    }
  } else {
    errors.push('No roles section found in YAML - roles must be defined')
    return { errors, warnings }
  }

  // The valid set auto-includes the understudy variant of every base role.
  const validRoles = new Set([...baseRoles, ...baseRoles.map(understudySlotRole)])

  data.members.forEach((member, index) => {
    const memberRef = `${member.name || `Member #${index + 1}`}`

    if (member.roles) {
      const { roles, understudyFor } = normalizeMemberRoles(member.roles)
      const declared = [...roles, ...understudyFor]

      declared.forEach(role => {
        if (!validRoles.has(role)) {
          errors.push(
            `${memberRef}: Invalid role "${role}" - not found in declared roles. ` +
            `Valid roles are: ${[...validRoles].join(', ')}`
          )
        }
      })

      // Detect duplicates from the RAW list (normalization dedupes, so we
      // compare the raw role names by their resolved base/understudy identity).
      const rawNames = (Array.isArray(member.roles) ? member.roles : [])
        .map(r => (typeof r === 'string' ? r : r?.name))
        .filter(Boolean)
      if (new Set(rawNames).size !== rawNames.length) {
        warnings.push(`${memberRef}: Has duplicate roles`)
      }
    }
  })

  return { errors, warnings }
}

/**
 * Warn about understudy misconfiguration:
 * - a member trains for role X but no X-understudy slot exists in any event
 *   (they could never satisfy the gate to unlock X).
 */
export const validateUnderstudy = (data) => {
  const errors = []
  const warnings = []

  if (!data?.members) return { errors, warnings }

  // Collect all understudy slot roles that appear in events.
  const understudySlotsInEvents = new Set()
  if (Array.isArray(data.events)) {
    data.events.forEach(event => {
      if (Array.isArray(event.roster)) {
        event.roster.forEach(slot => {
          if (slot?.role && isUnderstudyRole(slot.role)) {
            understudySlotsInEvents.add(baseRoleOf(slot.role))
          }
        })
      }
    })
  }

  data.members.forEach((member, index) => {
    const memberRef = `${member.name || `Member #${index + 1}`}`
    const { understudyFor } = normalizeMemberRoles(member.roles)
    understudyFor.forEach(role => {
      if (!understudySlotsInEvents.has(role)) {
        warnings.push(
          `${memberRef}: is an understudy for "${role}" but no "${understudySlotRole(role)}" slot exists in any event, ` +
          `so they can never unlock the "${role}" role`
        )
      }
    })
  })

  return { errors, warnings }
}

export const validateEventMemberMapping = (data) => {
  const errors = []
  const warnings = []

  if (!data?.events || !Array.isArray(data.events) || data.events.length === 0) {
    return { errors, warnings }
  }

  const memberNames = new Set(data.members?.map(m => m.name) || [])

  data.events.forEach((event, index) => {
    const eventRef = `Event #${index + 1}${event.name ? ` (${event.name})` : ''}`

    if (!event.name) {
      errors.push(`${eventRef}: Missing required field "name"`)
    }

    if (!event.date) {
      warnings.push(`${eventRef}: No date specified`)
    }
  })

  return { errors, warnings }
}

export const validateDates = (data) => {
  const errors = []
  const warnings = []
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/

  if (data?.events) {
    data.events.forEach((event, index) => {
      if (event.date && !dateRegex.test(event.date)) {
        errors.push(`Event #${index + 1}: Invalid date format "${event.date}" (expected YYYY-MM-DD)`)
      }
      // Optional datetime range (see specs/data-layer.md, "Time granularity").
      // When present it must parse; a start after its end is nonsensical.
      const startMs = event.start ? new Date(event.start).getTime() : null
      const endMs = event.end ? new Date(event.end).getTime() : null
      if (event.start && Number.isNaN(startMs)) {
        errors.push(`Event #${index + 1}: Invalid start datetime "${event.start}"`)
      }
      if (event.end && Number.isNaN(endMs)) {
        errors.push(`Event #${index + 1}: Invalid end datetime "${event.end}"`)
      }
      if (startMs != null && endMs != null && !Number.isNaN(startMs) && !Number.isNaN(endMs) && startMs > endMs) {
        errors.push(`Event #${index + 1}: start datetime must not be after end datetime`)
      }
    })
  }

  if (data?.roster) {
    if (data.roster.start_date && !dateRegex.test(data.roster.start_date)) {
      errors.push(`Roster period: Invalid start_date format (expected YYYY-MM-DD)`)
    }
    if (data.roster.end_date && !dateRegex.test(data.roster.end_date)) {
      errors.push(`Roster period: Invalid end_date format (expected YYYY-MM-DD)`)
    }
  }

  return { errors, warnings }
}

export const validateRosterPeriod = (data) => {
  const errors = []
  const warnings = []

  if (data?.roster) {
    if (!data.roster.start_date) {
      warnings.push('Roster period: Missing start_date')
    }
    if (!data.roster.end_date) {
      warnings.push('Roster period: Missing end_date')
    }

    if (data.roster.start_date && data.roster.end_date) {
      if (data.roster.start_date > data.roster.end_date) {
        errors.push('Roster period: start_date must be before end_date')
      }

      // Check if events are outside roster period
      if (data.events && Array.isArray(data.events)) {
        data.events.forEach((event) => {
          if (event.date && (event.date < data.roster.start_date || event.date > data.roster.end_date)) {
            warnings.push(`Event "${event.name || event.date}" is outside roster period`)
          }
        })
      }

      // Check if member constraint dates are outside roster period
      if (data.member_constraints && Array.isArray(data.member_constraints)) {
        data.member_constraints.forEach((constraint) => {
          if (constraint.unavailable_dates && Array.isArray(constraint.unavailable_dates)) {
            const memberName = data.members?.find(m => (m.id || m.name) === constraint.member_id)?.name || constraint.member_id
            
            constraint.unavailable_dates.forEach((dateItem) => {
              // Handle both string dates and date range objects
              if (typeof dateItem === 'string') {
                if (dateItem < data.roster.start_date || dateItem > data.roster.end_date) {
                  warnings.push(`${memberName}: Unavailable date ${dateItem} is outside roster period`)
                }
              } else if (dateItem && typeof dateItem === 'object' && dateItem.start && dateItem.end) {
                if (dateItem.end < data.roster.start_date || dateItem.start > data.roster.end_date) {
                  warnings.push(`${memberName}: Date range ${dateItem.start} to ${dateItem.end} is completely outside roster period`)
                }
              }
            })
          }
        })
      }
    }
  }

  return { errors, warnings }
}

export const validateMemberConstraints = (data) => {
  const errors = []
  const warnings = []

  if (!data?.members) return { errors, warnings }

  // Check for members without constraints
  const includedMembers = data.members.filter(isMemberIncluded)
  const constraintMap = new Map()
  
  if (data.member_constraints && Array.isArray(data.member_constraints)) {
    data.member_constraints.forEach((constraint) => {
      if (constraint.member_id) {
        constraintMap.set(constraint.member_id, constraint)
      }
    })
  }

  includedMembers.forEach((member) => {
    const memberId = member.id || member.name
    const constraint = constraintMap.get(memberId)
    
    if (!constraint || !constraint.unavailable_dates || 
        (Array.isArray(constraint.unavailable_dates) && constraint.unavailable_dates.length === 0)) {
      warnings.push(`${member.name}: No unavailable dates specified in member constraints`)
    }
  })

  // Check for invalid member references
  const validMemberIds = new Set(data.members.map(m => m.id || m.name))
  
  if (data.member_constraints) {
    data.member_constraints.forEach((constraint, index) => {
      if (!constraint.member_id) {
        errors.push(`Member constraint #${index + 1}: Missing member_id`)
      } else if (!validMemberIds.has(constraint.member_id)) {
        const memberName = data.members.find(m => m.id === constraint.member_id)?.name || constraint.member_id
        warnings.push(`Member constraint for "${memberName}": Member not found`)
      }
    })
  }

  return { errors, warnings }
}

export const runAllValidators = (data) => {
  return new ValidationBuilder(data)
    .validate(validateYamlStructure)
    .validate(validateDates)
    .validate(validateMembers)
    .validate(validateTelegramHandles)
    .validate(validateRoles)
    .validate(validateUnderstudy)
    .validate(validateEventMemberMapping)
    .validate(validateRosterPeriod)
    .validate(validateMemberConstraints)
    .getResults()
}

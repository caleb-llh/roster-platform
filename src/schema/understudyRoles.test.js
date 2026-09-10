import { describe, it, expect } from 'vitest'
import {
  understudySlotRole,
  isUnderstudyRole,
  baseRoleOf,
  normalizeMemberRoles,
} from './understudyRoles'

describe('understudy role vocabulary', () => {
  it('builds and detects understudy slot roles', () => {
    expect(understudySlotRole('multi-vm')).toBe('multi-vm-understudy')
    expect(isUnderstudyRole('multi-vm-understudy')).toBe(true)
    expect(isUnderstudyRole('multi-vm')).toBe(false)
    expect(baseRoleOf('multi-vm-understudy')).toBe('multi-vm')
    expect(baseRoleOf('multi-vm')).toBeNull()
  })

  describe('normalizeMemberRoles', () => {
    it('keeps plain string roles as full roles', () => {
      const { roles, understudyFor } = normalizeMemberRoles(['vm', 'main-cam'])
      expect(roles).toEqual(['vm', 'main-cam'])
      expect(understudyFor).toEqual([])
    })

    it('pulls understudy-flagged roles out of full roles', () => {
      const { roles, understudyFor } = normalizeMemberRoles([
        { name: 'multi-vm', understudy: true },
        'vm',
        'main-cam',
      ])
      expect(roles).toEqual(['vm', 'main-cam'])
      expect(understudyFor).toEqual(['multi-vm'])
    })

    it('treats object without understudy flag as a full role', () => {
      const { roles, understudyFor } = normalizeMemberRoles([{ name: 'vm' }])
      expect(roles).toEqual(['vm'])
      expect(understudyFor).toEqual([])
    })

    it('lets full capability win over understudy for the same role', () => {
      const { roles, understudyFor } = normalizeMemberRoles([
        'multi-vm',
        { name: 'multi-vm', understudy: true },
      ])
      expect(roles).toEqual(['multi-vm'])
      expect(understudyFor).toEqual([])
    })

    it('dedupes roles', () => {
      const { roles } = normalizeMemberRoles(['roving-cam', 'roving-cam', 'vm'])
      expect(roles).toEqual(['roving-cam', 'vm'])
    })

    it('handles empty / missing input', () => {
      expect(normalizeMemberRoles(undefined)).toEqual({ roles: [], understudyFor: [] })
      expect(normalizeMemberRoles([])).toEqual({ roles: [], understudyFor: [] })
    })
  })
})

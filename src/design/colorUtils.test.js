import { describe, it, expect } from 'vitest'
import { 
  COLOR_PALETTE, 
  DAY_CARD_COLORS,
  createRoleColorMap, 
  getCardColorForDay,
  formatDate,
  formatDateRange
} from './colorUtils'

describe('colorUtils', () => {
  describe('COLOR_PALETTE', () => {
    it('should have 10 color definitions', () => {
      expect(COLOR_PALETTE).toHaveLength(10)
    })

    it('should have valid Tailwind text-colour classes', () => {
      COLOR_PALETTE.forEach(color => {
        expect(color).toMatch(/^text-\w+-\d+$/)
      })
    })
  })

  describe('DAY_CARD_COLORS', () => {
    it('should have 7 colors for days of week', () => {
      expect(DAY_CARD_COLORS).toHaveLength(7)
    })

    it('should include hover states', () => {
      DAY_CARD_COLORS.forEach(color => {
        expect(color).toContain('hover:')
      })
    })
  })

  describe('createRoleColorMap', () => {
    it('should map roles to colors', () => {
      const roles = ['vm', 'cam-1', 'cam-2']
      const colorMap = createRoleColorMap(roles)
      
      expect(colorMap).toHaveProperty('vm')
      expect(colorMap).toHaveProperty('cam-1')
      expect(colorMap).toHaveProperty('cam-2')
    })

    it('should cycle through colors for many roles', () => {
      const roles = Array.from({ length: 15 }, (_, i) => `role-${i}`)
      const colorMap = createRoleColorMap(roles)
      
      expect(colorMap['role-0']).toBe(COLOR_PALETTE[0])
      expect(colorMap['role-10']).toBe(COLOR_PALETTE[0]) // Should cycle
    })

    it('should handle empty role array', () => {
      const colorMap = createRoleColorMap([])
      expect(Object.keys(colorMap)).toHaveLength(0)
    })
  })

  describe('getCardColorForDay', () => {
    it('should return correct color for each day', () => {
      for (let i = 0; i < 7; i++) {
        const color = getCardColorForDay(i)
        expect(color).toBe(DAY_CARD_COLORS[i])
      }
    })

    it('should cycle for days beyond 6', () => {
      expect(getCardColorForDay(7)).toBe(DAY_CARD_COLORS[0])
      expect(getCardColorForDay(14)).toBe(DAY_CARD_COLORS[0])
    })
  })

  describe('formatDate', () => {
    it('should format date with default options', () => {
      const result = formatDate('2026-02-15')
      expect(result).toMatch(/Feb\s+15/)
    })

    it('should accept custom options', () => {
      const result = formatDate('2026-02-15', { 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric' 
      })
      expect(result).toContain('February')
      expect(result).toContain('2026')
    })
  })

  describe('formatDateRange', () => {
    it('should format date range correctly', () => {
      const result = formatDateRange('2026-02-01', '2026-04-30')
      expect(result).toMatch(/Feb\s+1,\s+2026\s+-\s+Apr\s+30,\s+2026/)
    })
  })
})

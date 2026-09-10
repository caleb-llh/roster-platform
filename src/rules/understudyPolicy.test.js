import { describe, it, expect } from 'vitest'
import {
  canFillSlotRole,
  isRoleCapable,
  countUnderstudySessionsBefore,
  isPromotedForRole,
  UNDERSTUDY_MIN_SESSIONS,
} from './understudyPolicy'

describe('understudy policy', () => {
  it('exposes a default minimum sessions of at least 1', () => {
    expect(UNDERSTUDY_MIN_SESSIONS).toBeGreaterThanOrEqual(1)
  })

  describe('canFillSlotRole (UI/dropdown rule)', () => {
    const performer = { roles: ['main-cam'], understudyFor: [] }
    const trainee = { roles: [], understudyFor: ['main-cam'] }

    it('lets a performer fill the real role', () => {
      expect(canFillSlotRole(performer, 'main-cam')).toBe(true)
      expect(canFillSlotRole(trainee, 'main-cam')).toBe(false)
    })

    it('lets only trainees fill an understudy slot (performers excluded)', () => {
      expect(canFillSlotRole(trainee, 'main-cam-understudy')).toBe(true)
      expect(canFillSlotRole(performer, 'main-cam-understudy')).toBe(false)
    })

    it('is safe on null member / missing arrays', () => {
      expect(canFillSlotRole(null, 'main-cam')).toBe(false)
      expect(canFillSlotRole({}, 'main-cam')).toBe(false)
      expect(canFillSlotRole({}, 'main-cam-understudy')).toBe(false)
    })
  })

  describe('isRoleCapable (generator ENFORCE_MEMBER_ROLES rule)', () => {
    const trainee = { roles: [], understudyFor: ['main-cam'] }

    it('treats a trainee as capable of the REAL role (gate enforces timing)', () => {
      expect(isRoleCapable(trainee, 'main-cam')).toBe(true)
    })

    it('keeps understudy slots trainees-only', () => {
      const performer = { roles: ['main-cam'], understudyFor: [] }
      expect(isRoleCapable(trainee, 'main-cam-understudy')).toBe(true)
      expect(isRoleCapable(performer, 'main-cam-understudy')).toBe(false)
    })
  })

  describe('promotion helpers (UI)', () => {
    const events = [
      { date: '2026-02-01', roster: [{ role: 'multi-vm-understudy', member_id: 'dana' }] },
      { date: '2026-02-15', roster: [{ role: 'multi-vm-understudy', member_id: 'dana' }] },
      { date: '2026-03-01', roster: [{ role: 'multi-vm', member_id: null }] },
    ]

    it('counts only understudy sessions strictly before the given date', () => {
      expect(countUnderstudySessionsBefore('dana', 'multi-vm', events, '2026-03-01')).toBe(2)
      expect(countUnderstudySessionsBefore('dana', 'multi-vm', events, '2026-02-15')).toBe(1)
      expect(countUnderstudySessionsBefore('dana', 'multi-vm', events, '2026-02-01')).toBe(0)
    })

    it('promotes a trainee once they meet the minimum sessions', () => {
      const trainee = { id: 'dana', roles: ['vm'], understudyFor: ['multi-vm'] }
      expect(isPromotedForRole(trainee, 'multi-vm', events, '2026-03-01')).toBe(true)
      expect(isPromotedForRole(trainee, 'multi-vm', events, '2026-02-01')).toBe(false)
    })

    it('never promotes a non-trainee for the role', () => {
      const performer = { id: 'x', roles: ['multi-vm'], understudyFor: [] }
      expect(isPromotedForRole(performer, 'multi-vm', events, '2026-03-01')).toBe(false)
    })
  })
})

import { describe, it, expect } from 'vitest'
import { memberNameById } from './memberLookup'

const members = [
  { id: 'm1', name: 'Alice' },
  { id: 'm2', name: '' },
  { id: 'm3' },
]

describe('memberNameById', () => {
  it('returns the member name when present', () => {
    expect(memberNameById(members, 'm1')).toBe('Alice')
  })

  it('falls back to the raw id when the member has no name', () => {
    expect(memberNameById(members, 'm2')).toBe('m2')
    expect(memberNameById(members, 'm3')).toBe('m3')
  })

  it('falls back to the id for an unknown member', () => {
    expect(memberNameById(members, 'ghost')).toBe('ghost')
  })

  it('passes null/absent ids through as null (an empty slot has no name)', () => {
    expect(memberNameById(members, null)).toBe(null)
    expect(memberNameById(members, undefined)).toBe(null)
    expect(memberNameById(members, '')).toBe(null)
  })
})

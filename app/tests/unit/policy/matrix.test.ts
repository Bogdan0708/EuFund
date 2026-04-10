import { describe, it, expect } from 'vitest'
import { POLICY_MATRIX, type PolicyRule } from '@/lib/ai/agent/policy/matrix'

const EXPECTED_KEYS = [
  'setSelectedCall',
  'freezeOutline',
  'saveSectionDraft',
  'approveSection',
  'rollbackSection',
  'markSectionStale',
  'rejectSection',
  'setApplicationStatus',
] as const

describe('POLICY_MATRIX', () => {
  it('contains exactly the 8 Phase 3 mutation keys', () => {
    const keys = Object.keys(POLICY_MATRIX).sort()
    expect(keys).toEqual([...EXPECTED_KEYS].sort())
  })

  it('every rule has ownership, stateVersion, and auditAction fields', () => {
    for (const key of EXPECTED_KEYS) {
      const rule = POLICY_MATRIX[key]
      expect(rule.requiresOwnership).toBe(true)
      expect(rule.requiresStateVersion).toBe(true)
      expect(rule.auditAction).toBeTypeOf('string')
      expect(rule.auditAction.length).toBeGreaterThan(0)
    }
  })

  it('setSelectedCall forbids outline frozen and does not require eligibility', () => {
    const rule = POLICY_MATRIX.setSelectedCall
    expect(rule.forbidsOutlineFrozen).toBe(true)
    expect(rule.requiresEligibility).toBe('none')
  })

  it('freezeOutline requires call selected and eligibility passed', () => {
    const rule = POLICY_MATRIX.freezeOutline
    expect(rule.requiresCallSelected).toBe(true)
    expect(rule.requiresEligibility).toBe('passed')
    expect(rule.forbidsOutlineFrozen).toBe(true)
  })

  it('saveSectionDraft requires outline frozen and eligibility passed', () => {
    const rule = POLICY_MATRIX.saveSectionDraft
    expect(rule.requiresOutlineFrozen).toBe(true)
    expect(rule.requiresEligibility).toBe('passed')
  })

  it('approveSection requires outline frozen and restricts section state', () => {
    const rule = POLICY_MATRIX.approveSection
    expect(rule.requiresOutlineFrozen).toBe(true)
    expect(rule.allowedSectionStates).toEqual(['draft', 'needs_review'])
  })

  it('rollbackSection requires outline frozen with no section state restriction', () => {
    const rule = POLICY_MATRIX.rollbackSection as PolicyRule
    expect(rule.requiresOutlineFrozen).toBe(true)
    expect(rule.allowedSectionStates).toBeUndefined()
  })

  it('markSectionStale allowed from draft/needs_review/accepted', () => {
    const rule = POLICY_MATRIX.markSectionStale
    expect(rule.allowedSectionStates?.sort()).toEqual(['accepted', 'draft', 'needs_review'])
  })

  it('rejectSection allowed from draft/needs_review/rejected (for same-reason no-op)', () => {
    const rule = POLICY_MATRIX.rejectSection
    expect(rule.allowedSectionStates?.sort()).toEqual(['draft', 'needs_review', 'rejected'])
  })

  it('setApplicationStatus has status-change metadata', () => {
    const rule = POLICY_MATRIX.setApplicationStatus
    expect(rule.auditAction).toBe('session.status_change')
  })

  it('all audit actions are non-empty and follow dotted convention', () => {
    for (const key of EXPECTED_KEYS) {
      const action = POLICY_MATRIX[key].auditAction
      expect(action).toMatch(/^[a-z_]+\.[a-z_]+$/)
    }
  })
})

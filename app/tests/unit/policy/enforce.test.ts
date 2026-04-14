import { describe, it, expect } from 'vitest'
import { assertPolicy } from '@/lib/ai/agent/policy/enforce'
import { POLICY_MATRIX } from '@/lib/ai/agent/policy/matrix'
import { ValidationError } from '@/lib/ai/agent/services/errors'
import type { AgentSession } from '@/lib/ai/agent/types'

function baseSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    projectId: null,
    status: 'active',
    locale: 'ro',
    selectedCallId: null,
    currentPhase: 'discovery',
    blueprint: null,
    eligibility: null,
    outline: null,
    warnings: [],
    planningArtifact: null,
    outlineFrozen: false,
    messageSummary: null,
    stateVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('assertPolicy', () => {
  describe('requiresSessionStatus', () => {
    it('passes when session is active', () => {
      expect(() => assertPolicy(POLICY_MATRIX.setSelectedCall, baseSession())).not.toThrow()
    })

    it('throws when session is paused', () => {
      expect(() => assertPolicy(POLICY_MATRIX.setSelectedCall, baseSession({ status: 'paused' })))
        .toThrow(ValidationError)
    })
  })

  describe('forbidsOutlineFrozen', () => {
    it('passes when outline is not frozen', () => {
      expect(() => assertPolicy(POLICY_MATRIX.setSelectedCall, baseSession())).not.toThrow()
    })

    it('throws POLICY_OUTLINE_ALREADY_FROZEN when outline is frozen', () => {
      try {
        assertPolicy(POLICY_MATRIX.setSelectedCall, baseSession({ outlineFrozen: true }))
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError)
        expect((err as ValidationError).policyCode).toBe('POLICY_OUTLINE_ALREADY_FROZEN')
      }
    })
  })

  describe('requiresCallSelected', () => {
    it('throws POLICY_NO_CALL_SELECTED for freezeOutline without a call', () => {
      try {
        assertPolicy(POLICY_MATRIX.freezeOutline, baseSession({ eligibility: { results: [], score: 100, passCount: 1, failCount: 0, warningCount: 0 } }))
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError)
        expect((err as ValidationError).policyCode).toBe('POLICY_NO_CALL_SELECTED')
      }
    })
  })

  describe('requiresOutlineFrozen', () => {
    it('throws POLICY_OUTLINE_NOT_FROZEN for saveSectionDraft when unfrozen', () => {
      try {
        assertPolicy(POLICY_MATRIX.saveSectionDraft, baseSession({
          selectedCallId: 'call-1',
          eligibility: { results: [], score: 100, passCount: 1, failCount: 0, warningCount: 0 },
        }))
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError)
        expect((err as ValidationError).policyCode).toBe('POLICY_OUTLINE_NOT_FROZEN')
      }
    })
  })

  describe('requiresEligibility', () => {
    it('throws POLICY_ELIGIBILITY_NOT_PASSED for freezeOutline when eligibility is null', () => {
      try {
        assertPolicy(POLICY_MATRIX.freezeOutline, baseSession({ selectedCallId: 'call-1', eligibility: null }))
        expect.fail('should have thrown')
      } catch (err) {
        expect((err as ValidationError).policyCode).toBe('POLICY_ELIGIBILITY_NOT_PASSED')
      }
    })

    it('throws POLICY_ELIGIBILITY_NOT_PASSED when failCount > 0', () => {
      try {
        assertPolicy(POLICY_MATRIX.freezeOutline, baseSession({
          selectedCallId: 'call-1',
          eligibility: { results: [], score: 50, passCount: 2, failCount: 3, warningCount: 0 },
        }))
        expect.fail('should have thrown')
      } catch (err) {
        expect((err as ValidationError).policyCode).toBe('POLICY_ELIGIBILITY_NOT_PASSED')
      }
    })

    it('passes when eligibility is run and failCount is 0', () => {
      expect(() => assertPolicy(POLICY_MATRIX.freezeOutline, baseSession({
        selectedCallId: 'call-1',
        eligibility: { results: [], score: 100, passCount: 5, failCount: 0, warningCount: 2 },
      }))).not.toThrow()
    })
  })

  describe('allowedSectionStates', () => {
    it('passes when section state is in the allowed list', () => {
      expect(() => assertPolicy(POLICY_MATRIX.approveSection, baseSession({ outlineFrozen: true }), { sectionState: 'draft' }))
        .not.toThrow()
    })

    it('throws POLICY_SECTION_WRONG_STATE when not in allowed list', () => {
      try {
        assertPolicy(POLICY_MATRIX.approveSection, baseSession({ outlineFrozen: true }), { sectionState: 'accepted' })
        expect.fail('should have thrown')
      } catch (err) {
        expect((err as ValidationError).policyCode).toBe('POLICY_SECTION_WRONG_STATE')
      }
    })
  })
})

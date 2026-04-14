import { describe, it, expect } from 'vitest'
import { checkPolicyGate, getInvalidationEffects } from '@/lib/ai/agent/policies'
import type { AgentSession, AgentSection } from '@/lib/ai/agent/types'

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    status: 'active', locale: 'ro', selectedCallId: null, currentPhase: 'discovery',
    projectId: null,
    blueprint: null, eligibility: null, outline: null, warnings: [],
    outlineFrozen: false,
    planningArtifact: null, messageSummary: null, stateVersion: 0,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  }
}

describe('Policy Gates', () => {
  it('generate_section blocked without outline (null)', () => {
    const result = checkPolicyGate('generate_section', makeSession({ outline: null }), [])
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('outline must be approved first')
  })

  it('generate_section blocked when outline exists but not frozen (V3 guard)', () => {
    const session = makeSession({
      outline: [{ id: 'rezumat', title: 'Rezumat' }] as any,
      outlineFrozen: false, // outline exists but is not frozen
      currentPhase: 'drafting',
      blueprint: { structureConfidence: 0.7 } as any,
      eligibility: { results: [], score: 100, passCount: 5, failCount: 0, warningCount: 0 },
    })
    const result = checkPolicyGate('generate_section', session, [])
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('outline must be frozen')
  })

  it('generate_section blocked with eligibility blocker', () => {
    const session = makeSession({
      outline: [{ id: 'rezumat', title: 'Rezumat' }] as any,
      outlineFrozen: true,
      currentPhase: 'drafting',
      eligibility: {
        results: [{ ruleId: 'ELIG-001', ruleName: 'test', status: 'fail', messageRo: '', messageEn: '', details: {} }],
        score: 0, passCount: 0, failCount: 1, warningCount: 0,
      },
    })
    const result = checkPolicyGate('generate_section', session, [])
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('eligibility')
  })

  it('generate_section blocked with low structure confidence', () => {
    const session = makeSession({
      outline: [{ id: 'rezumat', title: 'Rezumat' }] as any,
      outlineFrozen: true,
      currentPhase: 'drafting',
      blueprint: { structureConfidence: 0.2 } as any, // below MIN_STRUCTURE_CONFIDENCE (0.4)
      eligibility: { results: [], score: 100, passCount: 5, failCount: 0, warningCount: 0 },
    })
    const result = checkPolicyGate('generate_section', session, [])
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('structure confidence too low')
  })

  it('generate_section allowed with outline + frozen + no blockers', () => {
    const session = makeSession({
      outline: [{ id: 'rezumat', title: 'Rezumat' }] as any,
      outlineFrozen: true,
      currentPhase: 'drafting',
      blueprint: { structureConfidence: 0.7 } as any,
      eligibility: { results: [], score: 100, passCount: 5, failCount: 0, warningCount: 0 },
    })
    const result = checkPolicyGate('generate_section', session, [])
    expect(result.allowed).toBe(true)
  })

  it('validate_application blocked with missing mandatory sections', () => {
    const session = makeSession({
      currentPhase: 'review',
      outline: [{ id: 'rezumat', mandatory: true }] as any,
      blueprint: { freshnessConfidence: 0.8 } as any,
    })
    const sections: AgentSection[] = [
      { sectionKey: 'rezumat', status: 'draft' } as any,
    ]
    const result = checkPolicyGate('validate_application', session, sections)
    expect(result.allowed).toBe(false)
  })

  it('validate_application blocked with stale freshness', () => {
    const session = makeSession({
      currentPhase: 'review',
      outline: [{ id: 'rezumat', mandatory: true }] as any,
      blueprint: { freshnessConfidence: 0.3 } as any,
    })
    const sections: AgentSection[] = [
      { sectionKey: 'rezumat', status: 'accepted' } as any,
    ]
    const result = checkPolicyGate('validate_application', session, sections)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('freshness')
  })
})

describe('Invalidation Effects', () => {
  it('call change invalidates everything', () => {
    const effects = getInvalidationEffects('call_changed')
    expect(effects.clearBlueprint).toBe(true)
    expect(effects.clearEligibility).toBe(true)
    expect(effects.clearOutline).toBe(true)
    expect(effects.invalidateAllSections).toBe(true)
  })

  it('structure change marks sections stale', () => {
    const effects = getInvalidationEffects('structure_changed')
    expect(effects.clearBlueprint).toBe(false)
    expect(effects.markSectionsStale).toBe(true)
  })
})

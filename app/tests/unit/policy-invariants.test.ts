import { describe, it, expect } from 'vitest'
import { assertPolicy } from '@/lib/ai/agent/policy/enforce'
import { POLICY_MATRIX } from '@/lib/ai/agent/policy/matrix'
import type { AgentSession, SectionSpec } from '@/lib/ai/agent/types'

function spec(id: string): SectionSpec {
  return {
    id, title: id, description: '', order: 1, generationOrder: 1,
    importance: 'standard', expectedLength: 'medium', dependsOn: [],
    modelHint: 'light', mandatory: true, confidence: 0.9,
  }
}

function baseSession(over: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 's', userId: 'u', projectId: null, status: 'active', locale: 'ro',
    selectedCallId: 'C-1', currentPhase: 'structuring',
    blueprint: null, eligibility: { results: [], score: 100, passCount: 0, failCount: 0, warningCount: 0 },
    outline: null, warnings: [], planningArtifact: null, outlineFrozen: false,
    messageSummary: null, stateVersion: 0,
    createdAt: new Date(0), updatedAt: new Date(0),
    ...over,
  }
}

describe('assertPolicy — requiresOutlinePresent', () => {
  it('rejects freezeOutline when outline is null', () => {
    expect(() => assertPolicy(POLICY_MATRIX.freezeOutline, baseSession({ outline: null })))
      .toThrowError(/POLICY_OUTLINE_NOT_READY/)
  })

  it('rejects freezeOutline when outline is empty', () => {
    expect(() => assertPolicy(POLICY_MATRIX.freezeOutline, baseSession({ outline: [] })))
      .toThrowError(/POLICY_OUTLINE_NOT_READY/)
  })

  it('allows freezeOutline when outline has at least one section', () => {
    expect(() => assertPolicy(POLICY_MATRIX.freezeOutline,
      baseSession({ outline: [spec('a')] })))
      .not.toThrow()
  })
})

describe('assertPolicy — requiresSectionKeyInOutline', () => {
  const frozen = baseSession({ outlineFrozen: true, outline: [spec('a'), spec('b')] })

  it('rejects saveSectionDraft when sectionKey is missing from outline', () => {
    expect(() => assertPolicy(POLICY_MATRIX.saveSectionDraft, frozen, { sectionKey: 'ghost' }))
      .toThrowError(/POLICY_SECTION_NOT_IN_OUTLINE/)
  })

  it('rejects saveSectionDraft when sectionKey is undefined', () => {
    expect(() => assertPolicy(POLICY_MATRIX.saveSectionDraft, frozen, {}))
      .toThrowError(/POLICY_SECTION_NOT_IN_OUTLINE/)
  })

  it('allows saveSectionDraft when sectionKey is in outline', () => {
    expect(() => assertPolicy(POLICY_MATRIX.saveSectionDraft, frozen, { sectionKey: 'a' }))
      .not.toThrow()
  })
})

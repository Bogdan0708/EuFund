import { describe, it, expect } from 'vitest'
import { projectSessionState } from '@/lib/ai/agent/state-projection'
import type { AgentSession, AgentSection, SectionSpec, CallBlueprint } from '@/lib/ai/agent/types'

function baseSession(over: Partial<AgentSession> = {}): AgentSession {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    projectId: null,
    status: 'active',
    locale: 'ro',
    selectedCallId: 'C-1',
    currentPhase: 'structuring',
    blueprint: null,
    eligibility: null,
    outline: null,
    warnings: [],
    planningArtifact: null,
    outlineFrozen: false,
    messageSummary: null,
    stateVersion: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  }
}

function spec(id: string, order: number, title: string): SectionSpec {
  return {
    id, title,
    description: '',
    order,
    generationOrder: order,
    importance: 'standard',
    expectedLength: 'medium',
    dependsOn: [],
    modelHint: 'light',
    mandatory: true,
    confidence: 0.9,
  }
}

function row(over: Partial<AgentSection>): AgentSection {
  return {
    id: 'r1',
    sessionId: 's1',
    sectionKey: 'intro',
    title: 'Introducere',
    status: 'draft',
    documentOrder: 1,
    generationOrder: 1,
    content: 'body',
    acceptedContent: null,
    modelUsed: null,
    retryCount: 0,
    sourcesUsed: null,
    promptVersion: null,
    latencyMs: null,
    tokenUsage: null,
    errorClass: null,
    rejectionReason: null,
    updatedAt: new Date(0),
    ...over,
  } as AgentSection
}

const defaultNormalized: CallBlueprint['normalized'] = {
  requiredSections: [],
  mandatoryAnnexes: [],
  eligibilityCriteria: [],
  evaluationGrid: [],
  cofinancingRate: 0,
}

function makeBlueprint(over: Partial<CallBlueprint> = {}): CallBlueprint {
  return {
    callId: 'C-1',
    program: 'PNRR',
    isOpen: true,
    amendments: [],
    warnings: [],
    requiredSections: [],
    mandatoryAnnexes: [],
    eligibilityCriteria: [],
    evaluationGrid: [],
    cofinancingRate: 0,
    eligibilityResult: {
      score: 0,
      passCount: 0,
      failCount: 0,
      failures: [],
      warnings: [],
    },
    sources: [],
    verifiedAt: '2026-05-12T00:00:00.000Z',
    raw: {
      notebookLmResponse: '',
      perplexityResponse: '',
      retrievedAt: '2026-05-12T00:00:00.000Z',
    },
    normalized: defaultNormalized,
    structureConfidence: 0.9,
    ...over,
  }
}

describe('projectSessionState', () => {
  it('projects real rows when present', () => {
    const session = baseSession({ outline: [spec('intro', 1, 'Introducere')] })
    const r = row({ sectionKey: 'intro', status: 'draft', content: 'body' })
    const out = projectSessionState(session, [r])
    expect(out.sections).toEqual([{
      sectionKey: 'intro',
      title: 'Introducere',
      status: 'draft',
      documentOrder: 1,
      content: 'body',
    }])
  })

  it('projects virtual pending sections when outline set but no rows', () => {
    const session = baseSession({
      outline: [spec('a', 1, 'A'), spec('b', 2, 'B')],
    })
    const out = projectSessionState(session, [])
    expect(out.sections).toEqual([
      { sectionKey: 'a', title: 'A', status: 'pending', documentOrder: 1, content: null },
      { sectionKey: 'b', title: 'B', status: 'pending', documentOrder: 2, content: null },
    ])
  })

  it('falls back to blueprint.requiredSections when outline is null but blueprint exists', () => {
    const bp = makeBlueprint({
      normalized: { ...defaultNormalized, requiredSections: [spec('x', 1, 'X')] },
    })
    const session = baseSession({ outline: null, blueprint: bp })
    const out = projectSessionState(session, [])
    expect(out.sections).toEqual([
      { sectionKey: 'x', title: 'X', status: 'pending', documentOrder: 1, content: null },
    ])
  })

  it('returns empty sections when outline and blueprint are both null', () => {
    const session = baseSession()
    expect(projectSessionState(session, []).sections).toEqual([])
  })

  it('merges rows over virtual entries on the same sectionKey', () => {
    const session = baseSession({
      outline: [spec('a', 1, 'A'), spec('b', 2, 'B')],
    })
    const r = row({ sectionKey: 'a', title: 'Introducere v2', status: 'accepted', content: 'final', acceptedContent: 'final accepted' })
    const out = projectSessionState(session, [r])
    expect(out.sections).toEqual([
      { sectionKey: 'a', title: 'Introducere v2', status: 'accepted', documentOrder: 1, content: 'final accepted' },
      { sectionKey: 'b', title: 'B', status: 'pending', documentOrder: 2, content: null },
    ])
  })

  it('echoes session top-level fields', () => {
    const session = baseSession({ stateVersion: 7, outlineFrozen: true })
    const out = projectSessionState(session, [])
    expect(out.sessionId).toBe(session.id)
    expect(out.phase).toBe('structuring')
    expect(out.stateVersion).toBe(7)
    expect(out.outlineFrozen).toBe(true)
  })

  it('uses row.title (not spec.title) when a row exists', () => {
    const session = baseSession({
      outline: [spec('a', 1, 'Spec Title')],
    })
    const r = row({ sectionKey: 'a', title: 'Row Title', status: 'draft' })
    const out = projectSessionState(session, [r])
    expect(out.sections[0].title).toBe('Row Title')
  })

  it('merges 2 rows with 3-spec outline, keeping the 3rd as virtual pending', () => {
    const session = baseSession({
      outline: [spec('a', 1, 'A'), spec('b', 2, 'B'), spec('c', 3, 'C')],
    })
    const rowA = row({ sectionKey: 'a', title: 'A actual', status: 'draft', documentOrder: 1, content: 'a-body' })
    const rowB = row({ sectionKey: 'b', title: 'B actual', status: 'accepted', documentOrder: 2, content: 'b-draft', acceptedContent: 'b-final' })
    const out = projectSessionState(session, [rowA, rowB])
    expect(out.sections).toEqual([
      { sectionKey: 'a', title: 'A actual', status: 'draft', documentOrder: 1, content: 'a-body' },
      { sectionKey: 'b', title: 'B actual', status: 'accepted', documentOrder: 2, content: 'b-final' },
      { sectionKey: 'c', title: 'C', status: 'pending', documentOrder: 3, content: null },
    ])
  })
})

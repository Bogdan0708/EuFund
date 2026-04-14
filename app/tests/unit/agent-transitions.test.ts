import { describe, it, expect } from 'vitest'
import { applyTransition } from '@/lib/ai/agent/transitions'
import type { AgentSession, AgentSection, StateTransition } from '@/lib/ai/agent/types'

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    status: 'active',
    locale: 'ro',
    selectedCallId: null,
    projectId: null,
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

function makeSection(overrides: Partial<AgentSection> = {}): AgentSection {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    sessionId: '11111111-1111-4111-8111-111111111111',
    sectionKey: 'rezumat',
    title: 'Rezumat executiv',
    documentOrder: 0,
    generationOrder: 11,
    status: 'pending',
    content: null,
    acceptedContent: null,
    modelUsed: null,
    retryCount: 0,
    sourcesUsed: null,
    promptVersion: null,
    latencyMs: null,
    tokenUsage: null,
    errorClass: null,
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('applyTransition', () => {
  it('SET_SELECTED_CALL sets callId on session', () => {
    const session = makeSession()
    const sections: AgentSection[] = []
    const t: StateTransition = { type: 'SET_SELECTED_CALL', callId: 'PNRR-C11' }
    const result = applyTransition(session, sections, t)
    expect(result.session.selectedCallId).toBe('PNRR-C11')
  })

  it('SET_PHASE updates currentPhase', () => {
    const session = makeSession()
    const result = applyTransition(session, [], { type: 'SET_PHASE', phase: 'research' })
    expect(result.session.currentPhase).toBe('research')
  })

  it('SET_BLUEPRINT stores blueprint', () => {
    const session = makeSession()
    const blueprint = { callId: 'test', program: 'PNRR' } as any
    const result = applyTransition(session, [], { type: 'SET_BLUEPRINT', blueprint })
    expect(result.session.blueprint).toEqual(blueprint)
  })

  it('INVALIDATE_ALL_SECTIONS marks all sections invalidated', () => {
    const sections = [
      makeSection({ sectionKey: 'rezumat', status: 'accepted' }),
      makeSection({ sectionKey: 'buget', status: 'draft' }),
    ]
    const result = applyTransition(makeSession(), sections, { type: 'INVALIDATE_ALL_SECTIONS' })
    expect(result.sections.every(s => s.status === 'invalidated')).toBe(true)
  })

  it('MARK_SECTION_STALE marks specific section', () => {
    const sections = [
      makeSection({ sectionKey: 'rezumat', status: 'accepted' }),
      makeSection({ sectionKey: 'buget', status: 'accepted' }),
    ]
    const result = applyTransition(makeSession(), sections, { type: 'MARK_SECTION_STALE', sectionKey: 'rezumat' })
    expect(result.sections.find(s => s.sectionKey === 'rezumat')!.status).toBe('stale')
    expect(result.sections.find(s => s.sectionKey === 'buget')!.status).toBe('accepted')
  })

  it('ACCEPT_SECTION copies content to acceptedContent', () => {
    const sections = [makeSection({ sectionKey: 'rezumat', status: 'draft', content: 'My summary' })]
    const result = applyTransition(makeSession(), sections, { type: 'ACCEPT_SECTION', sectionKey: 'rezumat' })
    const s = result.sections.find(s => s.sectionKey === 'rezumat')!
    expect(s.status).toBe('accepted')
    expect(s.acceptedContent).toBe('My summary')
  })

  it('ADD_WARNING appends to warnings', () => {
    const session = makeSession({ warnings: [{ code: 'W1', message: 'old', severity: 'low' }] })
    const result = applyTransition(session, [], {
      type: 'ADD_WARNING', warning: { code: 'W2', message: 'new', severity: 'high' },
    })
    expect(result.session.warnings).toHaveLength(2)
    expect(result.session.warnings[1].code).toBe('W2')
  })

  it('SET_STATUS changes session status', () => {
    const result = applyTransition(makeSession(), [], { type: 'SET_STATUS', status: 'completed' })
    expect(result.session.status).toBe('completed')
  })

  it('UPSERT_SECTION_DRAFT creates section data in result', () => {
    const result = applyTransition(makeSession(), [], {
      type: 'UPSERT_SECTION_DRAFT', sectionKey: 'rezumat', content: 'Draft text', model: 'opus', sources: ['qdrant'],
    })
    expect(result.sectionUpsert).toEqual({
      sectionKey: 'rezumat', content: 'Draft text', model: 'opus', sources: ['qdrant'],
    })
  })
})

// app/tests/integration/agent-state-persistence.test.ts
import { describe, it, expect } from 'vitest'
import { applyTransition } from '@/lib/ai/agent/transitions'
import type { AgentSession, AgentSection, StateTransition } from '@/lib/ai/agent/types'

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    status: 'active', locale: 'ro', selectedCallId: null,
    currentPhase: 'discovery', blueprint: null, eligibility: null,
    outline: null, warnings: [], planningArtifact: null,
    outlineFrozen: false,
    messageSummary: null, stateVersion: 0,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  }
}

function makeSection(overrides: Partial<AgentSection> = {}): AgentSection {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    sessionId: '11111111-1111-4111-8111-111111111111',
    sectionKey: 'context', title: 'Context', documentOrder: 1,
    generationOrder: 1, status: 'pending', content: null,
    acceptedContent: null, modelUsed: null, retryCount: 0,
    sourcesUsed: null, promptVersion: null, latencyMs: null,
    tokenUsage: null, errorClass: null, updatedAt: new Date(),
    ...overrides,
  }
}

describe('Agent State Persistence — Transition Chains', () => {
  it('full lifecycle: discovery → research → structuring → drafting → review', () => {
    let session = makeSession()
    let sections: AgentSection[] = []

    // 1. Select call → research
    const t1 = applyTransition(session, sections, { type: 'SET_SELECTED_CALL', callId: 'PNRR-C11' })
    session = t1.session
    expect(session.selectedCallId).toBe('PNRR-C11')

    // 2. Set blueprint
    const blueprint = { callId: 'PNRR-C11', program: 'PNRR', structureConfidence: 0.8 } as any
    const t2 = applyTransition(session, sections, { type: 'SET_BLUEPRINT', blueprint })
    session = t2.session
    expect(session.blueprint).toBeTruthy()

    // 3. Move to research
    const t3 = applyTransition(session, sections, { type: 'SET_PHASE', phase: 'research' })
    session = t3.session
    expect(session.currentPhase).toBe('research')

    // 4. Set eligibility
    const eligibility = { results: [], score: 85, passCount: 5, failCount: 0, warningCount: 1 }
    const t4 = applyTransition(session, sections, { type: 'SET_ELIGIBILITY', result: eligibility })
    session = t4.session
    expect(session.eligibility?.score).toBe(85)

    // 5. Set outline → structuring
    const outline = [{ id: 'context', title: 'Context' }, { id: 'buget', title: 'Buget' }] as any[]
    const t5 = applyTransition(session, sections, { type: 'SET_OUTLINE', outline })
    session = t5.session
    expect(session.outline).toHaveLength(2)

    const t6 = applyTransition(session, sections, { type: 'SET_PHASE', phase: 'structuring' })
    session = t6.session

    // 6. Freeze outline → drafting
    const t7 = applyTransition(session, sections, { type: 'FREEZE_OUTLINE' })
    session = t7.session
    const t8 = applyTransition(session, sections, { type: 'SET_PHASE', phase: 'drafting' })
    session = t8.session
    expect(session.currentPhase).toBe('drafting')

    // 7. Upsert section draft
    sections = [makeSection({ sectionKey: 'context', status: 'pending' })]
    const t9 = applyTransition(session, sections, {
      type: 'UPSERT_SECTION_DRAFT', sectionKey: 'context', content: 'Generated context...', model: 'opus', sources: [],
    })
    session = t9.session
    sections = t9.sections
    expect(sections[0].status).toBe('draft')
    expect(sections[0].content).toBe('Generated context...')

    // 8. Accept section
    const t10 = applyTransition(session, sections, { type: 'ACCEPT_SECTION', sectionKey: 'context' })
    sections = t10.sections
    expect(sections[0].status).toBe('accepted')
    expect(sections[0].acceptedContent).toBe('Generated context...')
  })

  it('call change invalidates everything', () => {
    let session = makeSession({
      selectedCallId: 'OLD-CALL',
      blueprint: { callId: 'OLD' } as any,
      eligibility: { score: 100 } as any,
      outline: [{ id: 'context' }] as any,
    })
    let sections = [makeSection({ status: 'accepted', content: 'old content', acceptedContent: 'old content' })]

    // Simulate call change: clear everything
    const transitions: StateTransition[] = [
      { type: 'SET_SELECTED_CALL', callId: 'NEW-CALL' },
      { type: 'SET_BLUEPRINT', blueprint: null as any },
      { type: 'SET_ELIGIBILITY', result: null as any },
      { type: 'SET_OUTLINE', outline: [] },
      { type: 'INVALIDATE_ALL_SECTIONS' },
      { type: 'SET_PHASE', phase: 'research' },
    ]

    for (const t of transitions) {
      const result = applyTransition(session, sections, t)
      session = result.session
      sections = result.sections
    }

    expect(session.selectedCallId).toBe('NEW-CALL')
    expect(session.currentPhase).toBe('research')
    expect(sections[0].status).toBe('invalidated')
  })

  it('warning accumulation', () => {
    let session = makeSession()

    const t1 = applyTransition(session, [], {
      type: 'ADD_WARNING', warning: { code: 'W1', message: 'First', severity: 'low' },
    })
    session = t1.session

    const t2 = applyTransition(session, [], {
      type: 'ADD_WARNING', warning: { code: 'W2', message: 'Second', severity: 'high' },
    })
    session = t2.session

    expect(session.warnings).toHaveLength(2)
    expect(session.warnings[0].code).toBe('W1')
    expect(session.warnings[1].code).toBe('W2')

    // Clear warnings
    const t3 = applyTransition(session, [], { type: 'SET_WARNINGS', warnings: [] })
    session = t3.session
    expect(session.warnings).toHaveLength(0)
  })
})

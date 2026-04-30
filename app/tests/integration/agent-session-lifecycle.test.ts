// app/tests/integration/agent-session-lifecycle.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentSession, AgentSection, AgentEvent } from '@/lib/ai/agent/types'

// Mock external boundaries
vi.mock('@/lib/db', () => {
  const noop = vi.fn().mockResolvedValue(undefined)
  const emptyRows = vi.fn().mockResolvedValue([])
  const withLimit = vi.fn().mockReturnValue({ then: (r: any) => Promise.resolve([]).then(r) })

  const selectChain = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: withLimit,
          then: (r: any) => Promise.resolve([]).then(r),
        }),
        limit: emptyRows,
        then: (r: any) => Promise.resolve([]).then(r),
      }),
      orderBy: vi.fn().mockReturnValue({
        limit: withLimit,
        then: (r: any) => Promise.resolve([]).then(r),
      }),
    }),
  }

  return {
    db: {
      select: vi.fn().mockReturnValue(selectChain),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'session-1' }]),
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: noop,
        }),
      }),
    },
  }
})

vi.mock('@/lib/ai/providers/router', () => ({
  generate: vi.fn().mockResolvedValue({
    content: 'I found some matching calls for your project.',
    tokensUsed: { input: 100, output: 50 },
    model: 'claude-opus-4-6',
    provider: 'anthropic',
    toolCalls: [],
  }),
}))

vi.mock('@/lib/vectors/store', () => ({
  getVectorStore: vi.fn(() => ({
    search: vi.fn().mockResolvedValue([]),
  })),
}))

vi.mock('@/lib/rules/eligibility', () => ({
  runEligibilityRules: vi.fn().mockReturnValue({
    results: [], score: 100, passCount: 5, failCount: 0, warningCount: 0,
  }),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
  },
  default: {
    child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
  },
}))

import { runAgentTurn } from '@/lib/ai/agent/runtime'
import { applyTransition } from '@/lib/ai/agent/transitions'

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    status: 'active', locale: 'ro', selectedCallId: null,
    projectId: null,
    currentPhase: 'discovery', blueprint: null, eligibility: null,
    outline: null, warnings: [], planningArtifact: null,
    outlineFrozen: false,
    messageSummary: null, stateVersion: 0,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  }
}

describe('Agent Session Lifecycle', () => {
  let events: AgentEvent[]
  const emit = (e: AgentEvent) => events.push(e)

  beforeEach(() => {
    events = []
    vi.clearAllMocks()
  })

  it('starts in discovery phase and responds to user message', async () => {
    const session = makeSession()
    const result = await runAgentTurn({
      session,
      sections: [],
      request: { message: 'I want to apply for green energy funding in Romania', requestId: 'req-1', locale: 'ro' },
      emit,
          turnId: 'tu-test',
    })

    expect(result.session.stateVersion).toBe(1)
    expect(events.some(e => e.type === 'text_delta')).toBe(true)
    expect(events.some(e => e.type === 'done')).toBe(true)
  })

  it('handles approve_outline action and transitions to drafting', async () => {
    const session = makeSession({
      currentPhase: 'structuring',
      selectedCallId: 'CALL-123',
      eligibility: { results: [], score: 100, passCount: 5, failCount: 0, warningCount: 0 },
      outline: [{ id: 'context', title: 'Context', description: 'test', order: 1, generationOrder: 1, importance: 'critical', expectedLength: 'long', dependsOn: [], modelHint: 'heavy', mandatory: true, confidence: 1 }] as any,
    })

    const result = await runAgentTurn({
      session,
      sections: [{ sectionKey: 'context', title: 'Context', status: 'pending', documentOrder: 1 } as any],
      request: { action: { type: 'approve_outline' }, requestId: 'req-2', locale: 'ro' },
      emit,
          turnId: 'tu-test',
    })

    // approve_outline sets FREEZE + SET_PHASE(drafting) then continues to LLM
    expect(result.session.currentPhase).toBe('drafting')
  })

  it('handles accept_section action without calling LLM', async () => {
    const session = makeSession({ currentPhase: 'drafting', outlineFrozen: true })
    const sections: AgentSection[] = [{
      id: '33333333-3333-4333-8333-333333333333',
      sessionId: session.id,
      sectionKey: 'context',
      title: 'Context',
      documentOrder: 1,
      generationOrder: 1,
      status: 'needs_review',
      content: 'Full context section content...',
      acceptedContent: null,
      modelUsed: 'claude-opus-4-6',
      retryCount: 0,
      sourcesUsed: null,
      promptVersion: null,
      latencyMs: null,
      tokenUsage: null,
      errorClass: null,
      rejectionReason: null,
      updatedAt: new Date(),
    }]

    const result = await runAgentTurn({
      session,
      sections,
      request: { action: { type: 'accept_section', sectionKey: 'context' }, requestId: 'req-3', locale: 'ro' },
      emit,
          turnId: 'tu-test',
    })

    const accepted = result.sections.find(s => s.sectionKey === 'context')
    expect(accepted?.status).toBe('accepted')
    expect(accepted?.acceptedContent).toBe('Full context section content...')
  })

  it('blocks mark_complete when mandatory sections not accepted', async () => {
    const session = makeSession({
      currentPhase: 'review',
      outline: [{ id: 'context', title: 'Context', mandatory: true }] as any,
    })
    const sections: AgentSection[] = [
      { sectionKey: 'context', status: 'draft' } as any,
    ]

    const result = await runAgentTurn({
      session,
      sections,
      request: { action: { type: 'mark_complete' }, requestId: 'req-4', locale: 'ro' },
      emit,
          turnId: 'tu-test',
    })

    // Should NOT be completed — policy gate blocks it
    expect(result.session.status).not.toBe('completed')
    expect(events.some(e => e.type === 'policy_violation')).toBe(true)
  })
})

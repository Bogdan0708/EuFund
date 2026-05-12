import { describe, it, expect, vi, beforeEach } from 'vitest'

const markTurnCompletedMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/ai/agent/managed/history', () => ({
  markTurnCompleted: markTurnCompletedMock,
}))

vi.mock('@/lib/ai/providers/router', () => ({
  generate: vi.fn().mockResolvedValue({
    content: 'done', tokensUsed: { input: 1, output: 1 }, model: 'claude-opus-4-6', provider: 'anthropic',
  }),
}))

vi.mock('@/lib/ai/agent/history', () => ({
  loadContext: vi.fn().mockResolvedValue({ messages: [], summary: null, totalCount: 0 }),
  appendMessage: vi.fn().mockResolvedValue(0),
  compactIfNeeded: vi.fn().mockResolvedValue({ compacted: false }),
  ensureV3PairingInvariant: (m: unknown[]) => m,
}))

vi.mock('@/lib/ai/knowledge/session-knowledge', () => ({ getSessionKnowledge: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/ai/knowledge/write-back', () => ({ onSectionAccepted: vi.fn(), onPhaseTransition: vi.fn(), trackPatternUsage: vi.fn() }))
vi.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: vi.fn().mockResolvedValue(false) }))

vi.mock('@/lib/db', () => {
  const update = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) }))
  const insert = vi.fn(() => ({
    values: vi.fn(() => ({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      then: (r: (v: unknown) => void) => r(undefined),
    })),
  }))
  return { db: { update, insert } }
})

vi.mock('@/lib/db/schema', () => ({
  agentSessions: { id: 'id' },
  agentSections: { sessionId: 'session_id', sectionKey: 'section_key' },
  agentCheckpoints: {},
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))

import type { AgentSession, AgentEvent } from '@/lib/ai/agent/types'

const baseSession: AgentSession = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  projectId: null, status: 'active', locale: 'ro',
  selectedCallId: null, currentPhase: 'discovery',
  blueprint: null, eligibility: null, outline: null,
  warnings: [], planningArtifact: null,
  outlineFrozen: false, messageSummary: null,
  stateVersion: 0, createdAt: new Date(), updatedAt: new Date(),
}

describe('runAgentTurn — markTurnCompleted ordering', () => {
  beforeEach(() => { markTurnCompletedMock.mockClear() })

  it('calls markTurnCompleted BEFORE emitting done on the end-of-turn path', async () => {
    const events: AgentEvent[] = []
    const order: string[] = []
    markTurnCompletedMock.mockImplementationOnce(async () => { order.push('mark') })

    const { runAgentTurn } = await import('@/lib/ai/agent/runtime')
    await runAgentTurn({
      session: baseSession,
      sections: [],
      request: { requestId: 'r1', locale: 'ro', message: 'hi' },
      emit: (e) => { if (e.type === 'done') order.push('done'); events.push(e) },
      turnId: 'tu-1',
    })

    expect(markTurnCompletedMock).toHaveBeenCalledWith('tu-1', expect.any(Object))
    expect(order[0]).toBe('mark')
    expect(order[1]).toBe('done')
  })

  it('calls markTurnCompleted on skipLLM=true terminal action path', async () => {
    const order: string[] = []
    markTurnCompletedMock.mockImplementationOnce(async () => { order.push('mark') })

    const sessionWithFrozenOutline = { ...baseSession, outlineFrozen: true }
    const sectionsWithReview = [{
      id: 's1', sessionId: baseSession.id, sectionKey: 'obiective', title: 'Obiective',
      documentOrder: 0, generationOrder: 0, status: 'needs_review' as const,
      content: 'c', acceptedContent: null, modelUsed: null, retryCount: 0,
      sourcesUsed: null, promptVersion: null, latencyMs: null, tokenUsage: null,
      errorClass: null, rejectionReason: null, updatedAt: new Date(),
    }]

    const { runAgentTurn } = await import('@/lib/ai/agent/runtime')
    await runAgentTurn({
      session: sessionWithFrozenOutline,
      sections: sectionsWithReview,
      request: {
        requestId: 'r2', locale: 'ro',
        action: { type: 'accept_section', sectionKey: 'obiective' },
      },
      emit: (e) => { if (e.type === 'done') order.push('done') },
      turnId: 'tu-2',
    })

    expect(markTurnCompletedMock).toHaveBeenCalledWith('tu-2', expect.any(Object))
    expect(order).toEqual(['mark', 'done'])
  })

  it('does NOT call markTurnCompleted when LLM provider call throws', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    vi.mocked(generate).mockRejectedValueOnce(new Error('upstream 500'))

    const { runAgentTurn } = await import('@/lib/ai/agent/runtime')
    await expect(runAgentTurn({
      session: baseSession,
      sections: [],
      request: { requestId: 'r3', locale: 'ro', message: 'hi' },
      emit: () => {},
      turnId: 'tu-3',
    })).rejects.toBeInstanceOf(Error)

    expect(markTurnCompletedMock).not.toHaveBeenCalled()
  })
})

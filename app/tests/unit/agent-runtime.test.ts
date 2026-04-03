// app/tests/unit/agent-runtime.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies
vi.mock('@/lib/ai/agent/history', () => ({
  loadContext: vi.fn().mockResolvedValue({ messages: [], summary: null, totalCount: 0 }),
  appendMessage: vi.fn().mockResolvedValue(0),
  compactIfNeeded: vi.fn().mockResolvedValue({ compacted: false }),
}))

vi.mock('@/lib/ai/providers/router', () => ({
  generate: vi.fn().mockResolvedValue({
    content: 'I can help you find funding calls. What sector is your project in?',
    tokensUsed: { input: 100, output: 50 },
    model: 'claude-opus-4-6',
    provider: 'anthropic',
    toolCalls: [],
  }),
}))

vi.mock('@/lib/db', () => ({
  db: {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

import { runAgentTurn } from '@/lib/ai/agent/runtime'
import type { AgentSession, AgentSection, AgentEvent } from '@/lib/ai/agent/types'

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    status: 'active', locale: 'ro', selectedCallId: null, currentPhase: 'discovery',
    blueprint: null, eligibility: null, outline: null, warnings: [],
    planningArtifact: null, messageSummary: null, stateVersion: 0,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  }
}

describe('Agent Runtime', () => {
  let events: AgentEvent[]
  const emit = (e: AgentEvent) => events.push(e)

  beforeEach(() => {
    events = []
    vi.clearAllMocks()
  })

  it('runs a basic text turn and emits events', async () => {
    const result = await runAgentTurn({
      session: makeSession(),
      sections: [],
      request: { message: 'I want to apply for green energy funding', requestId: 'req-1', locale: 'ro' },
      emit,
    })

    expect(result.session.stateVersion).toBe(1)
    expect(events.find(e => e.type === 'text_delta')).toBeDefined()
    expect(events.find(e => e.type === 'done')).toBeDefined()
  })

  it('handles accept_section action without calling LLM', async () => {
    const sections: AgentSection[] = [{
      id: '33333333-3333-4333-8333-333333333333',
      sessionId: '11111111-1111-4111-8111-111111111111',
      sectionKey: 'rezumat', title: 'Rezumat', documentOrder: 0, generationOrder: 11,
      status: 'draft', content: 'Draft content', acceptedContent: null,
      modelUsed: null, retryCount: 0, sourcesUsed: null, promptVersion: null,
      latencyMs: null, tokenUsage: null, errorClass: null, updatedAt: new Date(),
    }]

    const result = await runAgentTurn({
      session: makeSession({ currentPhase: 'drafting' }),
      sections,
      request: { action: { type: 'accept_section', sectionKey: 'rezumat' }, requestId: 'req-2', locale: 'ro' },
      emit,
    })

    const accepted = result.sections.find(s => s.sectionKey === 'rezumat')
    expect(accepted?.status).toBe('accepted')
    expect(accepted?.acceptedContent).toBe('Draft content')
    expect(events.find(e => e.type === 'done')).toBeDefined()
  })

  it('increments stateVersion on each turn', async () => {
    const result = await runAgentTurn({
      session: makeSession({ stateVersion: 5 }),
      sections: [],
      request: { message: 'test', requestId: 'req-3', locale: 'ro' },
      emit,
    })

    expect(result.session.stateVersion).toBe(6)
  })
})

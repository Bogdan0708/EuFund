import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Anthropic SDK to produce synthetic streaming events
vi.mock('@/lib/ai/anthropic-client', () => ({
  getAnthropicClient: () => ({
    messages: {
      stream: vi.fn().mockImplementation(() => makeFakeStream([
        { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Salut, caut apeluri.' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } },
        { type: 'message_stop' },
      ])),
    },
  }),
}))

vi.mock('@/lib/db', () => {
  const makeChain = () => {
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve([])),
      then: (resolve: (val: unknown[]) => void) => resolve([]),
    }
    return chain
  }
  const mockDb: any = {
    select: vi.fn(() => makeChain()),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: 'mock-turn-id' }]),
        then: (resolve: (val: unknown) => void) => resolve(undefined),
      })),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  }
  mockDb.transaction = vi.fn(async (cb: any) => cb(mockDb))
  return { db: mockDb }
})

vi.mock('@/lib/db/schema', () => ({
  agentMessages: { sessionId: 'session_id', sequenceNumber: 'sequence_number', turnId: 'turn_id' },
  agentTurns: { id: 'id', sessionId: 'session_id', requestId: 'request_id' },
  agentSessions: { id: 'id', userId: 'user_id' },
  runtimeModeEnum: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  asc: vi.fn(),
  desc: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

// Helper: build an async iterable matching the SDK's stream shape
function makeFakeStream(events: unknown[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e
    },
  }
}

import type { AgentEvent, AgentSession } from '@/lib/ai/agent/types'

const mockSession: AgentSession = {
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
}

describe('runManagedTurn — happy path', () => {
  beforeEach(() => vi.clearAllMocks())

  it('emits text_delta and done for a simple text-only turn', async () => {
    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    const events: AgentEvent[] = []

    const result = await runManagedTurn({
      session: mockSession,
      sections: [],
      request: {
        requestId: 'req-1',
        locale: 'ro',
        message: 'Salut',
      },
      emit: (e) => events.push(e),
      turnId: '99999999-9999-4999-8999-999999999999',
      serviceCtx: {
        userId: mockSession.userId,
        sessionId: mockSession.id,
        requestId: 'req-1',
        now: new Date(),
      },
    })

    const textDeltas = events.filter(e => e.type === 'text_delta')
    expect(textDeltas.length).toBeGreaterThan(0)
    const done = events.find(e => e.type === 'done')
    expect(done).toBeDefined()
    expect(result.toolCount).toBe(0)
    expect(result.iterationCount).toBeGreaterThanOrEqual(1)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture every payload passed to agent_turns UPDATE .set(...)
// so we can assert the final persisted usage is NOT inflated by
// summing cumulative message_delta events.
const setCalls: Array<Record<string, unknown>> = []

vi.mock('@/lib/ai/anthropic-client', () => ({
  getAnthropicClient: () => ({
    messages: {
      stream: vi.fn().mockImplementation(() => makeFakeStream([
        // message_start seeds input/cache/output baseline (input_tokens is
        // billed once per message regardless of how many deltas fire).
        {
          type: 'message_start',
          message: {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-6',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: 100,
              cache_creation_input_tokens: 20,
              cache_read_input_tokens: 30,
              output_tokens: 0,
            },
          },
        },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } },
        { type: 'content_block_stop', index: 0 },
        // Three cumulative message_delta events — each carries the running
        // total, NOT an increment. A buggy add-per-delta loop would compute
        // output_tokens = 5 + 10 + 15 = 30. Correct behavior: the final
        // value (15) wins and is folded into aggregate once at stream end.
        { type: 'message_delta', delta: { stop_reason: null, stop_sequence: null }, usage: { output_tokens: 5 } },
        { type: 'message_delta', delta: { stop_reason: null, stop_sequence: null }, usage: { output_tokens: 10 } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 15 } },
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
    update: vi.fn(() => ({
      set: vi.fn((payload: Record<string, unknown>) => {
        setCalls.push(payload)
        return { where: vi.fn().mockResolvedValue(undefined) }
      }),
    })),
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

function makeFakeStream(events: unknown[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e
    },
  }
}

import type { AgentSession } from '@/lib/ai/agent/types'

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

describe('runManagedTurn — usage accounting (P1 regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setCalls.length = 0
  })

  it('does not inflate output_tokens when a stream emits multiple cumulative message_delta events', async () => {
    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')

    await runManagedTurn({
      session: mockSession,
      sections: [],
      request: { requestId: 'req-1', locale: 'ro', message: 'Salut' },
      emit: () => {},
      turnId: '99999999-9999-4999-8999-999999999999',
      serviceCtx: {
        userId: mockSession.userId,
        sessionId: mockSession.id,
        requestId: 'req-1',
        now: new Date(),
      },
    })

    // Find the agent_turns UPDATE that wrote the telemetry columns.
    const telemetrySet = setCalls.find(c => 'outputTokens' in c || 'inputTokens' in c)
    expect(telemetrySet).toBeDefined()
    // output_tokens must be 15 (last delta wins), NOT 5+10+15=30.
    expect(telemetrySet!.outputTokens).toBe(15)
    // input_tokens is 100 (from message_start; does not change across deltas).
    expect(telemetrySet!.inputTokens).toBe(100)
    // cache buckets carry from message_start.
    expect(telemetrySet!.cacheReadInputTokens).toBe(30)
    expect(telemetrySet!.cacheCreationInputTokens).toBe(20)
  })
})

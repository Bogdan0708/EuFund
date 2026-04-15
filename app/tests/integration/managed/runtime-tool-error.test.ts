import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotFoundError } from '@/lib/ai/agent/services/errors'

// Helper: build an async iterable matching the SDK's stream shape
function makeFakeStream(events: unknown[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e
    },
  }
}

// Sub-stream 1 — tool_use(get_call_blueprint), stop_reason=tool_use
const stream1Events = [
  { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name: 'get_call_blueprint', input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"callId":"CALL-X"}' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } },
  { type: 'message_stop' },
]

// Sub-stream 2 — text only, stop_reason=end_turn
const stream2Events = [
  { type: 'message_start', message: { id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 150, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Nu am găsit apelul.' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 30 } },
  { type: 'message_stop' },
]

vi.mock('@/lib/ai/anthropic-client', () => ({
  getAnthropicClient: () => ({
    messages: {
      stream: vi.fn()
        .mockImplementationOnce(() => makeFakeStream(stream1Events))
        .mockImplementationOnce(() => makeFakeStream(stream2Events)),
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

// lookupBlueprint throws NotFoundError — executor must catch and map to
// isError tool_result with NOT_FOUND prefix.
vi.mock('@/lib/ai/agent/services/blueprint', () => ({
  lookupBlueprint: vi.fn().mockRejectedValue(new NotFoundError('call', 'CALL-X')),
}))
vi.mock('@/lib/ai/agent/services/evidence', () => ({
  searchCalls: vi.fn(),
  retrieveEvidence: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/application', () => ({
  getApplicationState: vi.fn(),
  getValidationReport: vi.fn(),
  validateApplication: vi.fn(),
  checkMissingAnnexes: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/sections', () => ({
  listSections: vi.fn(),
  getSection: vi.fn(),
  validateSection: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/projects', () => ({
  getProjectSummary: vi.fn(),
  listUploadedDocuments: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/eligibility', () => ({
  runEligibility: vi.fn(),
  scoreFit: vi.fn(),
}))

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

describe('runManagedTurn — service error mapped to tool_result', () => {
  beforeEach(() => vi.clearAllMocks())

  it('catches NotFoundError from service and emits isError tool_result', async () => {
    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    const events: AgentEvent[] = []

    const result = await runManagedTurn({
      session: mockSession,
      sections: [],
      request: {
        requestId: 'req-err-1',
        locale: 'ro',
        message: 'Caută blueprint-ul.',
      },
      emit: (e) => events.push(e),
      turnId: '99999999-9999-4999-8999-999999999999',
      serviceCtx: {
        userId: mockSession.userId,
        sessionId: mockSession.id,
        requestId: 'req-err-1',
        now: new Date(),
      },
    })

    expect(result.toolCount).toBe(1)

    const toolResults = events.filter(e => e.type === 'tool_result')
    expect(toolResults.length).toBe(1)
    const firstResult = toolResults[0]
    if (firstResult.type !== 'tool_result') throw new Error('expected tool_result')
    expect(firstResult.success).toBe(false)
    expect(firstResult.summary).toContain('NOT_FOUND')

    const done = events.find(e => e.type === 'done')
    expect(done).toBeDefined()
  })
})

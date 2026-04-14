import { describe, it, expect, vi, beforeEach } from 'vitest'

// Helper: build an async iterable matching the SDK's stream shape
function makeFakeStream(events: unknown[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e
    },
  }
}

// Sub-stream 1 — tool_use(search_calls), stop_reason=tool_use
const stream1Events = [
  { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name: 'search_calls', input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"solar"}' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } },
  { type: 'message_stop' },
]

// Sub-stream 2 — tool_use(get_call_blueprint), stop_reason=tool_use
const stream2Events = [
  { type: 'message_start', message: { id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 150, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_2', name: 'get_call_blueprint', input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"callId":"CALL-1"}' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 25 } },
  { type: 'message_stop' },
]

// Sub-stream 3 — text only, stop_reason=end_turn
const stream3Events = [
  { type: 'message_start', message: { id: 'msg_3', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 200, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done researching.' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 30 } },
  { type: 'message_stop' },
]

// Mock Anthropic SDK — return a different sub-stream per call
vi.mock('@/lib/ai/anthropic-client', () => ({
  getAnthropicClient: () => ({
    messages: {
      stream: vi.fn()
        .mockImplementationOnce(() => makeFakeStream(stream1Events))
        .mockImplementationOnce(() => makeFakeStream(stream2Events))
        .mockImplementationOnce(() => makeFakeStream(stream3Events)),
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
  return {
    db: {
      select: vi.fn(() => makeChain()),
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    },
  }
})

vi.mock('@/lib/db/schema', () => ({
  agentMessages: { sessionId: 'session_id', sequenceNumber: 'sequence_number' },
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

// Service mocks — searchCalls and lookupBlueprint return concrete results; the
// rest are stubs so executor's `import * as x from ...` does not load the real
// modules.
vi.mock('@/lib/ai/agent/services/evidence', () => ({
  searchCalls: vi.fn().mockResolvedValue({ matches: [] }),
  retrieveEvidence: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/blueprint', () => ({
  lookupBlueprint: vi.fn().mockResolvedValue({ cached: false, blueprint: null, rawEvidence: null }),
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

describe('runManagedTurn — multi-iteration', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs 3 iterations with 2 tool calls then text end_turn', async () => {
    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    const events: AgentEvent[] = []

    const result = await runManagedTurn({
      session: mockSession,
      sections: [],
      request: {
        requestId: 'req-multi-1',
        locale: 'ro',
        message: 'Caută apeluri și citește blueprint-ul.',
      },
      emit: (e) => events.push(e),
      serviceCtx: {
        userId: mockSession.userId,
        sessionId: mockSession.id,
        requestId: 'req-multi-1',
        now: new Date(),
      },
    })

    expect(result.toolCount).toBe(2)
    expect(result.iterationCount).toBe(3)

    const toolStarts = events.filter(e => e.type === 'tool_start')
    expect(toolStarts.length).toBe(2)
    expect(toolStarts.map(e => e.type === 'tool_start' ? e.tool : null)).toEqual([
      'search_calls',
      'get_call_blueprint',
    ])

    const toolResults = events.filter(e => e.type === 'tool_result')
    expect(toolResults.length).toBe(2)
    expect(toolResults.every(e => e.type === 'tool_result' && e.success === true)).toBe(true)

    const done = events.find(e => e.type === 'done')
    expect(done).toBeDefined()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Helper: build an async iterable matching the SDK's stream shape
function makeFakeStream(events: unknown[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e
    },
  }
}

// Every iteration emits a tool_use(search_calls) with stop_reason=tool_use —
// the runtime will loop until it hits the cap.
const tooluseEvents = [
  { type: 'message_start', message: { id: 'msg_loop', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_loop', name: 'search_calls', input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"loop"}' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } },
  { type: 'message_stop' },
]

// Mock Anthropic SDK — every call returns a fresh generator with the same
// tool_use payload. `mockImplementation` (not `mockImplementationOnce`) so the
// pattern repeats indefinitely.
vi.mock('@/lib/ai/anthropic-client', () => ({
  getAnthropicClient: () => ({
    messages: {
      stream: vi.fn().mockImplementation(() => makeFakeStream(tooluseEvents)),
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

vi.mock('@/lib/ai/agent/services/evidence', () => ({
  searchCalls: vi.fn().mockResolvedValue({ matches: [] }),
  retrieveEvidence: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/blueprint', () => ({
  lookupBlueprint: vi.fn(),
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

vi.mock('@/lib/ai/agent/managed/history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/agent/managed/history')>()
  return {
    ...actual,
    appendManagedMessage: vi.fn().mockResolvedValue(0),
    persistFirstDurableOutput: vi.fn().mockResolvedValue(undefined),
    markTurnCompleted: vi.fn().mockResolvedValue(undefined),
    loadManagedHistory: vi.fn().mockResolvedValue({ messages: [], systemSummary: null }),
  }
})

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

describe('runManagedTurn — iteration cap', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stops at ITERATION_CAP (8) and emits a bilingual limit warning', async () => {
    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    const events: AgentEvent[] = []

    const result = await runManagedTurn({
      session: mockSession,
      sections: [],
      request: {
        requestId: 'req-cap-1',
        locale: 'ro',
        message: 'Rulează mereu tool-uri.',
      },
      emit: (e) => events.push(e),
      turnId: '99999999-9999-4999-8999-999999999999',
      serviceCtx: {
        userId: mockSession.userId,
        sessionId: mockSession.id,
        requestId: 'req-cap-1',
        now: new Date(),
      },
    })

    expect(result.iterationCount).toBe(8)

    const done = events.find(e => e.type === 'done')
    expect(done).toBeDefined()

    // The runtime pushes the iteration-limit warning as a text_delta right
    // before the done event.
    const doneIdx = events.findIndex(e => e.type === 'done')
    const preDone = events[doneIdx - 1]
    expect(preDone).toBeDefined()
    expect(preDone.type).toBe('text_delta')
    if (preDone.type === 'text_delta') {
      expect(
        preDone.content.includes('iteration limit')
          || preDone.content.includes('iteration')
          || preDone.content.includes('Limita de iterații')
          || preDone.content.includes('iterații'),
      ).toBe(true)
    }

    // PR1 Change F1: cap text MUST also be appended to agent_messages so the
    // next turn's loadManagedHistory replays the bail-out signal.
    const { appendManagedMessage } = await import('@/lib/ai/agent/managed/history')
    const calls = vi.mocked(appendManagedMessage).mock.calls
    const capCall = calls.find(([, msg]) => {
      if (typeof msg.content === 'string') {
        return msg.content.includes('Limita de iterații') || msg.content.includes('iteration limit')
      }
      return false
    })
    expect(capCall).toBeDefined()
    expect(capCall![0]).toBe(mockSession.id)
    expect(capCall![1].role).toBe('assistant')
    expect(capCall![1].messageType).toBe('text')
    expect(capCall![1].turnId).toBe('99999999-9999-4999-8999-999999999999')
  })

  it('does NOT crash if the cap-text persistence fails — markTurnCompleted still runs', async () => {
    const { appendManagedMessage, markTurnCompleted } = await import('@/lib/ai/agent/managed/history')

    // Reject ONLY when the runtime tries to persist the cap-text. The
    // tool-loop calls appendManagedMessage once per tool_result before the
    // cap is reached (8 iterations × 1 tool_result/iteration = 8 calls
    // before cap-text persistence). A blanket mockRejectedValueOnce would
    // fire on the first tool_result and short-circuit the test before
    // exercising the cap-text catch path.
    vi.mocked(appendManagedMessage).mockImplementation(async (_sessionId, msg) => {
      const isCapText =
        typeof msg.content === 'string' &&
        (msg.content.includes('Limita de iterații') || msg.content.includes('iteration limit'))
      if (isCapText) throw new Error('db blip')
      return 0
    })

    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    const events: AgentEvent[] = []

    await runManagedTurn({
      session: mockSession,
      sections: [],
      request: { requestId: 'req-cap-fail', locale: 'ro', message: 'Loop forever.' },
      emit: (e) => events.push(e),
      turnId: '99999999-9999-4999-8999-999999999999',
      serviceCtx: {
        userId: mockSession.userId,
        sessionId: mockSession.id,
        requestId: 'req-cap-fail',
        now: new Date(),
      },
    })

    // markTurnCompleted MUST still run.
    expect(markTurnCompleted).toHaveBeenCalled()

    // The done event still fires.
    expect(events.find(e => e.type === 'done')).toBeDefined()
  })
})

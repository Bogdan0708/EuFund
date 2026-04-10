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
  })
})

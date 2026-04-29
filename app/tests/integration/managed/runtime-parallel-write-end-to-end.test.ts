import { describe, it, expect, vi, beforeEach } from 'vitest'

function makeFakeStream(events: unknown[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e
    },
  }
}

// Sub-stream 1 — assistant emits TWO save_section_draft tool_use blocks
// in one message. Runtime cap must execute only the first; the second
// should return PARALLEL_WRITE_BLOCKED without service dispatch.
const stream1Events = [
  { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name: 'save_section_draft', input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"sessionId":"11111111-1111-4111-8111-111111111111","sectionKey":"obiective","content":"first","expectedStateVersion":0}' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_2', name: 'save_section_draft', input: {} } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"sessionId":"11111111-1111-4111-8111-111111111111","sectionKey":"rezultate","content":"second","expectedStateVersion":0}' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 40 } },
  { type: 'message_stop' },
]

const stream2Events = [
  { type: 'message_start', message: { id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 150, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Am salvat prima secțiune.' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } },
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

vi.mock('drizzle-orm', () => ({ eq: vi.fn(), asc: vi.fn(), desc: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

vi.mock('@/lib/ai/agent/services/evidence', () => ({ searchCalls: vi.fn(), retrieveEvidence: vi.fn() }))
vi.mock('@/lib/ai/agent/services/blueprint', () => ({ lookupBlueprint: vi.fn() }))
vi.mock('@/lib/ai/agent/services/application', () => ({
  getApplicationState: vi.fn(),
  getValidationReport: vi.fn(),
  validateApplication: vi.fn(),
  checkMissingAnnexes: vi.fn(),
  setApplicationStatus: vi.fn(),
  setSelectedCall: vi.fn(),
  freezeOutline: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/sections', () => ({
  listSections: vi.fn(),
  getSection: vi.fn(),
  validateSection: vi.fn(),
  saveSectionDraft: vi.fn(),
  approveSection: vi.fn(),
  rollbackSection: vi.fn(),
  markSectionStale: vi.fn(),
  rejectSection: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/projects', () => ({ getProjectSummary: vi.fn(), listUploadedDocuments: vi.fn() }))
vi.mock('@/lib/ai/agent/services/eligibility', () => ({ runEligibility: vi.fn(), scoreFit: vi.fn() }))

// PR1 Change B: post-write reload runs after a successful write tool. This
// test exercises a successful saveSectionDraft, so the runtime now calls
// reloadSessionAndSections; mock it to a no-op resolution.
vi.mock('@/lib/ai/agent/managed/reload', () => ({
  reloadSessionAndSections: vi.fn().mockResolvedValue({
    session: {
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      projectId: null,
      status: 'active',
      locale: 'ro',
      selectedCallId: 'CALL-1',
      currentPhase: 'drafting',
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
    },
    sections: [],
  }),
}))

import type { AgentEvent, AgentSession } from '@/lib/ai/agent/types'

const mockSession: AgentSession = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  projectId: null,
  status: 'active',
  locale: 'ro',
  selectedCallId: 'CALL-1',
  currentPhase: 'drafting',
  blueprint: null,
  eligibility: null,
  outline: null,
  warnings: [],
  planningArtifact: null,
  outlineFrozen: true,
  messageSummary: null,
  stateVersion: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('runManagedTurn — parallel write cap end-to-end', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs the first write, rejects the second with PARALLEL_WRITE_BLOCKED, preserves pairing order', async () => {
    const { saveSectionDraft } = await import('@/lib/ai/agent/services/sections')
    vi.mocked(saveSectionDraft).mockResolvedValueOnce({
      sectionId: 'sec-1',
      versionNumber: 1,
      newStateVersion: 1,
    } as never)

    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    const events: AgentEvent[] = []

    await runManagedTurn({
      session: mockSession,
      sections: [],
      request: {
        requestId: 'req-parallel-writes',
        locale: 'ro',
        message: 'Salvează două secțiuni deodată.',
      },
      emit: (e) => events.push(e),
      turnId: '99999999-9999-4999-8999-999999999999',
      serviceCtx: {
        userId: mockSession.userId,
        sessionId: mockSession.id,
        requestId: 'req-parallel-writes',
        now: new Date(),
        allowWrites: true,
      },
    })

    // Only ONE service call, for the first write.
    expect(saveSectionDraft).toHaveBeenCalledTimes(1)
    const [, inputArg] = vi.mocked(saveSectionDraft).mock.calls[0]
    expect(inputArg.sectionKey).toBe('obiective')
    expect(inputArg.content).toBe('first')

    // Two tool_result events in emit order: tu_1 success, tu_2 blocked.
    const toolResults = events.filter((e) => e.type === 'tool_result')
    expect(toolResults.length).toBe(2)

    const r1 = toolResults[0]
    const r2 = toolResults[1]
    if (r1.type !== 'tool_result' || r2.type !== 'tool_result') {
      throw new Error('expected tool_result events')
    }
    expect(r1.success).toBe(true)
    expect(r1.tool).toBe('save_section_draft')
    expect(r2.success).toBe(false)
    expect(r2.tool).toBe('save_section_draft')
    expect(r2.summary).toMatch(/^PARALLEL_WRITE_BLOCKED:/)

    // The turn completes cleanly.
    const done = events.find((e) => e.type === 'done')
    expect(done).toBeDefined()
  })
})

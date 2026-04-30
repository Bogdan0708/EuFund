import { describe, it, expect, vi, beforeEach } from 'vitest'

function makeFakeStream(events: unknown[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e
    },
  }
}

const stream1Events = [
  { type: 'message_start', message: { id: 'm1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_set', name: 'set_selected_call', input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"sessionId":"11111111-1111-4111-8111-111111111111","callId":"CALL-1","expectedStateVersion":0}' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } },
  { type: 'message_stop' },
]

const stream2Events = [
  { type: 'message_start', message: { id: 'm2', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 150, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done.' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } },
  { type: 'message_stop' },
]

const { getAnthropicClient } = vi.hoisted(() => ({
  getAnthropicClient: vi.fn(() => ({
    messages: {
      stream: vi.fn()
        .mockImplementationOnce(() => makeFakeStream(stream1Events))
        .mockImplementationOnce(() => makeFakeStream(stream2Events)),
    },
  })),
}))

vi.mock('@/lib/ai/anthropic-client', () => ({ getAnthropicClient }))

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
  agentSections: { sessionId: 'session_id' },
  runtimeModeEnum: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  asc: vi.fn(),
  desc: vi.fn(),
}))

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

// Spy on markTurnCompleted so we can assert it ran before the reload threw.
vi.mock('@/lib/ai/agent/managed/history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/agent/managed/history')>()
  return {
    ...actual,
    markTurnCompleted: vi.fn().mockResolvedValue(undefined),
    appendManagedMessage: vi.fn().mockResolvedValue(0),
    persistFirstDurableOutput: vi.fn().mockResolvedValue(undefined),
    loadManagedHistory: vi.fn().mockResolvedValue({ messages: [], systemSummary: null }),
  }
})

vi.mock('@/lib/ai/agent/managed/reload', () => ({
  reloadSessionAndSections: vi.fn(),
}))

import type { AgentEvent, AgentSession } from '@/lib/ai/agent/types'

const mockSession: AgentSession = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  projectId: null,
  status: 'active',
  locale: 'ro',
  selectedCallId: null,
  currentPhase: 'research',
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

describe('runManagedTurn — reload failure', () => {
  beforeEach(() => vi.clearAllMocks())

  it('emits exactly one terminal error, no done, after markTurnCompleted', async () => {
    const { setSelectedCall } = await import('@/lib/ai/agent/services/application')
    vi.mocked(setSelectedCall).mockResolvedValueOnce({ newStateVersion: 1 } as never)

    const { reloadSessionAndSections } = await import('@/lib/ai/agent/managed/reload')
    vi.mocked(reloadSessionAndSections).mockRejectedValueOnce(new Error('db down'))

    const { markTurnCompleted } = await import('@/lib/ai/agent/managed/history')

    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    const events: AgentEvent[] = []

    await runManagedTurn({
      session: mockSession,
      sections: [],
      request: { requestId: 'req-fail', locale: 'ro', message: 'Selectează apelul.' },
      emit: (e) => events.push(e),
      turnId: '99999999-9999-4999-8999-999999999999',
      serviceCtx: {
        userId: mockSession.userId,
        sessionId: mockSession.id,
        requestId: 'req-fail',
        now: new Date(),
        allowWrites: true,
      },
    })

    // markTurnCompleted MUST have run BEFORE the reload threw — proves the
    // turn is recorded as completed even though the post-write reload failed.
    // Assert ordering via invocationCallOrder, not just call count: a future
    // refactor that runs the reload first and falls through to markTurnCompleted
    // on success would still see "called once" but would no longer satisfy the
    // ordering invariant the catch path depends on.
    expect(markTurnCompleted).toHaveBeenCalledTimes(1)
    expect(reloadSessionAndSections).toHaveBeenCalledTimes(1)
    const markOrder = vi.mocked(markTurnCompleted).mock.invocationCallOrder[0]
    const reloadOrder = vi.mocked(reloadSessionAndSections).mock.invocationCallOrder[0]
    expect(markOrder).toBeLessThan(reloadOrder)

    const errorEvents = events.filter(e => e.type === 'error')
    expect(errorEvents).toHaveLength(1)
    if (errorEvents[0].type !== 'error') throw new Error('expected error event')
    expect(errorEvents[0].retryable).toBe(false)
    expect(errorEvents[0].message).toMatch(/Sesiunea|Session/)
    expect(errorEvents[0].message.length).toBeGreaterThan(0)

    const doneEvents = events.filter(e => e.type === 'done')
    expect(doneEvents).toHaveLength(0)
  })

  it('does NOT emit terminal error when reload succeeds', async () => {
    const { setSelectedCall } = await import('@/lib/ai/agent/services/application')
    vi.mocked(setSelectedCall).mockResolvedValueOnce({ newStateVersion: 1 } as never)

    const { reloadSessionAndSections } = await import('@/lib/ai/agent/managed/reload')
    vi.mocked(reloadSessionAndSections).mockResolvedValueOnce({
      session: { ...mockSession, stateVersion: 1 },
      sections: [],
    })

    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    const events: AgentEvent[] = []

    await runManagedTurn({
      session: mockSession,
      sections: [],
      request: { requestId: 'req-ok', locale: 'ro', message: 'Selectează apelul.' },
      emit: (e) => events.push(e),
      turnId: '99999999-9999-4999-8999-999999999999',
      serviceCtx: {
        userId: mockSession.userId,
        sessionId: mockSession.id,
        requestId: 'req-ok',
        now: new Date(),
        allowWrites: true,
      },
    })

    expect(events.filter(e => e.type === 'error')).toHaveLength(0)
    expect(events.filter(e => e.type === 'done')).toHaveLength(1)
  })
})

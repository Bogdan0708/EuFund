import { describe, it, expect, vi, beforeEach } from 'vitest'

function makeFakeStream(events: unknown[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e
    },
  }
}

const streamEvents = [
  { type: 'message_start', message: { id: 'm1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi.' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } },
  { type: 'message_stop' },
]

const { getAnthropicClient } = vi.hoisted(() => ({
  getAnthropicClient: vi.fn(() => ({
    messages: {
      stream: vi.fn().mockImplementation(() => makeFakeStream(streamEvents)),
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

vi.mock('@/lib/ai/agent/history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/agent/history')>()
  return {
    ...actual,
    compactIfNeeded: vi.fn(),
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

describe('runManagedTurn — compaction failure surfacing', () => {
  beforeEach(() => vi.clearAllMocks())

  it('emits done with degradedReason="compaction_failed" when compaction throws', async () => {
    const { compactIfNeeded } = await import('@/lib/ai/agent/history')
    vi.mocked(compactIfNeeded).mockRejectedValueOnce(new Error('compaction db down'))

    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    const events: AgentEvent[] = []

    await runManagedTurn({
      session: mockSession,
      sections: [],
      request: { requestId: 'req-compact', locale: 'ro', message: 'salut' },
      emit: (e) => events.push(e),
      turnId: '99999999-9999-4999-8999-999999999999',
      serviceCtx: {
        userId: mockSession.userId,
        sessionId: mockSession.id,
        requestId: 'req-compact',
        now: new Date(),
        allowWrites: true,
      },
    })

    // The turn is durable — output landed, so done event should fire.
    const doneEvents = events.filter(e => e.type === 'done')
    expect(doneEvents).toHaveLength(1)
    if (doneEvents[0].type !== 'done') throw new Error('expected done event')
    expect(doneEvents[0].degradedReason).toBe('compaction_failed')

    // No user-visible error event — compaction failure is observability-only.
    expect(events.filter(e => e.type === 'error')).toHaveLength(0)
  })

  it('emits done with degradedReason=null on the happy path', async () => {
    const { compactIfNeeded } = await import('@/lib/ai/agent/history')
    vi.mocked(compactIfNeeded).mockResolvedValueOnce({ compacted: false } as never)

    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    const events: AgentEvent[] = []

    await runManagedTurn({
      session: mockSession,
      sections: [],
      request: { requestId: 'req-happy', locale: 'ro', message: 'salut' },
      emit: (e) => events.push(e),
      turnId: '99999999-9999-4999-8999-999999999999',
      serviceCtx: {
        userId: mockSession.userId,
        sessionId: mockSession.id,
        requestId: 'req-happy',
        now: new Date(),
        allowWrites: true,
      },
    })

    const doneEvents = events.filter(e => e.type === 'done')
    expect(doneEvents).toHaveLength(1)
    if (doneEvents[0].type !== 'done') throw new Error('expected done event')
    expect(doneEvents[0].degradedReason).toBeNull()
  })
})

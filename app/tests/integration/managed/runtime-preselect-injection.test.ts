import { describe, it, expect, vi, beforeEach } from 'vitest'

function makeFakeStream(events: unknown[]) {
  return { [Symbol.asyncIterator]: async function* () { for (const e of events) yield e } }
}

// Stream emits text only — we don't need tool_use here; we're inspecting
// what's passed to anthropic.messages.stream as `messages`.
const textOnlyStream = [
  { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
  { type: 'message_stop' },
]

const streamSpy = vi.fn().mockImplementation(() => makeFakeStream(textOnlyStream))

vi.mock('@/lib/ai/anthropic-client', () => ({
  getAnthropicClient: () => ({ messages: { stream: streamSpy } }),
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
  agentSessions: { id: 'id', userId: 'user_id', currentPhase: 'current_phase', selectedCallId: 'selected_call_id', stateVersion: 'state_version' },
  // PR1's reload helper (managed/reload.ts) imports agentSections — must be
  // mocked here even though this test does not exercise it directly. Without
  // this entry, importing runtime.ts blows up before reaching the injection
  // assertion.
  agentSections: { sessionId: 'session_id' },
  runtimeModeEnum: {},
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), asc: vi.fn(), desc: vi.fn(), sql: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))

vi.mock('@/lib/ai/agent/services/evidence', () => ({ searchCalls: vi.fn(), retrieveEvidence: vi.fn() }))
vi.mock('@/lib/ai/agent/services/blueprint', () => ({ lookupBlueprint: vi.fn(), saveCallBlueprint: vi.fn(), buildCallBlueprintFromArgs: vi.fn() }))
vi.mock('@/lib/ai/agent/services/application', () => ({
  getApplicationState: vi.fn(), getValidationReport: vi.fn(),
  validateApplication: vi.fn(), checkMissingAnnexes: vi.fn(),
  setApplicationStatus: vi.fn(), setSelectedCall: vi.fn(), freezeOutline: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/sections', () => ({
  listSections: vi.fn(), getSection: vi.fn(), validateSection: vi.fn(),
  saveSectionDraft: vi.fn(), approveSection: vi.fn(), rollbackSection: vi.fn(),
  markSectionStale: vi.fn(), rejectSection: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/projects', () => ({ getProjectSummary: vi.fn(), listUploadedDocuments: vi.fn() }))
vi.mock('@/lib/ai/agent/services/eligibility', () => ({ runEligibility: vi.fn(), scoreFit: vi.fn() }))

import type { AgentSession, AgentEvent } from '@/lib/ai/agent/types'

const baseSession: AgentSession = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  projectId: null,
  status: 'active',
  locale: 'ro',
  selectedCallId: 'CALL-1',
  currentPhase: 'research',
  blueprint: null,
  eligibility: null,
  outline: null,
  warnings: [],
  // PlanningArtifact does not declare a `preselect` branch; use a cast that
  // matches the runtime's read-side cast in managed/runtime.ts so the test
  // exercises the same shape the code consumes.
  planningArtifact: {
    preselect: {
      version: 1,
      rankedAt: '2026-04-29T00:00:00Z',
      description: 'd',
      selectedCallId: 'CALL-1',
      selectedScore: 0.8,
      candidates: [],
      selectionKind: 'selected',
      blueprintKind: 'raw_evidence',
      excludeCallIdsApplied: [],
      rawEvidence: [
        { id: 'c0', content: 'chunk 0', docType: 'ghid', source: 's', score: 0.9, priority: 1 },
        { id: 'c1', content: 'chunk 1', docType: 'ghid', source: 's', score: 0.8, priority: 1 },
      ],
    },
  } as never,
  outlineFrozen: false,
  messageSummary: null,
  stateVersion: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('runManagedTurn — preselect synthetic injection', () => {
  beforeEach(() => { vi.clearAllMocks(); streamSpy.mockImplementation(() => makeFakeStream(textOnlyStream)) })

  it('injects synthetic retrieve_evidence tool_use+tool_result before user message', async () => {
    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    const events: AgentEvent[] = []

    await runManagedTurn({
      session: baseSession,
      sections: [],
      request: { requestId: 'r1', locale: 'ro', message: 'extract' },
      emit: (e) => events.push(e),
      turnId: '99999999-9999-4999-8999-999999999999',
      serviceCtx: { userId: baseSession.userId, sessionId: baseSession.id, requestId: 'r1', now: new Date() },
    })

    expect(streamSpy).toHaveBeenCalled()
    const passedMessages = streamSpy.mock.calls[0][0].messages as Array<{ role: string; content: unknown }>

    // Find the synthetic blocks. They must appear before the current user message.
    const userMessageIdx = passedMessages.findIndex(m =>
      m.role === 'user' && typeof m.content === 'string' && m.content === 'extract',
    )
    expect(userMessageIdx).toBeGreaterThanOrEqual(0)

    const syntheticAssistantIdx = passedMessages.findIndex(m =>
      m.role === 'assistant' && Array.isArray(m.content) &&
      (m.content as { type: string; name?: string }[]).some(b => b.type === 'tool_use' && b.name === 'retrieve_evidence'),
    )
    expect(syntheticAssistantIdx).toBeGreaterThanOrEqual(0)
    expect(syntheticAssistantIdx).toBeLessThan(userMessageIdx)

    const syntheticUserIdx = syntheticAssistantIdx + 1
    const syntheticUser = passedMessages[syntheticUserIdx]
    expect(syntheticUser.role).toBe('user')
    const userBlocks = syntheticUser.content as Array<{ type: string; tool_use_id?: string; content?: string }>
    expect(userBlocks[0].type).toBe('tool_result')
    expect(userBlocks[0].tool_use_id).toMatch(/^preselect_evidence_/)

    // Synthetic chunks survived in the tool_result content.
    const parsedContent = JSON.parse(userBlocks[0].content as string)
    expect(parsedContent.callId).toBe('CALL-1')
    expect(parsedContent.chunks).toHaveLength(2)
    expect(parsedContent.chunks[0].id).toBe('c0')
  })

  it('does NOT inject when session.blueprint is already set', async () => {
    const session = { ...baseSession, blueprint: { callId: 'CALL-1' } as never }
    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    await runManagedTurn({
      session, sections: [],
      request: { requestId: 'r2', locale: 'ro', message: 'hi' },
      emit: () => {},
      turnId: '99999999-9999-4999-8999-999999999999',
      serviceCtx: { userId: session.userId, sessionId: session.id, requestId: 'r2', now: new Date() },
    })

    const passedMessages = streamSpy.mock.calls[0][0].messages as Array<{ role: string; content: unknown }>
    const synthetic = passedMessages.find(m =>
      m.role === 'assistant' && Array.isArray(m.content) &&
      (m.content as { type: string; name?: string }[]).some(b => b.type === 'tool_use' && b.name === 'retrieve_evidence'),
    )
    expect(synthetic).toBeUndefined()
  })

  it('does NOT inject when phase is not research', async () => {
    const session = { ...baseSession, currentPhase: 'structuring' as const }
    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    await runManagedTurn({
      session, sections: [],
      request: { requestId: 'r3', locale: 'ro', message: 'hi' },
      emit: () => {},
      turnId: '99999999-9999-4999-8999-999999999999',
      serviceCtx: { userId: session.userId, sessionId: session.id, requestId: 'r3', now: new Date() },
    })

    const passedMessages = streamSpy.mock.calls[0][0].messages as Array<{ role: string; content: unknown }>
    const synthetic = passedMessages.find(m =>
      m.role === 'assistant' && Array.isArray(m.content) &&
      (m.content as { type: string; name?: string }[]).some(b => b.type === 'tool_use' && b.name === 'retrieve_evidence'),
    )
    expect(synthetic).toBeUndefined()
  })

  it('does NOT inject when rawEvidence is empty', async () => {
    const session = {
      ...baseSession,
      planningArtifact: { preselect: { ...(baseSession.planningArtifact as { preselect: object }).preselect, rawEvidence: [] } },
    } as AgentSession
    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    await runManagedTurn({
      session, sections: [],
      request: { requestId: 'r4', locale: 'ro', message: 'hi' },
      emit: () => {},
      turnId: '99999999-9999-4999-8999-999999999999',
      serviceCtx: { userId: session.userId, sessionId: session.id, requestId: 'r4', now: new Date() },
    })
    const passedMessages = streamSpy.mock.calls[0][0].messages as Array<{ role: string; content: unknown }>
    const synthetic = passedMessages.find(m =>
      m.role === 'assistant' && Array.isArray(m.content) &&
      (m.content as { type: string; name?: string }[]).some(b => b.type === 'tool_use' && b.name === 'retrieve_evidence'),
    )
    expect(synthetic).toBeUndefined()
  })
})

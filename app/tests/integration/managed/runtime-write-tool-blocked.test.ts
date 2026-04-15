import { describe, it, expect, vi, beforeEach } from 'vitest'

// Helper: build an async iterable matching the SDK's stream shape
function makeFakeStream(events: unknown[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e
    },
  }
}

// Sub-stream 1 — tool_use(save_section_draft), stop_reason=tool_use. The
// executor should reject this write tool before dispatching to any service.
const stream1Events = [
  { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name: 'save_section_draft', input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"sectionKey":"intro","content":"hello"}' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } },
  { type: 'message_stop' },
]

// Sub-stream 2 — text only, stop_reason=end_turn
const stream2Events = [
  { type: 'message_start', message: { id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 150, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Îmi pare rău, nu pot salva.' } },
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

// All service mocks empty — none should be called. sections.saveSectionDraft
// intentionally NOT mocked to prove the allowlist rejects the tool name
// before any service is invoked.
vi.mock('@/lib/ai/agent/services/evidence', () => ({
  searchCalls: vi.fn(),
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

describe('runManagedTurn — write tool blocked', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects save_section_draft with Phase 2 message before invoking any service', async () => {
    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    const { searchCalls, retrieveEvidence } = await import('@/lib/ai/agent/services/evidence')
    const { lookupBlueprint } = await import('@/lib/ai/agent/services/blueprint')
    const { getApplicationState, getValidationReport, validateApplication, checkMissingAnnexes } =
      await import('@/lib/ai/agent/services/application')
    const { listSections, getSection, validateSection } =
      await import('@/lib/ai/agent/services/sections')
    const { getProjectSummary, listUploadedDocuments } =
      await import('@/lib/ai/agent/services/projects')
    const { runEligibility, scoreFit } = await import('@/lib/ai/agent/services/eligibility')

    const events: AgentEvent[] = []

    await runManagedTurn({
      session: mockSession,
      sections: [],
      request: {
        requestId: 'req-write-1',
        locale: 'ro',
        message: 'Salvează secțiunea.',
      },
      emit: (e) => events.push(e),
      turnId: '99999999-9999-4999-8999-999999999999',
      serviceCtx: {
        userId: mockSession.userId,
        sessionId: mockSession.id,
        requestId: 'req-write-1',
        now: new Date(),
      },
    })

    const toolResults = events.filter(e => e.type === 'tool_result')
    expect(toolResults.length).toBe(1)
    const first = toolResults[0]
    if (first.type !== 'tool_result') throw new Error('expected tool_result')
    expect(first.success).toBe(false)
    expect(first.summary).toContain('Phase 2')

    // No service mock was called — the rejection must happen at the allowlist
    // stage, before any dispatch.
    expect(searchCalls).not.toHaveBeenCalled()
    expect(retrieveEvidence).not.toHaveBeenCalled()
    expect(lookupBlueprint).not.toHaveBeenCalled()
    expect(getApplicationState).not.toHaveBeenCalled()
    expect(getValidationReport).not.toHaveBeenCalled()
    expect(validateApplication).not.toHaveBeenCalled()
    expect(checkMissingAnnexes).not.toHaveBeenCalled()
    expect(listSections).not.toHaveBeenCalled()
    expect(getSection).not.toHaveBeenCalled()
    expect(validateSection).not.toHaveBeenCalled()
    expect(getProjectSummary).not.toHaveBeenCalled()
    expect(listUploadedDocuments).not.toHaveBeenCalled()
    expect(runEligibility).not.toHaveBeenCalled()
    expect(scoreFit).not.toHaveBeenCalled()

    const done = events.find(e => e.type === 'done')
    expect(done).toBeDefined()
  })
})

// app/tests/unit/ai/agent/runtime-message-push.test.ts
//
// Task 21: V3 runtime — consolidate assistant-message push.
//
// Probes that runAgentTurn pushes exactly ONE assistant message per iteration
// into the `messages` array passed to generate(), and that tool_calls are
// included natively when present. This fixes the latent shim bug Task 13
// probed: the old double-push sites only pushed `{ role, content }` and
// silently dropped tool_calls.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Snapshot the `messages` array on each call (it's the same mutable reference
// across iterations — without cloning, test assertions on mock.calls[i] see
// the final post-mutation state).
const messagesByCall: Array<Array<Record<string, unknown>>> = []
const responsesQueue: Array<unknown> = []
const generateMock = vi.fn(async (args: { messages: Array<Record<string, unknown>> }) => {
  messagesByCall.push(args.messages.map((m) => ({ ...m })))
  const next = responsesQueue.shift()
  if (next === undefined) throw new Error('generateMock: no response queued')
  return next
})

// Stub tool that succeeds — needed so iteration 1's hasToolCalls=true and
// iteration 2 fires, letting us inspect the assistant-message shape on
// re-entry to generate().
const stubTool = {
  name: 't',
  description: 'stub tool for runtime-push test',
  inputSchema: { parse: (v: unknown) => v },
  timeout: 5000,
  execute: async () => ({
    success: true,
    data: { ok: true },
    telemetry: { latencyMs: 1 },
  }),
}

vi.mock('@/lib/ai/providers/router', () => ({ generate: generateMock }))
vi.mock('@/lib/ai/agent/policies', () => ({ checkPolicyGate: () => ({ allowed: true }) }))
vi.mock('@/lib/ai/agent/tools/registry', () => ({ getToolsForPhase: () => [stubTool] }))
vi.mock('@/lib/ai/agent/tools/index', () => ({}))
vi.mock('@/lib/ai/agent/history', () => ({
  loadContext: async () => ({ summary: null, messages: [], totalCount: 0 }),
  appendMessage: vi.fn().mockResolvedValue(0),
  compactIfNeeded: vi.fn().mockResolvedValue({ compacted: false }),
}))
vi.mock('@/lib/ai/agent/prompt', () => ({ buildSystemPrompt: () => 'system' }))
vi.mock('@/lib/ai/knowledge/session-knowledge', () => ({ getSessionKnowledge: async () => [] }))
vi.mock('@/lib/ai/knowledge/write-back', () => ({
  onSectionAccepted: vi.fn(),
  onPhaseTransition: vi.fn(),
  trackPatternUsage: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))
vi.mock('@/lib/db', () => ({
  db: {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        then: (resolve: (v: unknown) => void) => resolve(undefined),
      }),
    }),
  },
}))

describe('V3 runAgentTurn — assistant-message push consolidation (Task 21)', () => {
  beforeEach(() => {
    generateMock.mockClear()
    messagesByCall.length = 0
    responsesQueue.length = 0
  })

  it('pushes exactly one assistant message per iteration, with native tool_calls when present', async () => {
    // Iteration 1: assistant returns text + a tool_call.
    responsesQueue.push({
      content: 'thinking',
      toolCalls: [{ id: 'c1', name: 't', arguments: '{}' }],
    })
    // Iteration 2: after tool_result fed back, assistant replies with text only.
    responsesQueue.push({ content: 'done' })

    const { runAgentTurn } = await import('@/lib/ai/agent/runtime')
    const session = {
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      projectId: null,
      status: 'active',
      locale: 'ro',
      selectedCallId: null,
      currentPhase: 'drafting',
      blueprint: null,
      eligibility: null,
      outline: [],
      warnings: [],
      planningArtifact: null,
      outlineFrozen: false,
      messageSummary: null,
      stateVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Parameters<typeof runAgentTurn>[0]['session']

    await runAgentTurn({
      session,
      sections: [],
      request: { message: 'hi', requestId: 'req-1', locale: 'ro' },
      emit: () => {},
    })

    expect(generateMock).toHaveBeenCalledTimes(2)

    // Iteration 2's `messages` arg must contain: user 'hi', assistant (w/ tool_calls), tool result.
    // messagesByCall holds a per-call snapshot; live mock.calls[i] would be mutated
    // by subsequent pushes on the same array reference.
    const iter2Messages = messagesByCall[1] as Array<{
      role: string
      content: string
      tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
      tool_call_id?: string
    }>

    // Exactly one assistant message per preceding iteration (iteration 1 ran once).
    const assistantMsgs = iter2Messages.filter((m) => m.role === 'assistant')
    expect(assistantMsgs).toHaveLength(1)

    const asst = assistantMsgs[0]
    expect(asst.tool_calls).toBeDefined()
    expect(asst.tool_calls).toHaveLength(1)
    expect(asst.tool_calls![0]).toEqual({
      id: 'c1',
      type: 'function',
      function: { name: 't', arguments: '{}' },
    })

    // Sanity: user + tool messages are also present, tool keyed by tool_call_id 'c1'.
    expect(iter2Messages.find((m) => m.role === 'user')).toBeDefined()
    expect(iter2Messages.find((m) => m.role === 'tool' && m.tool_call_id === 'c1')).toBeDefined()
  })
})

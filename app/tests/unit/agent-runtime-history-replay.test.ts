// app/tests/unit/agent-runtime-history-replay.test.ts
//
// Regression test for V3 history replay bug:
//   On the 2nd turn of a V3 session that previously executed a tool, runtime.ts
//   used to rebuild the LLM messages array from history.messages but only carry
//   {role, content} — dropping the tool_call_id on tool rows AND failing to
//   reconstruct the assistant's tool_calls[] from persisted tool_call rows.
//   Providers then sent `tool_call_id: ''` upstream and Anthropic rejected.
//
// This test pins the propagation: tool_call rows must round-trip through history
// replay as proper assistant{tool_calls[]} + tool{tool_call_id} pairs.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture what runtime.ts passes to the provider router so we can assert on it.
// vi.mock factories are hoisted above imports — use vi.hoisted to share refs.
const { generateMock, loadContextMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
  loadContextMock: vi.fn(),
}))

vi.mock('@/lib/ai/agent/history', () => ({
  loadContext: loadContextMock,
  appendMessage: vi.fn().mockResolvedValue(0),
  compactIfNeeded: vi.fn().mockResolvedValue({ compacted: false }),
}))

vi.mock('@/lib/ai/providers/router', () => ({
  generate: generateMock,
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

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

vi.mock('@/lib/ai/knowledge/write-back', () => ({
  onSectionAccepted: vi.fn().mockResolvedValue(undefined),
  onPhaseTransition: vi.fn().mockResolvedValue(undefined),
  trackPatternUsage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ai/knowledge/session-knowledge', () => ({
  getSessionKnowledge: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(false),
}))

import { runAgentTurn } from '@/lib/ai/agent/runtime'
import type { AgentSession, AgentEvent } from '@/lib/ai/agent/types'

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    status: 'active',
    locale: 'ro',
    selectedCallId: null,
    currentPhase: 'discovery',
    projectId: null,
    blueprint: null,
    eligibility: null,
    outline: null,
    warnings: [],
    outlineFrozen: false,
    planningArtifact: null,
    messageSummary: null,
    stateVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('V3 runtime — history replay tool_call propagation', () => {
  let events: AgentEvent[]
  const emit = (e: AgentEvent) => events.push(e)

  beforeEach(() => {
    events = []
    vi.clearAllMocks()
    // Provider returns plain text — no tool calls — so the loop exits after one pass.
    generateMock.mockResolvedValue({
      content: 'Got it.',
      tokensUsed: { input: 10, output: 5 },
      model: 'claude-opus-4-6',
      provider: 'anthropic',
      toolCalls: [],
    })
  })

  it('rebuilds assistant tool_calls and tool tool_call_id from persisted history', async () => {
    // Simulate a session that already executed one tool call: the previous turn
    // persisted (a) an assistant tool_call row and (b) a tool tool_result row.
    loadContextMock.mockResolvedValue({
      messages: [
        { role: 'user', content: 'Search for funding calls' },
        // tool_call row: assistant role, content is JSON-stringified {name, arguments},
        // toolCallId + toolName preserved.
        {
          role: 'assistant',
          content: JSON.stringify({ name: 'search_calls', arguments: '{"query":"green"}' }),
          toolCallId: 'call_abc',
          toolName: 'search_calls',
        },
        // tool_result row: role='tool', content is JSON-stringified result,
        // toolCallId points back at the assistant call.
        {
          role: 'tool',
          content: JSON.stringify({ success: true, data: { results: [] } }),
          toolCallId: 'call_abc',
          toolName: 'search_calls',
        },
      ],
      summary: null,
      totalCount: 3,
    })

    await runAgentTurn({
      session: makeSession({ stateVersion: 1 }),
      sections: [],
      request: { message: 'And now what?', requestId: 'req-replay', locale: 'ro' },
      emit,
      turnId: 'tu-replay',
    })

    expect(generateMock).toHaveBeenCalledTimes(1)
    const passedReq = generateMock.mock.calls[0][0] as { messages: Array<{
      role: string
      content: string
      tool_call_id?: string
      tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
    }> }
    const messages = passedReq.messages

    // Find the assistant tool_call message — it must carry tool_calls[].
    const assistantToolCall = messages.find(
      (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
    )
    expect(assistantToolCall).toBeDefined()
    expect(assistantToolCall!.tool_calls).toHaveLength(1)
    expect(assistantToolCall!.tool_calls![0]).toEqual({
      id: 'call_abc',
      type: 'function',
      function: { name: 'search_calls', arguments: '{"query":"green"}' },
    })
    // Per the OpenAI-shape contract for assistant tool_call messages, content is empty.
    expect(assistantToolCall!.content).toBe('')

    // The tool message must carry tool_call_id — this is the bug-fix proof.
    const toolMessage = messages.find((m) => m.role === 'tool')
    expect(toolMessage).toBeDefined()
    expect(toolMessage!.tool_call_id).toBe('call_abc')
    // tool_call_id must NOT be empty string (the old bug).
    expect(toolMessage!.tool_call_id).not.toBe('')
  })

  it('throws on a tool history row missing toolCallId (corrupt data — fail loud)', async () => {
    loadContextMock.mockResolvedValue({
      messages: [
        { role: 'user', content: 'hi' },
        // Corrupt tool row — no toolCallId. We'd rather fail loud than send garbage upstream.
        { role: 'tool', content: JSON.stringify({ success: true }), toolName: 'search_calls' },
      ],
      summary: null,
      totalCount: 2,
    })

    await expect(
      runAgentTurn({
        session: makeSession({ stateVersion: 1 }),
        sections: [],
        request: { message: 'continue', requestId: 'req-corrupt', locale: 'ro' },
        emit,
        turnId: 'tu-corrupt',
      }),
    ).rejects.toThrow(/toolCallId|tool_call_id/i)
  })

  it('passes through plain assistant text history rows unchanged', async () => {
    loadContextMock.mockResolvedValue({
      messages: [
        { role: 'user', content: 'previous question' },
        { role: 'assistant', content: 'previous answer' },
      ],
      summary: null,
      totalCount: 2,
    })

    await runAgentTurn({
      session: makeSession({ stateVersion: 1 }),
      sections: [],
      request: { message: 'follow-up', requestId: 'req-text', locale: 'ro' },
      emit,
      turnId: 'tu-text',
    })

    const passedReq = generateMock.mock.calls[0][0] as { messages: Array<{
      role: string
      content: string
      tool_calls?: unknown
    }> }
    const assistantText = passedReq.messages.find(
      (m) => m.role === 'assistant' && m.content === 'previous answer',
    )
    expect(assistantText).toBeDefined()
    // Plain text assistant must not carry tool_calls.
    expect(assistantText!.tool_calls).toBeUndefined()
  })
})

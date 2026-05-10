// app/tests/unit/agent-runtime-history-replay-parallel.test.ts
//
// Regression test for V3 history replay semantic shift on parallel tool_calls
// (GH Issue #82, P1).
//
// PR #80 made replay carry tool_call_id and reconstruct assistant.tool_calls
// per row, but each row still produced its own assistant message. So a single
// LLM turn that emitted N parallel tool_calls — persisted as N consecutive
// (tool_call, tool_result) row pairs — replays as N alternating singletons,
// not as one assistant{tool_calls[N]} followed by N tool results. Anthropic
// native flushes tool_result groups as user messages, so the singleton
// pattern looks like N sequential turns to the model. Conversation semantics
// silently shift on the 2nd+ turn of any session that ran parallel tools.
//
// Fix: write-side stamps a per-LLM-response groupId in the tool_call row's
// content; replay batches consecutive same-groupId tool_call rows into one
// assistant message with tool_calls[N], then collects their tool_results.
// Rows without groupId (legacy / pre-fix data) keep singleton replay.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { generateMock, loadContextMock, appendMessageMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
  loadContextMock: vi.fn(),
  appendMessageMock: vi.fn().mockResolvedValue(0),
}))

vi.mock('@/lib/ai/agent/history', () => ({
  loadContext: loadContextMock,
  appendMessage: appendMessageMock,
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

type CapturedMessage = {
  role: string
  content: string
  tool_call_id?: string
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
}

describe('V3 runtime — parallel tool_calls history replay (Issue #82)', () => {
  let events: AgentEvent[]
  const emit = (e: AgentEvent) => events.push(e)

  beforeEach(() => {
    events = []
    vi.clearAllMocks()
    appendMessageMock.mockResolvedValue(0)
    // Provider returns plain text — no tool calls — so the loop exits after one pass.
    generateMock.mockResolvedValue({
      content: 'Got it.',
      tokensUsed: { input: 10, output: 5 },
      model: 'claude-opus-4-6',
      provider: 'anthropic',
      toolCalls: [],
    })
  })

  it('batches same-groupId tool_call rows into one assistant message with tool_calls[N]', async () => {
    // Simulate a previous turn with TWO parallel tool_calls in a single LLM
    // response. The write-side stamps the same groupId on both tool_call rows;
    // the rows are persisted in interleaved (call_a, result_a, call_b, result_b)
    // order — that is exactly how runtime.ts currently writes them today.
    loadContextMock.mockResolvedValue({
      messages: [
        { role: 'user', content: 'do parallel things' },
        {
          role: 'assistant',
          content: JSON.stringify({
            name: 'tool_a',
            arguments: '{"x":1}',
            groupId: 'g1',
          }),
          toolCallId: 'call_a',
          toolName: 'tool_a',
        },
        {
          role: 'tool',
          content: JSON.stringify({ success: true, data: { ok: 'a' } }),
          toolCallId: 'call_a',
          toolName: 'tool_a',
        },
        {
          role: 'assistant',
          content: JSON.stringify({
            name: 'tool_b',
            arguments: '{"y":2}',
            groupId: 'g1',
          }),
          toolCallId: 'call_b',
          toolName: 'tool_b',
        },
        {
          role: 'tool',
          content: JSON.stringify({ success: true, data: { ok: 'b' } }),
          toolCallId: 'call_b',
          toolName: 'tool_b',
        },
      ],
      summary: null,
      totalCount: 5,
    })

    await runAgentTurn({
      session: makeSession({ stateVersion: 1 }),
      sections: [],
      request: { message: 'follow-up', requestId: 'req-parallel', locale: 'ro' },
      emit,
      turnId: 'tu-parallel',
    })

    expect(generateMock).toHaveBeenCalledTimes(1)
    const messages = (generateMock.mock.calls[0][0] as { messages: CapturedMessage[] }).messages

    // There must be exactly ONE assistant message that carries tool_calls[],
    // and it must contain both tool calls (call_a and call_b) in order.
    const assistantToolMessages = messages.filter(
      (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
    )
    expect(assistantToolMessages).toHaveLength(1)
    const assistantToolCalls = assistantToolMessages[0].tool_calls!
    expect(assistantToolCalls).toHaveLength(2)
    expect(assistantToolCalls.map((tc) => tc.id)).toEqual(['call_a', 'call_b'])
    expect(assistantToolCalls[0].function).toEqual({ name: 'tool_a', arguments: '{"x":1}' })
    expect(assistantToolCalls[1].function).toEqual({ name: 'tool_b', arguments: '{"y":2}' })

    // Two tool messages, in tool_call order, immediately after the assistant.
    const toolMessages = messages.filter((m) => m.role === 'tool')
    expect(toolMessages).toHaveLength(2)
    expect(toolMessages.map((m) => m.tool_call_id)).toEqual(['call_a', 'call_b'])

    // Critical ordering invariant: tool messages must follow the SINGLE
    // assistant tool-call message contiguously — no second assistant message
    // between them. That second assistant was the bug.
    const assistantIdx = messages.findIndex(
      (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
    )
    expect(messages[assistantIdx + 1].role).toBe('tool')
    expect(messages[assistantIdx + 2].role).toBe('tool')
  })

  it('keeps legacy rows without groupId as singleton assistant messages (backward compat)', async () => {
    // Pre-fix sessions persisted tool_call rows without groupId. Replay must
    // still produce valid OpenAI/Anthropic protocol shape — even if it can't
    // recover the original parallel grouping. Singleton-per-row is the only
    // correct fallback when grouping intent is lost.
    loadContextMock.mockResolvedValue({
      messages: [
        { role: 'user', content: 'old session' },
        {
          role: 'assistant',
          content: JSON.stringify({ name: 'tool_a', arguments: '{}' }),
          toolCallId: 'call_a',
          toolName: 'tool_a',
        },
        {
          role: 'tool',
          content: JSON.stringify({ success: true }),
          toolCallId: 'call_a',
          toolName: 'tool_a',
        },
        {
          role: 'assistant',
          content: JSON.stringify({ name: 'tool_b', arguments: '{}' }),
          toolCallId: 'call_b',
          toolName: 'tool_b',
        },
        {
          role: 'tool',
          content: JSON.stringify({ success: true }),
          toolCallId: 'call_b',
          toolName: 'tool_b',
        },
      ],
      summary: null,
      totalCount: 5,
    })

    await runAgentTurn({
      session: makeSession({ stateVersion: 1 }),
      sections: [],
      request: { message: 'follow-up', requestId: 'req-legacy', locale: 'ro' },
      emit,
      turnId: 'tu-legacy',
    })

    const messages = (generateMock.mock.calls[0][0] as { messages: CapturedMessage[] }).messages

    const assistantToolMessages = messages.filter(
      (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
    )
    // Two singleton assistant messages — one per call. This preserves
    // legacy replay shape; we cannot synthesize the lost grouping.
    expect(assistantToolMessages).toHaveLength(2)
    expect(assistantToolMessages[0].tool_calls).toHaveLength(1)
    expect(assistantToolMessages[1].tool_calls).toHaveLength(1)
    expect(assistantToolMessages[0].tool_calls![0].id).toBe('call_a')
    expect(assistantToolMessages[1].tool_calls![0].id).toBe('call_b')
  })

  it('does not batch tool_calls from different groupIds (sequential turns stay separate)', async () => {
    // Two separate LLM responses, each with one tool_call, get distinct
    // groupIds. Replay must NOT collapse them into one assistant message.
    loadContextMock.mockResolvedValue({
      messages: [
        { role: 'user', content: 'first' },
        {
          role: 'assistant',
          content: JSON.stringify({ name: 'tool_a', arguments: '{}', groupId: 'g1' }),
          toolCallId: 'call_a',
          toolName: 'tool_a',
        },
        {
          role: 'tool',
          content: JSON.stringify({ success: true }),
          toolCallId: 'call_a',
          toolName: 'tool_a',
        },
        { role: 'user', content: 'second' },
        {
          role: 'assistant',
          content: JSON.stringify({ name: 'tool_b', arguments: '{}', groupId: 'g2' }),
          toolCallId: 'call_b',
          toolName: 'tool_b',
        },
        {
          role: 'tool',
          content: JSON.stringify({ success: true }),
          toolCallId: 'call_b',
          toolName: 'tool_b',
        },
      ],
      summary: null,
      totalCount: 6,
    })

    await runAgentTurn({
      session: makeSession({ stateVersion: 1 }),
      sections: [],
      request: { message: 'follow-up', requestId: 'req-sequential', locale: 'ro' },
      emit,
      turnId: 'tu-sequential',
    })

    const messages = (generateMock.mock.calls[0][0] as { messages: CapturedMessage[] }).messages

    const assistantToolMessages = messages.filter(
      (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
    )
    expect(assistantToolMessages).toHaveLength(2)
    expect(assistantToolMessages[0].tool_calls![0].id).toBe('call_a')
    expect(assistantToolMessages[1].tool_calls![0].id).toBe('call_b')
  })

  it('write-side stamps the same groupId on all tool_call rows from one LLM response', async () => {
    // Provider returns two parallel tool_calls on the first iteration, then
    // a plain-text response on the second iteration to terminate the loop.
    generateMock
      .mockResolvedValueOnce({
        content: '',
        tokensUsed: { input: 10, output: 5 },
        model: 'claude-opus-4-6',
        provider: 'anthropic',
        toolCalls: [
          { id: 'call_p1', name: 'search_calls', arguments: '{"query":"a"}' },
          { id: 'call_p2', name: 'search_calls', arguments: '{"query":"b"}' },
        ],
      })
      .mockResolvedValueOnce({
        content: 'done',
        tokensUsed: { input: 10, output: 5 },
        model: 'claude-opus-4-6',
        provider: 'anthropic',
        toolCalls: [],
      })

    loadContextMock.mockResolvedValue({ messages: [], summary: null, totalCount: 0 })

    await runAgentTurn({
      session: makeSession({ stateVersion: 1, currentPhase: 'discovery' }),
      sections: [],
      request: { message: 'find things', requestId: 'req-write', locale: 'ro' },
      emit,
      turnId: 'tu-write',
    })

    // Collect tool_call rows that were appended by the runtime.
    const toolCallAppends = appendMessageMock.mock.calls
      .map((c) => c[1] as { messageType: string; content: unknown; toolCallId?: string })
      .filter((m) => m.messageType === 'tool_call')

    expect(toolCallAppends).toHaveLength(2)
    const groupIds = toolCallAppends.map((m) => {
      const c = m.content as { groupId?: string }
      return c?.groupId
    })
    // Both rows must carry a groupId.
    expect(groupIds[0]).toBeDefined()
    expect(groupIds[1]).toBeDefined()
    expect(typeof groupIds[0]).toBe('string')
    // Same groupId across both rows from the same LLM response.
    expect(groupIds[0]).toBe(groupIds[1])
  })
})

// app/tests/unit/agent-runtime-history-replay-polish.test.ts
//
// Polish covering Issue #83 (P2 cluster):
//   1. runtime throws on malformed tool_call content (no silent fallback)
//   4. corrupt-row throws fire Sentry.captureException + logAudit
//   5. messageType is surfaced from loadContext and authoritative over inference
//      (drift safety: a row with toolCallId set but messageType='text' must NOT
//       be replayed as a tool_call)
//
// Items 2 and 3 (SSE error dedup + bilingual error envelope) live in route-level
// tests under tests/integration/, not here.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { generateMock, loadContextMock, captureExceptionMock, logAuditMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
  loadContextMock: vi.fn(),
  captureExceptionMock: vi.fn().mockResolvedValue(undefined),
  logAuditMock: vi.fn().mockResolvedValue(undefined),
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

// Item 4: capture observability calls.
vi.mock('@/lib/monitoring/sentry', () => ({
  captureException: captureExceptionMock,
}))

vi.mock('@/lib/legal/audit', () => ({
  logAudit: logAuditMock,
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

describe('V3 runtime — history replay polish (Issue #83)', () => {
  let events: AgentEvent[]
  const emit = (e: AgentEvent) => events.push(e)

  beforeEach(() => {
    events = []
    vi.clearAllMocks()
    captureExceptionMock.mockClear()
    logAuditMock.mockClear().mockResolvedValue(undefined)
    generateMock.mockResolvedValue({
      content: 'Got it.',
      tokensUsed: { input: 10, output: 5 },
      model: 'claude-opus-4-6',
      provider: 'anthropic',
      toolCalls: [],
    })
  })

  describe('item 5: messageType is authoritative over role+toolCallId inference', () => {
    it('treats messageType=text as plain text even when toolCallId is set (drift safety)', async () => {
      // Drift case: a row that somehow ended up with toolCallId populated but
      // messageType is 'text'. Inference would mis-classify as tool_call and
      // crash JSON.parse. messageType-based dispatch must treat it as text.
      loadContextMock.mockResolvedValue({
        messages: [
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            messageType: 'text',
            content: 'Just plain text here.',
            // Drift: these fields leaked in but the row is text.
            toolCallId: 'leftover_id',
            toolName: 'leftover_name',
          },
        ],
        summary: null,
        totalCount: 2,
      })

      await runAgentTurn({
        session: makeSession({ stateVersion: 1 }),
        sections: [],
        request: { message: 'continue', requestId: 'req-drift', locale: 'ro' },
        emit,
        turnId: 'tu-drift',
      })

      const messages = (generateMock.mock.calls[0][0] as { messages: CapturedMessage[] }).messages
      // The drifted row must NOT appear as an assistant tool_call message.
      const driftedRowAsToolCall = messages.find(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.tool_calls) &&
          m.tool_calls.some((tc) => tc.id === 'leftover_id'),
      )
      expect(driftedRowAsToolCall).toBeUndefined()
      // It MUST appear as a plain assistant text message.
      const driftedRowAsText = messages.find(
        (m) => m.role === 'assistant' && m.content === 'Just plain text here.',
      )
      expect(driftedRowAsText).toBeDefined()
      expect(driftedRowAsText!.tool_calls).toBeUndefined()
    })

    it('treats messageType=tool_call as tool_call (happy path)', async () => {
      loadContextMock.mockResolvedValue({
        messages: [
          { role: 'user', content: 'q' },
          {
            role: 'assistant',
            messageType: 'tool_call',
            content: JSON.stringify({ name: 'search_calls', arguments: '{"query":"x"}' }),
            toolCallId: 'call_x',
            toolName: 'search_calls',
          },
          {
            role: 'tool',
            messageType: 'tool_result',
            content: JSON.stringify({ success: true }),
            toolCallId: 'call_x',
            toolName: 'search_calls',
          },
        ],
        summary: null,
        totalCount: 3,
      })

      await runAgentTurn({
        session: makeSession({ stateVersion: 1 }),
        sections: [],
        request: { message: 'continue', requestId: 'req-happy', locale: 'ro' },
        emit,
        turnId: 'tu-happy',
      })

      const messages = (generateMock.mock.calls[0][0] as { messages: CapturedMessage[] }).messages
      const assistantToolCall = messages.find(
        (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
      )
      expect(assistantToolCall).toBeDefined()
      expect(assistantToolCall!.tool_calls![0].id).toBe('call_x')
    })
  })

  describe('item 1: strict validation — throw on malformed tool_call content', () => {
    it('throws when content is missing the "name" field', async () => {
      loadContextMock.mockResolvedValue({
        messages: [
          { role: 'user', content: 'q' },
          {
            role: 'assistant',
            messageType: 'tool_call',
            // Missing 'name' on purpose. Today this silently falls back to
            // msg.toolName; spec says we should throw — corrupt write-side.
            content: JSON.stringify({ arguments: '{}' }),
            toolCallId: 'call_a',
            toolName: 'old_name',
          },
        ],
        summary: null,
        totalCount: 2,
      })

      await expect(
        runAgentTurn({
          session: makeSession({ stateVersion: 1 }),
          sections: [],
          request: { message: 'continue', requestId: 'req-noname', locale: 'ro' },
          emit,
          turnId: 'tu-noname',
        }),
      ).rejects.toThrow(/malformed|name/i)
    })

    it('throws when content is missing the "arguments" field', async () => {
      loadContextMock.mockResolvedValue({
        messages: [
          { role: 'user', content: 'q' },
          {
            role: 'assistant',
            messageType: 'tool_call',
            // Missing 'arguments'. Silent '{}' fallback isn't acceptable —
            // upstream models could re-execute against a wrong arg shape.
            content: JSON.stringify({ name: 'search_calls' }),
            toolCallId: 'call_b',
            toolName: 'search_calls',
          },
        ],
        summary: null,
        totalCount: 2,
      })

      await expect(
        runAgentTurn({
          session: makeSession({ stateVersion: 1 }),
          sections: [],
          request: { message: 'continue', requestId: 'req-noargs', locale: 'ro' },
          emit,
          turnId: 'tu-noargs',
        }),
      ).rejects.toThrow(/malformed|arguments/i)
    })
  })

  describe('item 2: runtime does not emit SSE error events — route owns the envelope', () => {
    it('does NOT emit an error event when replay throws on a corrupt row', async () => {
      // The runtime used to both emit({type:'error',...}) AND re-throw, so
      // the route's outer catch produced a SECOND error SSE event. Spec: pick
      // one. Route owns the SSE stream → runtime must not double-emit.
      loadContextMock.mockResolvedValue({
        messages: [
          { role: 'user', content: 'q' },
          // Corrupt tool row triggers HistoryIntegrityError.
          { role: 'tool', messageType: 'tool_result', content: '{}' },
        ],
        summary: null,
        totalCount: 2,
      })

      await expect(
        runAgentTurn({
          session: makeSession({ stateVersion: 1 }),
          sections: [],
          request: { message: 'continue', requestId: 'req-noemit', locale: 'ro' },
          emit,
          turnId: 'tu-noemit',
        }),
      ).rejects.toThrow()

      const errorEvents = events.filter((e) => e.type === 'error')
      expect(errorEvents).toHaveLength(0)
    })
  })

  describe('item 1b (review follow-up): orphan tool_call with no matching tool_result', () => {
    it('throws HistoryIntegrityError with reason=missing_tool_result when a tool_call has no result row', async () => {
      // The write path persists (tool_call, tool_result) as two separate
      // appendMessage awaits. If the second await fails, the row pair leaves
      // a tool_call with no result. On replay, the loop emits assistant{tool_calls:[X]}
      // followed by a non-tool message — that's invalid OpenAI/Anthropic
      // protocol AND it bypasses the integrity classification (the upstream
      // 400 just looks like a generic error). Detect the orphan locally and
      // route it through the same observability as other corrupt-row throws.
      loadContextMock.mockResolvedValue({
        messages: [
          { role: 'user', content: 'do parallel things' },
          {
            role: 'assistant',
            messageType: 'tool_call',
            content: JSON.stringify({ name: 'tool_a', arguments: '{}', groupId: 'g1' }),
            toolCallId: 'call_a',
            toolName: 'tool_a',
          },
          {
            role: 'tool',
            messageType: 'tool_result',
            content: JSON.stringify({ success: true }),
            toolCallId: 'call_a',
            toolName: 'tool_a',
          },
          {
            role: 'assistant',
            messageType: 'tool_call',
            content: JSON.stringify({ name: 'tool_b', arguments: '{}', groupId: 'g1' }),
            toolCallId: 'call_b',
            toolName: 'tool_b',
          },
          // Missing: tool_result for call_b. Simulates a write failure
          // between the two appendMessage awaits in the write path.
          { role: 'user', content: 'next message' },
        ],
        summary: null,
        totalCount: 5,
      })

      await expect(
        runAgentTurn({
          session: makeSession({ stateVersion: 1 }),
          sections: [],
          request: { message: 'continue', requestId: 'req-orphan', locale: 'ro' },
          emit,
          turnId: 'tu-orphan',
        }),
      ).rejects.toThrow(/missing.*result|tool_result|missing_tool_result/i)

      expect(captureExceptionMock).toHaveBeenCalledTimes(1)
      expect(logAuditMock).toHaveBeenCalledTimes(1)
      const auditCall = logAuditMock.mock.calls[0][0] as {
        action: string
        metadata?: { reason?: string; toolCallId?: string }
      }
      expect(auditCall.action).toBe('agent.history.integrity_violation')
      expect(auditCall.metadata?.reason).toBe('missing_tool_result')
      expect(auditCall.metadata?.toolCallId).toBe('call_b')
    })

    it('throws missing_tool_result for a singleton tool_call with no result (legacy / non-grouped)', async () => {
      // Legacy rows (no groupId) also need the orphan check. The replay loop
      // treats them as singletons today, and a singleton with no following
      // tool_result is just as broken — same audit reason.
      loadContextMock.mockResolvedValue({
        messages: [
          { role: 'user', content: 'q' },
          {
            role: 'assistant',
            messageType: 'tool_call',
            // No groupId — legacy shape.
            content: JSON.stringify({ name: 'tool_a', arguments: '{}' }),
            toolCallId: 'call_lonely',
            toolName: 'tool_a',
          },
          // No tool_result row. Next is a user message — invalid protocol.
          { role: 'user', content: 'follow-up' },
        ],
        summary: null,
        totalCount: 3,
      })

      await expect(
        runAgentTurn({
          session: makeSession({ stateVersion: 1 }),
          sections: [],
          request: { message: 'continue', requestId: 'req-orphan-legacy', locale: 'ro' },
          emit,
          turnId: 'tu-orphan-legacy',
        }),
      ).rejects.toThrow()

      const auditCall = logAuditMock.mock.calls[0][0] as {
        action: string
        metadata?: { reason?: string; toolCallId?: string }
      }
      expect(auditCall.metadata?.reason).toBe('missing_tool_result')
      expect(auditCall.metadata?.toolCallId).toBe('call_lonely')
    })
  })

  describe('item 4: Sentry + audit observability on corrupt-row throws', () => {
    it('fires captureException and logAudit before throwing on malformed tool_call', async () => {
      loadContextMock.mockResolvedValue({
        messages: [
          { role: 'user', content: 'q' },
          {
            role: 'assistant',
            messageType: 'tool_call',
            content: JSON.stringify({ name: 'tool_a' }), // missing arguments
            toolCallId: 'call_obs',
            toolName: 'tool_a',
          },
        ],
        summary: null,
        totalCount: 2,
      })

      await expect(
        runAgentTurn({
          session: makeSession({ stateVersion: 1 }),
          sections: [],
          request: { message: 'continue', requestId: 'req-obs', locale: 'ro' },
          emit,
          turnId: 'tu-obs',
        }),
      ).rejects.toThrow()

      expect(captureExceptionMock).toHaveBeenCalledTimes(1)
      expect(logAuditMock).toHaveBeenCalledTimes(1)
      const auditCall = logAuditMock.mock.calls[0][0] as { action: string; userId: string }
      expect(auditCall.action).toBe('agent.history.integrity_violation')
      expect(auditCall.userId).toBe('22222222-2222-4222-8222-222222222222')
    })

    it('fires captureException and logAudit before throwing on tool row missing toolCallId', async () => {
      loadContextMock.mockResolvedValue({
        messages: [
          { role: 'user', content: 'q' },
          // tool row with no toolCallId — corrupt write
          { role: 'tool', messageType: 'tool_result', content: JSON.stringify({ success: true }) },
        ],
        summary: null,
        totalCount: 2,
      })

      await expect(
        runAgentTurn({
          session: makeSession({ stateVersion: 1 }),
          sections: [],
          request: { message: 'continue', requestId: 'req-toolnoid', locale: 'ro' },
          emit,
          turnId: 'tu-toolnoid',
        }),
      ).rejects.toThrow()

      expect(captureExceptionMock).toHaveBeenCalledTimes(1)
      expect(logAuditMock).toHaveBeenCalledTimes(1)
      const auditCall = logAuditMock.mock.calls[0][0] as { action: string }
      expect(auditCall.action).toBe('agent.history.integrity_violation')
    })
  })
})

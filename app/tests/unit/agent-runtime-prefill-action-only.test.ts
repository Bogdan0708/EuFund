// app/tests/unit/agent-runtime-prefill-action-only.test.ts
//
// Regression for the Anthropic prefill 400 on action-only turns.
//
// The bug: when a V3 turn arrived with `action` set but `message` empty, the
// runtime called `loadContext` BEFORE persisting the structured_action row
// (runtime.ts:117 vs :130), then built `llmMessages` from history + an
// optional `request.message` user push (line 290). With no message, the
// llmMessages array ended on the prior turn's assistant text and Anthropic
// rejected with:
//   400 This model does not support assistant message prefill.
//   The conversation must end with a user message.
//
// The fix appends a synthetic user message carrying JSON.stringify(action)
// so the conversation ends on a user role. The shape mirrors what
// loadContext emits for persisted structured_action rows on later turns
// (history.ts:144-148), keeping replay behavior consistent.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { generateMock, loadContextMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
  loadContextMock: vi.fn(),
}))

vi.mock('@/lib/ai/agent/history', () => ({
  loadContext: loadContextMock,
  appendMessage: vi.fn().mockResolvedValue(0),
  compactIfNeeded: vi.fn().mockResolvedValue({ compacted: false }),
  ensureV3PairingInvariant: (m: unknown[]) => m,
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

vi.mock('@/lib/projects/promotion', () => ({
  ensureProjectForSession: vi.fn().mockResolvedValue({ promoted: false }),
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
    currentPhase: 'research',
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

describe('V3 runtime — action-only turns avoid prefill 400', () => {
  let events: AgentEvent[]
  const emit = (e: AgentEvent) => events.push(e)
  // The runtime mutates the llmMessages array AFTER generate() returns
  // (pushing the assistant response back in for the next tool-loop iteration).
  // Capture a deep snapshot of the messages array at call time so assertions
  // see what Anthropic actually received, not the mutated tail.
  let messagesAtCallTime: Array<{ role: string; content: string }>[] = []

  beforeEach(() => {
    events = []
    messagesAtCallTime = []
    vi.clearAllMocks()
    // Provider returns plain text — no tool calls — so the loop exits on iter 1.
    generateMock.mockImplementation((req: { messages: Array<{ role: string; content: string }> }) => {
      messagesAtCallTime.push(req.messages.map(m => ({ ...m })))
      return Promise.resolve({
        content: 'ok',
        tokensUsed: { input: 10, output: 5 },
        model: 'claude-opus-4-6',
        provider: 'anthropic',
        toolCalls: [],
      })
    })
  })

  it('appends action as a user message when request.message is empty (request_refresh)', async () => {
    // History ends with assistant text — the prior turn's reply. This is the
    // exact shape that used to trigger Anthropic's prefill 400 on the next
    // action-only turn.
    loadContextMock.mockResolvedValue({
      messages: [
        { role: 'user', content: 'help me find a call' },
        { role: 'assistant', content: 'Here is what I found...' },
      ],
      summary: null,
      totalCount: 2,
    })

    await runAgentTurn({
      session: makeSession(),
      sections: [],
      request: {
        requestId: 'req-1',
        locale: 'ro',
        action: { type: 'request_refresh' },
      },
      emit,
      turnId: 'turn-1',
    })

    expect(generateMock).toHaveBeenCalled()
    const snapshot = messagesAtCallTime[0]
    const lastMsg = snapshot[snapshot.length - 1]
    expect(lastMsg.role).toBe('user')
    expect(lastMsg.content).toBe(JSON.stringify({ type: 'request_refresh' }))
  })

  it('appends action as user message for select_call (skipLLM:false path)', async () => {
    loadContextMock.mockResolvedValue({
      messages: [
        { role: 'user', content: 'help me' },
        { role: 'assistant', content: 'Sure — what kind of project?' },
      ],
      summary: null,
      totalCount: 2,
    })

    await runAgentTurn({
      session: makeSession(),
      sections: [],
      request: {
        requestId: 'req-2',
        locale: 'ro',
        action: { type: 'select_call', callId: 'c1971c50' },
      },
      emit,
      turnId: 'turn-2',
    })

    const snapshot = messagesAtCallTime[0]
    const lastMsg = snapshot[snapshot.length - 1]
    expect(lastMsg.role).toBe('user')
    expect(JSON.parse(lastMsg.content)).toEqual({
      type: 'select_call',
      callId: 'c1971c50',
    })
  })

  it('prefers request.message over action when both are present', async () => {
    loadContextMock.mockResolvedValue({
      messages: [{ role: 'assistant', content: 'earlier reply' }],
      summary: null,
      totalCount: 1,
    })

    await runAgentTurn({
      session: makeSession(),
      sections: [],
      request: {
        requestId: 'req-3',
        locale: 'ro',
        message: 'hello again',
        action: { type: 'request_refresh' },
      },
      emit,
      turnId: 'turn-3',
    })

    const snapshot = messagesAtCallTime[0]
    const lastMsg = snapshot[snapshot.length - 1]
    expect(lastMsg.role).toBe('user')
    expect(lastMsg.content).toBe('hello again')
  })
})

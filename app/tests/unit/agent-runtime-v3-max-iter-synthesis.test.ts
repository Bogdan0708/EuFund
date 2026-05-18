// Regression: V3 used to return 200 with zero assistant text when the model
// spent all MAX_TOOL_ITERATIONS on tool calls. The 2026-05-12 09:35 prod
// incident captured this: 5 retrieve_call_evidence calls, no text, silent
// stream close. The runtime now forces a synthesis call (no tools) after
// the loop exits at the cap, and falls back to a localized cap message
// if that synthesis also fails or returns empty.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  ensureProjectForSessionMock,
  appendMessageMock,
  generateMock,
  getToolsForPhaseMock,
} = vi.hoisted(() => ({
  ensureProjectForSessionMock: vi.fn().mockResolvedValue({ promoted: true }),
  appendMessageMock: vi.fn().mockResolvedValue(0),
  generateMock: vi.fn(),
  getToolsForPhaseMock: vi.fn(),
}))

vi.mock('@/lib/projects/promotion', () => ({
  ensureProjectForSession: ensureProjectForSessionMock,
}))

vi.mock('@/lib/db', () => ({
  db: {
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined), returning: vi.fn().mockResolvedValue([]) }) }),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}))

vi.mock('@/lib/ai/agent/history', () => ({
  loadContext: vi.fn().mockResolvedValue({ messages: [], summary: null, totalCount: 0 }),
  appendMessage: appendMessageMock,
  compactIfNeeded: vi.fn().mockResolvedValue({ compacted: false }),
  // Identity passthrough — this test set never replays prior turns, so the
  // V3 history doesn't carry orphan tool_use blocks to repair. Each test
  // builds the assistant tool_call + tool_result pairing in-band via the
  // generateMock sequence.
  ensureV3PairingInvariant: (messages: unknown[]) => messages,
}))

vi.mock('@/lib/ai/agent/managed/history', () => ({
  markTurnCompleted: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ai/providers/router', () => ({
  generate: generateMock,
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

// Replace the real phase-tool registry with a single in-memory fake that
// succeeds quickly. The runtime imports tools/index for side-effect
// registration; mocking the registry module shortcuts all of that.
vi.mock('@/lib/ai/agent/tools/registry', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/agent/tools/registry')>('@/lib/ai/agent/tools/registry')
  return {
    ...actual,
    getToolsForPhase: getToolsForPhaseMock,
  }
})

vi.mock('@/lib/ai/agent/tools/index', () => ({}))

import { runAgentTurn } from '@/lib/ai/agent/runtime'
import type { AgentSession, AgentRequest, AgentEvent } from '@/lib/ai/agent/types'
import { z } from 'zod'

const USER_ID = '22222222-2222-4222-8222-222222222222'
const SESSION_ID = '11111111-1111-4111-8111-111111111111'

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: SESSION_ID,
    userId: USER_ID,
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
    ...overrides,
  }
}

function makeRequest(message: string): AgentRequest {
  return {
    sessionId: SESSION_ID,
    message,
    requestId: 'req-cap-1',
    locale: 'ro',
    stateVersion: 0,
  }
}

// In-memory fake tool: declares as `read` so it's always available;
// execute() returns success immediately with a small payload.
const fakeTool = {
  name: 'fake_search',
  category: 'read' as const,
  description: 'fake',
  inputSchema: z.object({ query: z.string().optional() }),
  execute: vi.fn().mockResolvedValue({
    success: true,
    data: { results: [{ id: '1', content: 'evidence' }] },
    telemetry: { latencyMs: 1 },
  }),
  timeout: 5_000,
}

beforeEach(() => {
  vi.clearAllMocks()
  // 5 tool-only iterations cap MAX_TOOL_ITERATIONS, then 1 synthesis text.
  generateMock.mockReset()
  for (let i = 0; i < 5; i++) {
    generateMock.mockResolvedValueOnce({
      content: '',
      tokensUsed: { input: 0, output: 0 },
      model: 'claude-opus-4-6',
      provider: 'anthropic',
      toolCalls: [{ id: `tc-${i}`, name: 'fake_search', arguments: '{"query":"q"}' }],
    })
  }
  getToolsForPhaseMock.mockReturnValue([fakeTool])
  appendMessageMock.mockResolvedValue(0)
})

describe('V3 runtime — cap path forces synthesis when no text was persisted', () => {
  it('after 5 tool-only iterations, makes a 6th synthesis call without tools and persists its text', async () => {
    // Forced synthesis call returns text:
    generateMock.mockResolvedValueOnce({
      content: 'Am explorat și iată ce am găsit: ...',
      tokensUsed: { input: 0, output: 0 },
      model: 'claude-opus-4-6',
      provider: 'anthropic',
    })

    const events: AgentEvent[] = []
    await runAgentTurn({
      session: makeSession(),
      sections: [],
      request: makeRequest('?'),
      emit: (e) => events.push(e),
      turnId: '44444444-4444-4444-8444-444444444444',
    })

    // 5 tool iterations + 1 synthesis = 6 total generate() calls
    expect(generateMock).toHaveBeenCalledTimes(6)

    // 6th call must omit `tools` (forced text)
    const synthesisCall = generateMock.mock.calls[5][0]
    expect(synthesisCall.tools).toBeUndefined()
    // System prompt carries the cap-hit instruction (mentions the iteration count)
    expect(synthesisCall.system).toMatch(/Response Required/i)
    expect(synthesisCall.system).toMatch(/tool-call iterations/i)

    // Final assistant text was persisted via appendMessage
    const assistantTextWrites = appendMessageMock.mock.calls.filter(
      (args) => args[1]?.role === 'assistant' && args[1]?.messageType === 'text',
    )
    expect(assistantTextWrites).toHaveLength(1)
    expect(assistantTextWrites[0][1].content).toBe('Am explorat și iată ce am găsit: ...')

    // text_delta was emitted before done
    const textDeltas = events.filter(e => e.type === 'text_delta') as Extract<AgentEvent, { type: 'text_delta' }>[]
    expect(textDeltas.length).toBeGreaterThanOrEqual(1)
    expect(textDeltas[textDeltas.length - 1].content).toBe('Am explorat și iată ce am găsit: ...')

    // `done` event fires last
    const done = events[events.length - 1]
    expect(done.type).toBe('done')
  })

  it('falls back to a localized cap message when synthesis call returns empty', async () => {
    generateMock.mockResolvedValueOnce({
      content: '',
      tokensUsed: { input: 0, output: 0 },
      model: 'claude-opus-4-6',
      provider: 'anthropic',
    })

    const events: AgentEvent[] = []
    await runAgentTurn({
      session: makeSession({ locale: 'ro' }),
      sections: [],
      request: makeRequest('?'),
      emit: (e) => events.push(e),
      turnId: '55555555-5555-4555-8555-555555555555',
    })

    const writes = appendMessageMock.mock.calls.filter(
      (args) => args[1]?.role === 'assistant' && args[1]?.messageType === 'text',
    )
    expect(writes).toHaveLength(1)
    expect(writes[0][1].content).toMatch(/limita pașilor de explorare/i)
  })

  it('falls back to the English cap message when synthesis call throws and locale=en', async () => {
    generateMock.mockRejectedValueOnce(new Error('upstream timeout'))

    const events: AgentEvent[] = []
    await runAgentTurn({
      session: makeSession({ locale: 'en' }),
      sections: [],
      request: makeRequest('?'),
      emit: (e) => events.push(e),
      turnId: '66666666-6666-4666-8666-666666666666',
    })

    const writes = appendMessageMock.mock.calls.filter(
      (args) => args[1]?.role === 'assistant' && args[1]?.messageType === 'text',
    )
    expect(writes).toHaveLength(1)
    expect(writes[0][1].content).toMatch(/reached the tool-call limit/i)
  })

  it('forces synthesis when the model exits early with empty content and no tool calls', async () => {
    // User report 2026-05-12: "doar a facut tool call dar nici un raspuns" —
    // the model returned an empty assistant turn (no text, no tools) after a
    // single tool round. The cap was never hit, so the original synthesis
    // gate (`iteration >= MAX`) did not fire and the SSE closed silently.
    generateMock.mockReset()
    // Iteration 1: a tool call, no text
    generateMock.mockResolvedValueOnce({
      content: '',
      tokensUsed: { input: 0, output: 0 },
      model: 'claude-opus-4-6',
      provider: 'anthropic',
      toolCalls: [{ id: 'tc-0', name: 'fake_search', arguments: '{"query":"q"}' }],
    })
    // Iteration 2: model goes empty — no text, no tools. Without the fix the
    // loop breaks here and the turn ends with no assistant text persisted.
    generateMock.mockResolvedValueOnce({
      content: '',
      tokensUsed: { input: 0, output: 0 },
      model: 'claude-opus-4-6',
      provider: 'anthropic',
    })
    // Synthesis call — returns real text.
    generateMock.mockResolvedValueOnce({
      content: 'Iată ce am găsit cu fake_search.',
      tokensUsed: { input: 0, output: 0 },
      model: 'claude-opus-4-6',
      provider: 'anthropic',
    })

    const events: AgentEvent[] = []
    await runAgentTurn({
      session: makeSession(),
      sections: [],
      request: makeRequest('?'),
      emit: (e) => events.push(e),
      turnId: '88888888-8888-4888-8888-888888888888',
    })

    // Iterations 1+2 ran, then synthesis = 3 generate() calls
    expect(generateMock).toHaveBeenCalledTimes(3)
    const synthesisCall = generateMock.mock.calls[2][0]
    expect(synthesisCall.tools).toBeUndefined()
    expect(synthesisCall.system).toMatch(/Response Required/i)
    // The cap-specific phrasing should NOT appear when we exited early
    expect(synthesisCall.system).not.toMatch(/tool-call iterations/i)
    expect(synthesisCall.system).toMatch(/stopped before responding/i)

    const writes = appendMessageMock.mock.calls.filter(
      (args) => args[1]?.role === 'assistant' && args[1]?.messageType === 'text',
    )
    expect(writes).toHaveLength(1)
    expect(writes[0][1].content).toBe('Iată ce am găsit cu fake_search.')
  })

  it('falls back to early-exit message (NOT the cap-limit copy) when synthesis returns empty after early exit', async () => {
    generateMock.mockReset()
    // One tool round, then empty assistant — same shape as above.
    generateMock.mockResolvedValueOnce({
      content: '',
      tokensUsed: { input: 0, output: 0 },
      model: 'claude-opus-4-6',
      provider: 'anthropic',
      toolCalls: [{ id: 'tc-0', name: 'fake_search', arguments: '{"query":"q"}' }],
    })
    generateMock.mockResolvedValueOnce({
      content: '',
      tokensUsed: { input: 0, output: 0 },
      model: 'claude-opus-4-6',
      provider: 'anthropic',
    })
    // Synthesis also returns empty — fallback should fire.
    generateMock.mockResolvedValueOnce({
      content: '',
      tokensUsed: { input: 0, output: 0 },
      model: 'claude-opus-4-6',
      provider: 'anthropic',
    })

    const events: AgentEvent[] = []
    await runAgentTurn({
      session: makeSession({ locale: 'en' }),
      sections: [],
      request: makeRequest('?'),
      emit: (e) => events.push(e),
      turnId: '99999999-9999-4999-8999-999999999999',
    })

    const writes = appendMessageMock.mock.calls.filter(
      (args) => args[1]?.role === 'assistant' && args[1]?.messageType === 'text',
    )
    expect(writes).toHaveLength(1)
    // Should be the early-exit fallback, not the cap-limit fallback
    expect(writes[0][1].content).not.toMatch(/reached the tool-call limit/i)
    expect(writes[0][1].content).toMatch(/couldn't generate a response/i)
  })

  it('appends a synthetic tool_result for unknown tool calls so synthesis can ship a balanced message list', async () => {
    // Code review finding 2026-05-12: when the model called a tool name not
    // in phaseTools, the runtime `continue`d without adding a tool_result —
    // but the assistant tool_use was already pushed to llmMessages. The
    // forced synthesis call then sent an unbalanced assistant message and
    // Anthropic 400'd ("tool_use blocks must be followed by tool_result").
    generateMock.mockReset()
    // Iteration 1: model invokes a tool that isn't registered for this phase
    generateMock.mockResolvedValueOnce({
      content: '',
      tokensUsed: { input: 0, output: 0 },
      model: 'claude-opus-4-6',
      provider: 'anthropic',
      toolCalls: [{ id: 'tc-unknown', name: 'nonexistent_tool', arguments: '{}' }],
    })
    // Synthesis call returns text
    generateMock.mockResolvedValueOnce({
      content: 'Sorry, that tool is not available right now.',
      tokensUsed: { input: 0, output: 0 },
      model: 'claude-opus-4-6',
      provider: 'anthropic',
    })

    const events: AgentEvent[] = []
    await runAgentTurn({
      session: makeSession(),
      sections: [],
      request: makeRequest('?'),
      emit: (e) => events.push(e),
      turnId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })

    // 1 iteration + 1 synthesis = 2 generate calls
    expect(generateMock).toHaveBeenCalledTimes(2)
    const synthesisCall = generateMock.mock.calls[1][0]

    // The messages payload must contain a tool_result for the unknown tool_call
    // (otherwise Anthropic rejects the assistant tool_use dangling alone).
    const toolResults = synthesisCall.messages.filter((m: { role: string; tool_call_id?: string }) =>
      m.role === 'tool' && m.tool_call_id === 'tc-unknown',
    )
    expect(toolResults).toHaveLength(1)
    expect(toolResults[0].content).toMatch(/Unknown tool/i)

    // And the user sees the synthesis text
    const writes = appendMessageMock.mock.calls.filter(
      (args) => args[1]?.role === 'assistant' && args[1]?.messageType === 'text',
    )
    expect(writes).toHaveLength(1)
    expect(writes[0][1].content).toBe('Sorry, that tool is not available right now.')
  })

  it('appends a synthetic tool_result when checkPolicyGate blocks a tool call', async () => {
    // Same recovery requirement, different early-exit cause. Pick a tool whose
    // policy gate WILL refuse to keep the test deterministic: `generate_section`
    // is blocked unless outline is approved, frozen, eligibility has passed,
    // etc. In discovery phase with no outline at all, the gate denies.
    generateMock.mockReset()

    // Replace fake tool with a `generate_section` shim — name matches what
    // checkPolicyGate inspects.
    const generateSectionShim = {
      name: 'generate_section',
      category: 'generation' as const,
      description: 'fake generate_section for policy-gate test',
      inputSchema: z.object({ sectionKey: z.string().optional() }),
      execute: vi.fn(),
      timeout: 5_000,
    }
    getToolsForPhaseMock.mockReturnValue([generateSectionShim])

    generateMock.mockResolvedValueOnce({
      content: '',
      tokensUsed: { input: 0, output: 0 },
      model: 'claude-opus-4-6',
      provider: 'anthropic',
      toolCalls: [{ id: 'tc-blocked', name: 'generate_section', arguments: '{"sectionKey":"x"}' }],
    })
    generateMock.mockResolvedValueOnce({
      content: 'You need to approve the outline before drafting sections.',
      tokensUsed: { input: 0, output: 0 },
      model: 'claude-opus-4-6',
      provider: 'anthropic',
    })

    const events: AgentEvent[] = []
    await runAgentTurn({
      // discovery + no outline → checkPreGenerate denies generate_section
      session: makeSession({ currentPhase: 'discovery', outline: null, outlineFrozen: false }),
      sections: [],
      request: makeRequest('draft something'),
      emit: (e) => events.push(e),
      turnId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    })

    // Tool must NOT have run
    expect(generateSectionShim.execute).not.toHaveBeenCalled()

    // policy_violation event should have fired (the runtime emits one)
    const violations = events.filter((e) => e.type === 'policy_violation')
    expect(violations.length).toBeGreaterThanOrEqual(1)

    // Synthesis call shipped — and its messages include a tool_result for the
    // blocked call so Anthropic doesn't reject the assistant tool_use.
    expect(generateMock).toHaveBeenCalledTimes(2)
    const synthesisCall = generateMock.mock.calls[1][0]
    const toolResults = synthesisCall.messages.filter((m: { role: string; tool_call_id?: string }) =>
      m.role === 'tool' && m.tool_call_id === 'tc-blocked',
    )
    expect(toolResults).toHaveLength(1)
    // The synthetic content surfaces the gate reason so the model can recover
    expect(toolResults[0].content).toMatch(/outline/i)
  })

  it('caps generate_section to 1 per turn, blocks the second call with a synthetic tool_result', async () => {
    // Prod incident 2026-05-18: V3 drafting turn chained 4 Opus generate_section
    // calls (66s + 55s + 61s + 67s) and exceeded Cloud Run's 300s timeout.
    // Cap enforces at most one generate_section per turn; the model must ask
    // the user before generating the next section.
    generateMock.mockReset()

    const generateSectionShim = {
      name: 'generate_section',
      category: 'generation' as const,
      description: 'fake generate_section for cap test',
      inputSchema: z.object({ sectionKey: z.string() }),
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: { content: '# Section A\nContent.', model: 'claude-opus-4-6' },
        telemetry: { latencyMs: 50 },
      }),
      timeout: 5_000,
    }
    getToolsForPhaseMock.mockReturnValue([generateSectionShim])

    // Iteration 1: model asks for section A AND section B in parallel.
    // The first call must execute; the second must be blocked by the cap.
    generateMock.mockResolvedValueOnce({
      content: '',
      tokensUsed: { input: 0, output: 0 },
      model: 'claude-opus-4-6',
      provider: 'anthropic',
      toolCalls: [
        { id: 'tc-a', name: 'generate_section', arguments: '{"sectionKey":"a"}' },
        { id: 'tc-b', name: 'generate_section', arguments: '{"sectionKey":"b"}' },
      ],
    })
    // Iteration 2: model sees the cap result and responds with text inviting
    // the user to continue on the next turn.
    generateMock.mockResolvedValueOnce({
      content: 'Am generat secțiunea A. Vrei să continui cu secțiunea B?',
      tokensUsed: { input: 0, output: 0 },
      model: 'claude-opus-4-6',
      provider: 'anthropic',
    })

    const events: AgentEvent[] = []
    await runAgentTurn({
      // Drafting-ready session: outline approved, frozen, eligibility clean.
      session: makeSession({
        currentPhase: 'drafting',
        outline: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] as unknown as AgentSession['outline'],
        outlineFrozen: true,
        eligibility: { failCount: 0 } as unknown as AgentSession['eligibility'],
      }),
      sections: [],
      request: makeRequest('draft sections A and B'),
      emit: (e) => events.push(e),
      turnId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    })

    // The tool ran exactly once — the second call was rejected before dispatch
    expect(generateSectionShim.execute).toHaveBeenCalledTimes(1)
    const executedArg = generateSectionShim.execute.mock.calls[0][0]
    expect(executedArg.sectionKey).toBe('a')

    // policy_violation event fired for the capped second call
    const violations = events.filter((e) => e.type === 'policy_violation') as Extract<
      AgentEvent,
      { type: 'policy_violation' }
    >[]
    expect(violations).toHaveLength(1)
    expect(violations[0].gate).toBe('generate_section')
    expect(violations[0].reason).toMatch(/GENERATE_SECTION_PER_TURN_CAP/)

    // The follow-up generate() call sees a balanced messages list: the assistant
    // tool_use for both A and B must each have a matching tool_result.
    expect(generateMock).toHaveBeenCalledTimes(2)
    const followupCall = generateMock.mock.calls[1][0]
    const toolResultsForA = followupCall.messages.filter(
      (m: { role: string; tool_call_id?: string }) => m.role === 'tool' && m.tool_call_id === 'tc-a',
    )
    const toolResultsForB = followupCall.messages.filter(
      (m: { role: string; tool_call_id?: string }) => m.role === 'tool' && m.tool_call_id === 'tc-b',
    )
    expect(toolResultsForA).toHaveLength(1)
    expect(toolResultsForB).toHaveLength(1)
    expect(toolResultsForA[0].content).toMatch(/"success":true/)
    expect(toolResultsForB[0].content).toMatch(/GENERATE_SECTION_PER_TURN_CAP/)

    // User-facing text is the invitation, not the cap error.
    const writes = appendMessageMock.mock.calls.filter(
      (args) => args[1]?.role === 'assistant' && args[1]?.messageType === 'text',
    )
    expect(writes).toHaveLength(1)
    expect(writes[0][1].content).toBe('Am generat secțiunea A. Vrei să continui cu secțiunea B?')
  })

  it('does NOT force a synthesis call when the model returned text before hitting the cap', async () => {
    // Reset: first iteration emits text only — break before max iter.
    generateMock.mockReset()
    generateMock.mockResolvedValueOnce({
      content: 'I have an answer for you.',
      tokensUsed: { input: 0, output: 0 },
      model: 'claude-opus-4-6',
      provider: 'anthropic',
    })

    const events: AgentEvent[] = []
    await runAgentTurn({
      session: makeSession(),
      sections: [],
      request: makeRequest('hi'),
      emit: (e) => events.push(e),
      turnId: '77777777-7777-4777-8777-777777777777',
    })

    expect(generateMock).toHaveBeenCalledTimes(1)
    const writes = appendMessageMock.mock.calls.filter(
      (args) => args[1]?.role === 'assistant' && args[1]?.messageType === 'text',
    )
    // Only the original text — no cap synthesis appended.
    expect(writes).toHaveLength(1)
    expect(writes[0][1].content).toBe('I have an answer for you.')
  })
})

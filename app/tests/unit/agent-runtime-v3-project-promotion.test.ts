// Regression: V3 runtime must call ensureProjectForSession whenever a
// SET_SELECTED_CALL transition fires, mirroring what managed's setSelectedCall
// service already does. Without this, V3 sessions never surface in /proiecte
// and /panou "Continuă activitatea" is the only way to find them.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { ensureProjectForSessionMock } = vi.hoisted(() => ({
  ensureProjectForSessionMock: vi.fn().mockResolvedValue({ promoted: true }),
}))

vi.mock('@/lib/projects/promotion', () => ({
  ensureProjectForSession: ensureProjectForSessionMock,
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
        returning: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}))

vi.mock('@/lib/ai/agent/history', () => ({
  loadContext: vi.fn().mockResolvedValue({ messages: [], summary: null, totalCount: 0 }),
  appendMessage: vi.fn().mockResolvedValue(0),
  compactIfNeeded: vi.fn().mockResolvedValue({ compacted: false }),
  ensureV3PairingInvariant: (m: unknown[]) => m,
}))

vi.mock('@/lib/ai/agent/managed/history', () => ({
  markTurnCompleted: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ai/providers/router', () => ({
  generate: vi.fn().mockResolvedValue({
    content: '',
    tokensUsed: { input: 0, output: 0 },
    model: 'm',
    provider: 'p',
    toolCalls: [],
  }),
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
import type { AgentSession, AgentSection, AgentRequest, AgentEvent } from '@/lib/ai/agent/types'

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

function makeRequest(action: AgentRequest['action']): AgentRequest {
  return {
    sessionId: SESSION_ID,
    action,
    requestId: 'req-promo-1',
    locale: 'ro',
    stateVersion: 0,
  }
}

describe('V3 runtime — project promotion on SET_SELECTED_CALL', () => {
  beforeEach(() => {
    ensureProjectForSessionMock.mockClear()
  })

  it('select_call structured action triggers ensureProjectForSession with correct ctx', async () => {
    const session = makeSession()
    const sections: AgentSection[] = []
    const events: AgentEvent[] = []

    await runAgentTurn({
      session,
      sections,
      request: makeRequest({ type: 'select_call', callId: 'CALL-XYZ' }),
      emit: (e) => events.push(e),
      turnId: '44444444-4444-4444-8444-444444444444',
    })

    expect(ensureProjectForSessionMock).toHaveBeenCalledTimes(1)
    const [ctxArg, sessionIdArg] = ensureProjectForSessionMock.mock.calls[0]
    expect(ctxArg).toMatchObject({
      userId: USER_ID,
      sessionId: SESSION_ID,
      requestId: 'req-promo-1',
    })
    expect(sessionIdArg).toBe(SESSION_ID)
  })

  it('action without SET_SELECTED_CALL does NOT call ensureProjectForSession', async () => {
    // approve_outline requires selectedCallId + passing eligibility — set both.
    const session = makeSession({
      selectedCallId: 'CALL-EXISTING',
      currentPhase: 'structuring',
      eligibility: { results: [], score: 100, passCount: 5, failCount: 0, warningCount: 0 },
    })
    const sections: AgentSection[] = []
    const events: AgentEvent[] = []

    await runAgentTurn({
      session,
      sections,
      request: makeRequest({ type: 'approve_outline' }),
      emit: (e) => events.push(e),
      turnId: '55555555-5555-4555-8555-555555555555',
    })

    expect(ensureProjectForSessionMock).not.toHaveBeenCalled()
  })

  it('promotion failure does not crash the turn (fails safe)', async () => {
    ensureProjectForSessionMock.mockRejectedValueOnce(new Error('boom'))
    const session = makeSession()
    const sections: AgentSection[] = []
    const events: AgentEvent[] = []

    await expect(
      runAgentTurn({
        session,
        sections,
        request: makeRequest({ type: 'select_call', callId: 'CALL-XYZ' }),
        emit: (e) => events.push(e),
        turnId: '66666666-6666-4666-8666-666666666666',
      }),
    ).resolves.toBeDefined()

    expect(ensureProjectForSessionMock).toHaveBeenCalledTimes(1)
  })
})

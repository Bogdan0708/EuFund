// app/tests/unit/ai/agent/runtime-cache-gate.test.ts
//
// Plan 2 PR 2b: V3 runtime must pass `cache: { enabled: true, breakpoints: ['system', 'tools'] }`
// to generate() iff `isFeatureEnabled('v3_prompt_cache_enabled', { userId })` resolves true.
// No cache.key override (identityKey-only per plan §D1).
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted runs before vi.mock factories, so these refs are safe to use in factories.
const { generateMock, isFeatureEnabledMock } = vi.hoisted(() => {
  return {
    generateMock: vi.fn(),
    isFeatureEnabledMock: vi.fn(),
  }
})

interface CapturedArg {
  cache?: unknown
  provider: string
  model: string
  messages: unknown[]
}

const captured: CapturedArg[] = []

vi.mock('@/lib/ai/providers/router', () => ({ generate: generateMock }))
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: isFeatureEnabledMock,
  invalidateFlagCache: vi.fn(),
}))
vi.mock('@/lib/ai/agent/history', () => ({
  loadContext: async () => ({ summary: null, messages: [], totalCount: 0 }),
  appendMessage: vi.fn().mockResolvedValue(0),
  compactIfNeeded: vi.fn().mockResolvedValue({ compacted: false }),
  ensureV3PairingInvariant: (m: unknown[]) => m,
}))
vi.mock('@/lib/ai/agent/tools/registry', () => ({ getToolsForPhase: () => [] }))
vi.mock('@/lib/ai/agent/tools/index', () => ({}))
vi.mock('@/lib/ai/agent/prompt', () => ({
  buildSystemPrompt: () => 'stable-prefix',
  buildSessionStateBlock: () => '## Current Session State\n- stub\n',
}))
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
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        then: (resolve: (v: unknown) => void) => resolve(undefined),
      }),
    }),
  },
}))

import { runAgentTurn } from '@/lib/ai/agent/runtime'
import type { AgentSession } from '@/lib/ai/agent/types'

const SESSION_USER_ID = '22222222-2222-4222-8222-222222222222'
function makeSession(): AgentSession {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: SESSION_USER_ID,
    status: 'active', locale: 'ro', selectedCallId: null, currentPhase: 'drafting',
    projectId: null,
    blueprint: null, eligibility: null, outline: null, warnings: [],
    outlineFrozen: false,
    planningArtifact: null, messageSummary: null, stateVersion: 0,
    createdAt: new Date(), updatedAt: new Date(),
  } as AgentSession
}

beforeEach(() => {
  captured.length = 0
  isFeatureEnabledMock.mockReset()
  generateMock.mockReset()
  generateMock.mockImplementation(async (req: CapturedArg) => {
    captured.push(JSON.parse(JSON.stringify(req)))
    return {
      content: 'ok',
      tokensUsed: { input: 0, output: 0 },
      model: req.model,
      provider: req.provider,
      toolCalls: [],
    }
  })
})

describe('V3 runtime — cache opt-in flag gating (PR 2b)', () => {
  it('omits req.cache when v3_prompt_cache_enabled resolves false', async () => {
    isFeatureEnabledMock.mockResolvedValue(false)
    await runAgentTurn({
      session: makeSession(),
      sections: [],
      request: { message: 'hi', requestId: 'r1', locale: 'ro' },
      emit: () => {},
          turnId: 'tu-test',
    })
    expect(captured).toHaveLength(1)
    expect(captured[0].cache).toBeUndefined()
  })

  it('passes cache: { enabled: true, breakpoints: [system, tools] } when the flag resolves true', async () => {
    isFeatureEnabledMock.mockResolvedValue(true)
    await runAgentTurn({
      session: makeSession(),
      sections: [],
      request: { message: 'hi', requestId: 'r2', locale: 'ro' },
      emit: () => {},
          turnId: 'tu-test',
    })
    expect(captured).toHaveLength(1)
    expect(captured[0].cache).toEqual({ enabled: true, breakpoints: ['system', 'tools'] })
  })

  it('does NOT set cache.key (identityKey-only per plan §D1)', async () => {
    isFeatureEnabledMock.mockResolvedValue(true)
    await runAgentTurn({
      session: makeSession(),
      sections: [],
      request: { message: 'hi', requestId: 'r3', locale: 'ro' },
      emit: () => {},
          turnId: 'tu-test',
    })
    expect(captured).toHaveLength(1)
    const cache = captured[0].cache as { key?: string } | undefined
    expect(cache?.key).toBeUndefined()
  })

  it('calls isFeatureEnabled with v3_prompt_cache_enabled and session.userId', async () => {
    isFeatureEnabledMock.mockResolvedValue(false)
    await runAgentTurn({
      session: makeSession(),
      sections: [],
      request: { message: 'hi', requestId: 'r4', locale: 'ro' },
      emit: () => {},
          turnId: 'tu-test',
    })
    expect(isFeatureEnabledMock).toHaveBeenCalledWith(
      'v3_prompt_cache_enabled',
      { userId: SESSION_USER_ID },
    )
    // PR 4: V3 runtime now reads two flags per turn — v3_prompt_cache_enabled
    // and chat_tools_trimmed. Both are read once per turn (not per iteration).
    expect(isFeatureEnabledMock).toHaveBeenCalledTimes(2)
    const flagKeys = isFeatureEnabledMock.mock.calls.map((c: unknown[]) => c[0] as string)
    expect(flagKeys).toContain('v3_prompt_cache_enabled')
    expect(flagKeys).toContain('chat_tools_trimmed')
  })
})

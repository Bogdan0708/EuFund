import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' }),
}))

vi.mock('@/lib/middleware/rate-limit', () => ({
  withRateLimit: (_opts: unknown, h: unknown) => h,
}))

// Mock bridgeStructuredAction
vi.mock('@/lib/ai/agent/managed/bridge', () => ({
  bridgeStructuredAction: vi.fn(async () => ({
    outcome: 'success',
    stateVersionBumped: true,
    continueToManaged: false,
  })),
}))

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn().mockImplementation(async (key: string) => {
    if (key === 'agent_v3_enabled') return true
    if (key === 'managed_agent_enabled') return true
    if (key === 'managed_agent_writes_enabled') return true
    return false
  }),
}))

vi.mock('@/lib/db', () => {
  const sessionRow = {
    id: '22222222-2222-4222-8222-222222222222',
    userId: '11111111-1111-4111-8111-111111111111',
    projectId: null, status: 'active', locale: 'ro',
    selectedCallId: 'CALL-1', currentPhase: 'discovery',
    blueprint: null, eligibility: null, outline: null,
    warnings: [], planningArtifact: null,
    outlineFrozen: false, messageSummary: null,
    stateVersion: 5, createdAt: new Date(), updatedAt: new Date(),
  }
  // select().from().where() must be both awaitable (sections — returns []) AND
  // chainable into .limit() (session — returns [sessionRow]).
  const select = vi.fn(() => ({
    from: vi.fn(() => {
      const whereResult: Promise<unknown[]> & { limit: (n: number) => Promise<unknown[]> } =
        Object.assign(Promise.resolve([]), {
          limit: (_n: number) => Promise.resolve([sessionRow]),
        })
      return {
        where: vi.fn(() => whereResult),
      }
    }),
  }))
  return { db: { select } }
})

vi.mock('@/lib/db/schema', () => ({
  agentSessions: { id: 'id', userId: 'user_id' },
  agentSections: { sessionId: 'session_id' },
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn() }))

vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))

vi.mock('@/lib/ai/agent/managed/circuit-breaker', () => ({
  managedCircuitBreaker: { isOpen: () => false },
  recordManagedFailure: vi.fn(),
  recordManagedSuccess: vi.fn(),
}))

vi.mock('@/lib/ai/anthropic-client', () => ({
  // Force the auth-setup-throw branch by making this throw.
  getAnthropicClient: vi.fn(() => { throw new Error('no api key') }),
}))

vi.mock('@/lib/ai/agent/managed/session-metadata', () => ({
  ensureAppAgentSession: vi.fn().mockResolvedValue(undefined),
  markDegraded: vi.fn().mockResolvedValue(undefined),
  recordTurnSuccess: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ai/model-routing', () => ({
  getAIModelRoutingContext: vi.fn().mockResolvedValue({}),
}))

const claimTurnMock = vi.fn()
vi.mock('@/lib/ai/agent/managed/history', () => ({
  claimTurn: claimTurnMock,
  deleteEmptyTurn: vi.fn(),
}))

const runAgentTurnMock = vi.fn()
vi.mock('@/lib/ai/agent/runtime', () => ({
  runAgentTurn: runAgentTurnMock,
}))

describe('POST /api/ai/agent — Managed turn claim contract', () => {
  beforeEach(() => {
    claimTurnMock.mockReset()
    runAgentTurnMock.mockReset()
  })

  function buildRequest(): NextRequest {
    return new NextRequest('http://localhost/api/ai/agent', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: '22222222-2222-4222-8222-222222222222',
        requestId: 'req-1',
        locale: 'ro',
        message: 'hi',
        stateVersion: 5,
      }),
    })
  }

  it('Managed path: claim succeeds → run proceeds', async () => {
    process.env.MANAGED_RUNTIME_ENABLED = 'true'
    const { getAnthropicClient } = await import('@/lib/ai/anthropic-client')
    vi.mocked(getAnthropicClient).mockImplementationOnce(() => ({} as never))

    claimTurnMock.mockResolvedValueOnce({ kind: 'claimed', turnId: 'tu-1' })
    const { POST } = await import('@/app/api/ai/agent/route')
    const res = await POST(buildRequest())
    expect(res.status).toBe(200)
    expect(claimTurnMock).toHaveBeenCalledWith(expect.objectContaining({ runtimeMode: 'managed' }))
  })

  it('Managed path: setup fails → degrades to V3', async () => {
    process.env.MANAGED_RUNTIME_ENABLED = 'true'
    // getAnthropicClient will throw by default mock in this file
    claimTurnMock.mockResolvedValueOnce({ kind: 'claimed', turnId: 'tu-v3' })
    const { POST } = await import('@/app/api/ai/agent/route')
    const res = await POST(buildRequest())
    expect(res.status).toBe(200)
    expect(claimTurnMock).toHaveBeenCalledWith(expect.objectContaining({ runtimeMode: 'v3' }))
  })

  it('structured action with managed enabled → routes to bridge without creating an LLM turn claim', async () => {
    process.env.MANAGED_RUNTIME_ENABLED = 'true'

    const { bridgeStructuredAction } = await import('@/lib/ai/agent/managed/bridge')

    const actionRequest = new NextRequest('http://localhost/api/ai/agent', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: '22222222-2222-4222-8222-222222222222',
        requestId: 'req-action',
        locale: 'ro',
        action: { type: 'approve_outline' },
        stateVersion: 5,
      }),
    })

    const { POST } = await import('@/app/api/ai/agent/route')
    const res = await POST(actionRequest)

    expect(res.status).toBe(200)
    expect(bridgeStructuredAction).toHaveBeenCalled()
    expect(claimTurnMock).not.toHaveBeenCalled()
  })
})

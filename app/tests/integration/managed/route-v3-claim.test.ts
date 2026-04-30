import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' }),
}))

vi.mock('@/lib/middleware/rate-limit', () => ({
  withRateLimit: (_opts: unknown, h: unknown) => h,
}))

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(true), // agent_v3_enabled
}))

vi.mock('@/lib/db', () => {
  const sessionRow = {
    id: '22222222-2222-4222-8222-222222222222',
    userId: '11111111-1111-4111-8111-111111111111',
    projectId: null, status: 'active', locale: 'ro',
    selectedCallId: null, currentPhase: 'discovery',
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

describe('POST /api/ai/agent — V3 claim contract', () => {
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

  it('V3 path (auth-setup-throw): claim succeeds → run proceeds', async () => {
    process.env.MANAGED_RUNTIME_ENABLED = 'true'
    claimTurnMock.mockResolvedValueOnce({ kind: 'claimed', turnId: 'tu-1' })
    runAgentTurnMock.mockResolvedValueOnce({})
    const { POST } = await import('@/app/api/ai/agent/route')
    const res = await POST(buildRequest())
    expect(claimTurnMock).toHaveBeenCalledWith(expect.objectContaining({ runtimeMode: 'v3' }))
    expect(res.status).toBe(200)
  })

  it('V3 path: claim conflict → 409 with conflict_request_id envelope', async () => {
    process.env.MANAGED_RUNTIME_ENABLED = 'true'
    claimTurnMock.mockResolvedValueOnce({ kind: 'conflict' })
    const { POST } = await import('@/app/api/ai/agent/route')
    const res = await POST(buildRequest())
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.code).toBe('conflict_request_id')
    expect(body.error.messageRo).toBeTruthy()
    expect(body.error.messageEn).toBeTruthy()
    expect(runAgentTurnMock).not.toHaveBeenCalled()
  })

  it('structured action with managed enabled → routes to V3, claims with runtimeMode=v3, threads turnId', async () => {
    process.env.MANAGED_RUNTIME_ENABLED = 'true'
    const { getAnthropicClient } = await import('@/lib/ai/anthropic-client')
    vi.mocked(getAnthropicClient).mockImplementationOnce(() => ({} as never))

    claimTurnMock.mockResolvedValueOnce({ kind: 'claimed', turnId: 'tu-action' })
    runAgentTurnMock.mockResolvedValueOnce({})

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
    expect(claimTurnMock).toHaveBeenCalledTimes(1)
    expect(claimTurnMock).toHaveBeenCalledWith(expect.objectContaining({
      runtimeMode: 'v3',
      requestId: 'req-action',
    }))
    expect(runAgentTurnMock).toHaveBeenCalledTimes(1)
    const callArgs = runAgentTurnMock.mock.calls[0][0]
    expect(callArgs.turnId).toBe('tu-action')
  })
})

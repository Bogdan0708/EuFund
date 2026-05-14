import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockRunV3 = vi.fn().mockResolvedValue(undefined)
const mockRunManaged = vi.fn().mockResolvedValue(undefined)

// Mock bridgeStructuredAction
vi.mock('@/lib/ai/agent/managed/bridge', () => ({
  bridgeStructuredAction: vi.fn(async () => ({ outcome: 'success', stateVersionBumped: true, continueToManaged: false })),
}))

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn().mockImplementation(async (key: string) => {
    if (key === 'agent_v3_enabled') return true
    if (key === 'managed_agent_enabled') return true
    if (key === 'managed_agent_writes_enabled') return true
    return false
  }),
}))

vi.mock('@/lib/ai/agent/managed/runtime', () => ({
  runManagedTurn: mockRunManaged,
}))

vi.mock('@/lib/ai/agent/runtime', () => ({
  runAgentTurn: mockRunV3,
}))

vi.mock('@/lib/ai/agent/managed/circuit-breaker', () => ({
  managedCircuitBreaker: { isOpen: () => false },
  recordManagedFailure: vi.fn(),
  recordManagedSuccess: vi.fn(),
}))

vi.mock('@/lib/ai/anthropic-client', () => ({
  getAnthropicClient: vi.fn(() => ({ messages: {} })),
}))

vi.mock('@/lib/ai/agent/managed/session-metadata', () => ({
  ensureAppAgentSession: vi.fn(),
  markDegraded: vi.fn(),
  recordTurnSuccess: vi.fn(),
}))

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}))

vi.mock('@/lib/ai/model-routing', () => ({
  getAIModelRoutingContext: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/db', () => {
  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    userId: 'user-1',
    projectId: null,
    stateVersion: 0,
    status: 'active',
    locale: 'ro',
    selectedCallId: 'CALL-A',
    currentPhase: 'structuring',
    blueprint: { requiredSections: [] },
    eligibility: null,
    outline: null,
    warnings: [],
    planningArtifact: {
      preselect: {
        version: 1,
        rankedAt: '2026-04-19T00:00:00.000Z',
        description: 'test',
        selectedCallId: 'CALL-A',
        selectedScore: 0.8,
        candidates: [],
        selectionKind: 'selected',
        blueprintKind: 'structured',
        excludeCallIdsApplied: [],
      },
    },
    outlineFrozen: false,
    messageSummary: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const makeChain = () => {
    const chain: Record<string, unknown> = {}
    chain.from = vi.fn(() => chain)
    chain.where = vi.fn(() => {
      const whereResult: Record<string, unknown> = {
        limit: vi.fn().mockResolvedValue([row]),
        then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
      }
      return whereResult
    })
    return chain
  }

  const mockDb: any = {
    select: vi.fn(() => makeChain()),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ ...row, id: 'mock-turn-id' }]),
        then: (resolve: (val: unknown) => void) => resolve(undefined),
      })),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  }
  mockDb.transaction = vi.fn(async (cb: any) => cb(mockDb))
  return { db: mockDb }
})

vi.mock('@/lib/db/schema', () => ({
  agentSessions: { id: 'id', userId: 'user_id' },
  agentSections: { sessionId: 'session_id' },
  agentTurns: { id: 'id', sessionId: 'session_id', requestId: 'request_id' },
  agentMessages: { sessionId: 'session_id', sequenceNumber: 'sequence_number', turnId: 'turn_id' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

vi.mock('@/lib/middleware/rate-limit', () => ({
  withRateLimit: (_cfg: unknown, handler: (req: Request) => Promise<Response>) => handler,
}))

describe('POST /api/ai/agent — structured action bridge on preselected sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.MANAGED_RUNTIME_ENABLED = 'true'
  })
  afterEach(() => { delete process.env.MANAGED_RUNTIME_ENABLED })

  it('routes action requests to bridge (managed) even on preselected sessions', async () => {
    const { bridgeStructuredAction } = await import('@/lib/ai/agent/managed/bridge')
    const { POST } = await import('@/app/api/ai/agent/route')
    const req = new Request('http://localhost/api/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: 'req-3',
        locale: 'ro',
        sessionId: '11111111-1111-4111-8111-111111111111',
        action: { type: 'approve_outline' },
      }),
    })

    const res = await POST(req as never)
    if (res.body) await res.text()

    // Core assertions: Bridge handled the action; no managed LLM or V3 fallback ran.
    expect(bridgeStructuredAction).toHaveBeenCalled()
    expect(mockRunManaged).not.toHaveBeenCalled()
    expect(mockRunV3).not.toHaveBeenCalled()
  })

  it('still fail-closes message turns on preselected sessions when managed is unavailable (sanity)', async () => {
    // Force managedEnabled=false by making the circuit breaker OPEN.
    const { managedCircuitBreaker } = await import('@/lib/ai/agent/managed/circuit-breaker')
    vi.spyOn(managedCircuitBreaker, 'isOpen').mockReturnValue(true)

    const { POST } = await import('@/app/api/ai/agent/route')
    const req = new Request('http://localhost/api/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: 'req-4',
        locale: 'ro',
        sessionId: '11111111-1111-4111-8111-111111111111',
        message: 'hello',
      }),
    })

    const res = await POST(req as never)
    expect(res.status).toBe(503) // MANAGED_UNAVAILABLE fail-closed guard
    expect(mockRunV3).not.toHaveBeenCalled()
  })
})

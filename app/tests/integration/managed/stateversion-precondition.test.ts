import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockRunV3 = vi.fn().mockResolvedValue(undefined)
const mockRunManaged = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn().mockImplementation(async (key: string) => {
    if (key === 'agent_v3_enabled') return true
    if (key === 'managed_agent_enabled') return true
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

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}))

vi.mock('@/lib/ai/model-routing', () => ({
  getAIModelRoutingContext: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/ai/agent/managed/session-metadata', () => ({
  ensureAppAgentSession: vi.fn().mockResolvedValue(undefined),
  markDegraded: vi.fn().mockResolvedValue(undefined),
  recordTurnSuccess: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/db', () => {
  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    userId: 'user-1',
    projectId: null,
    stateVersion: 5,
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

describe('managed route — mandatory stateVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.MANAGED_RUNTIME_ENABLED = 'true'
  })
  afterEach(() => { delete process.env.MANAGED_RUNTIME_ENABLED })

  it('returns 400 missing_state_version when managed POST omits stateVersion', async () => {
    const { POST } = await import('@/app/api/ai/agent/route')
    const req = new Request('http://localhost/api/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: '11111111-1111-4111-8111-111111111111',
        requestId: 'req-1',
        locale: 'ro',
        message: 'hi',
        // no stateVersion
      }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('missing_state_version')
    expect(json.error.messageRo).toBeDefined()
    expect(json.error.messageEn).toBeDefined()
    expect(mockRunManaged).not.toHaveBeenCalled()
  })

  it('returns 409 stale_state_version when stateVersion is stale', async () => {
    const { POST } = await import('@/app/api/ai/agent/route')
    const req = new Request('http://localhost/api/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: '11111111-1111-4111-8111-111111111111',
        requestId: 'req-2',
        locale: 'ro',
        message: 'hi',
        stateVersion: 3,
      }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error.code).toBe('stale_state_version')
    expect(json.currentVersion).toBe(5)
    expect(mockRunManaged).not.toHaveBeenCalled()
  })

  it('proceeds to managed dispatch when stateVersion matches', async () => {
    const { POST } = await import('@/app/api/ai/agent/route')
    const req = new Request('http://localhost/api/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: '11111111-1111-4111-8111-111111111111',
        requestId: 'req-3',
        locale: 'ro',
        message: 'hi',
        stateVersion: 5,
      }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(200)
    // Drain SSE stream so the managed runtime's start() actually runs
    await res.text()
    expect(mockRunManaged).toHaveBeenCalled()
  })
})

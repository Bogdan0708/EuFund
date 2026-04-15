import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockRunV3 = vi.fn().mockResolvedValue(undefined)
const mockRunManaged = vi.fn().mockResolvedValue(undefined)

// Feature flag: v3 enabled AND managed DISABLED
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn().mockImplementation(async (key: string) => {
    if (key === 'agent_v3_enabled') return true
    if (key === 'managed_agent_enabled') return false
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

vi.mock('@/lib/db', () => {
  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    userId: 'user-1',
    projectId: null,
    stateVersion: 0,
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

  // Chain that supports: .from().where().limit() (session lookup)
  // AND    .from().where()         (section rows, thenable)
  const makeChain = () => {
    const chain: Record<string, unknown> = {}
    chain.from = vi.fn(() => chain)
    chain.where = vi.fn(() => {
      // Act as a thenable resolving to the section-rows array
      const whereResult: Record<string, unknown> = {
        limit: vi.fn().mockResolvedValue([row]),
        then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
      }
      return whereResult
    })
    return chain
  }

  return {
    db: {
      select: vi.fn(() => makeChain()),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([row]) })),
      })),
    },
  }
})

vi.mock('@/lib/db/schema', () => ({
  agentSessions: { id: 'id', userId: 'user_id' },
  agentSections: { sessionId: 'session_id' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

// withRateLimit passes through
vi.mock('@/lib/middleware/rate-limit', () => ({
  withRateLimit: (_cfg: unknown, handler: (req: Request) => Promise<Response>) => handler,
}))

describe('POST /api/ai/agent — flag off', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.MANAGED_RUNTIME_ENABLED = 'true'
  })
  afterEach(() => { delete process.env.MANAGED_RUNTIME_ENABLED })

  it('routes to V3 when managed flag is off', async () => {
    const { POST } = await import('@/app/api/ai/agent/route')
    const req = new Request('http://localhost/api/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: 'req-1',
        locale: 'ro',
        sessionId: '11111111-1111-4111-8111-111111111111',
      }),
    })

    const res = await POST(req as never)
    // Consume the stream body so finally-close runs
    if (res.body) await res.text()
    expect(mockRunV3).toHaveBeenCalled()
    expect(mockRunManaged).not.toHaveBeenCalled()
  })
})

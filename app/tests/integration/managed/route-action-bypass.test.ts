import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockRunV3 = vi.fn().mockResolvedValue(undefined)
const mockRunManaged = vi.fn().mockResolvedValue(undefined)

// Feature flags: BOTH v3 and managed ENABLED. This test proves that
// structured actions still bypass the managed runtime regardless of
// whether the user is allowlisted for managed mode.
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

vi.mock('@/lib/middleware/rate-limit', () => ({
  withRateLimit: (_cfg: unknown, handler: (req: Request) => Promise<Response>) => handler,
}))

describe('POST /api/ai/agent — structured action bypass', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.MANAGED_RUNTIME_ENABLED = 'true'
  })
  afterEach(() => { delete process.env.MANAGED_RUNTIME_ENABLED })

  it('routes action requests to V3 even when managed flag is ON', async () => {
    const { POST } = await import('@/app/api/ai/agent/route')
    const req = new Request('http://localhost/api/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: 'req-1',
        locale: 'ro',
        sessionId: '11111111-1111-4111-8111-111111111111',
        action: { type: 'select_call', callId: 'CALL-42' },
      }),
    })

    const res = await POST(req as never)
    if (res.body) await res.text()

    expect(mockRunV3).toHaveBeenCalled()
    expect(mockRunManaged).not.toHaveBeenCalled()
  })

  it('still routes plain message requests to managed when flag is ON', async () => {
    // Sanity check — without the action, the same setup SHOULD go managed.
    const { POST } = await import('@/app/api/ai/agent/route')
    const req = new Request('http://localhost/api/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: 'req-2',
        locale: 'ro',
        sessionId: '11111111-1111-4111-8111-111111111111',
        message: 'Salut, caut apeluri.',
      }),
    })

    const res = await POST(req as never)
    if (res.body) await res.text()

    expect(mockRunManaged).toHaveBeenCalled()
    expect(mockRunV3).not.toHaveBeenCalled()
  })
})

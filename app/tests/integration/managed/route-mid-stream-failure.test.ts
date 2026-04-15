import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockRunV3 = vi.fn().mockResolvedValue(undefined)
const mockRecordFailure = vi.fn()
const mockRecordSuccess = vi.fn()

// runManagedTurn emits a text_delta then throws — simulates mid-stream failure
const mockRunManaged = vi.fn().mockImplementation(
  async ({ emit }: { emit: (e: unknown) => void }) => {
    emit({ type: 'text_delta', content: 'Starting...' })
    throw new Error('stream disconnected unexpectedly')
  },
)

// Both flags on
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

// Breaker closed
vi.mock('@/lib/ai/agent/managed/circuit-breaker', () => ({
  managedCircuitBreaker: { isOpen: () => false },
  recordManagedFailure: mockRecordFailure,
  recordManagedSuccess: mockRecordSuccess,
}))

// Anthropic client initializes OK
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
  const makeChain = () => {
    const chain: Record<string, unknown> = {}
    chain.from = vi.fn(() => chain)
    chain.where = vi.fn(() => ({
      limit: vi.fn().mockResolvedValue([row]),
      then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
    }))
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

describe('POST /api/ai/agent — mid-stream failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.MANAGED_RUNTIME_ENABLED = 'true'
  })
  afterEach(() => { delete process.env.MANAGED_RUNTIME_ENABLED })

  it('emits error SSE event and records failure when runManagedTurn throws', async () => {
    const { POST } = await import('@/app/api/ai/agent/route')
    const req = new Request('http://localhost/api/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: 'req-mid-1',
        locale: 'ro',
        sessionId: '11111111-1111-4111-8111-111111111111',
        stateVersion: 0,
        message: 'hi',
      }),
    })

    const res = await POST(req as never)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    const text = await res.text()

    expect(text).toContain('"type":"error"')
    expect(text).toContain('"retryable":true')
    expect(mockRunManaged).toHaveBeenCalled()
    expect(mockRunV3).not.toHaveBeenCalled()
    expect(mockRecordFailure).toHaveBeenCalled()
    expect(mockRecordSuccess).not.toHaveBeenCalled()
  })
})

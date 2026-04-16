import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Shared fakes ────────────────────────────────────────────────
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

const sessionRow = {
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

// ── Per-test agentTurns insert behavior ────────────────────────
// The tests install a fake via `setClaimBehavior(...)`. Each call lets a
// test toggle the simulated result of the pre-stream claim insert:
//   'ok'       → normal insert, returns a turn id
//   'conflict' → throws a PG 23505 uniqueness violation
let claimBehavior: 'ok' | 'conflict' = 'ok'
function setClaimBehavior(b: 'ok' | 'conflict') { claimBehavior = b }

vi.mock('@/lib/db', () => {
  const makeChain = () => {
    const chain: Record<string, unknown> = {}
    chain.from = vi.fn(() => chain)
    chain.where = vi.fn(() => {
      const whereResult: Record<string, unknown> = {
        limit: vi.fn().mockResolvedValue([sessionRow]),
        then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
      }
      return whereResult
    })
    return chain
  }

  // Fake transaction that routes INSERT into agent_turns through the
  // configurable claimBehavior switch so tests can reproduce 23505.
  const txFactory = () => ({
    select: vi.fn(() => makeChain()),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => {
          if (claimBehavior === 'conflict') {
            const err = new Error('duplicate key value violates unique constraint') as Error & { code?: string }
            err.code = '23505'
            return Promise.reject(err)
          }
          return Promise.resolve([{ id: 'mock-turn-id' }])
        }),
      })),
    })),
  })

  const mockDb: Record<string, unknown> = {
    select: vi.fn(() => makeChain()),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([sessionRow]),
        then: (resolve: (val: unknown) => void) => resolve(undefined),
      })),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  }
  mockDb.transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(txFactory()))
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
  asc: vi.fn(),
  desc: vi.fn(),
  count: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

vi.mock('@/lib/middleware/rate-limit', () => ({
  withRateLimit: (_cfg: unknown, handler: (req: Request) => Promise<Response>) => handler,
}))

describe('managed retry idempotency — pre-stream turn claim', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.MANAGED_RUNTIME_ENABLED = 'true'
    setClaimBehavior('ok')
  })
  afterEach(() => { delete process.env.MANAGED_RUNTIME_ENABLED })

  it('rejects managed POST without requestId with 400', async () => {
    const { POST } = await import('@/app/api/ai/agent/route')
    const req = new Request('http://localhost/api/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sessionRow.id,
        locale: 'ro',
        stateVersion: 0,
        message: 'hi',
        // no requestId
      }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
    expect(mockRunManaged).not.toHaveBeenCalled()
  })

  it('returns HTTP 409 conflict_request_id as clean JSON when claim conflicts', async () => {
    setClaimBehavior('conflict')
    const { POST } = await import('@/app/api/ai/agent/route')
    const req = new Request('http://localhost/api/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sessionRow.id,
        requestId: 'req-abc',
        locale: 'ro',
        stateVersion: 0,
        message: 'hi',
      }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(409)
    // Response must be clean JSON — never SSE.
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    const json = await res.json()
    expect(json.error.code).toBe('conflict_request_id')
    expect(json.error.messageRo).toBeDefined()
    expect(json.error.messageEn).toBeDefined()
    // Runtime was never reached — claim rejection is fully pre-stream.
    expect(mockRunManaged).not.toHaveBeenCalled()
  })

  it('conflict response is unconditional — no inline reclaim attempted', async () => {
    // Same setup as the previous test: conflict fires and we confirm that
    // the response is still 409 rather than somehow recovering by deleting
    // and re-claiming. The spec explicitly forbids inline reclaim because
    // a live in-flight stream has no children until first durable output.
    setClaimBehavior('conflict')
    const { POST } = await import('@/app/api/ai/agent/route')
    const req = new Request('http://localhost/api/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sessionRow.id,
        requestId: 'req-abc',
        locale: 'ro',
        stateVersion: 0,
        message: 'hi',
      }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(409)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(mockRunManaged).not.toHaveBeenCalled()
  })

  it('successful claim proceeds to managed dispatch with SSE response', async () => {
    const { POST } = await import('@/app/api/ai/agent/route')
    const req = new Request('http://localhost/api/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sessionRow.id,
        requestId: 'req-fresh',
        locale: 'ro',
        stateVersion: 0,
        message: 'hi',
      }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
    await res.text()
    expect(mockRunManaged).toHaveBeenCalled()
    // turnId was passed as an argument to runManagedTurn
    const passedOpts = mockRunManaged.mock.calls[0][0] as {
      turnId?: string
      serviceCtx?: { allowWrites?: boolean }
    }
    expect(passedOpts.turnId).toBe('mock-turn-id')
    // Route reads managed_agent_writes_enabled with bypassCache:true so
    // an emergency disable is effective within one request rather than
    // after the 60s cache TTL.
    const { isFeatureEnabled } = await import('@/lib/feature-flags')
    expect(isFeatureEnabled).toHaveBeenCalledWith(
      'managed_agent_writes_enabled',
      expect.objectContaining({ userId: 'user-1', bypassCache: true }),
    )
    // Mocked flag returns false for unknown keys → ctx.allowWrites=false
    // in the managed turn (fail-closed default).
    expect(passedOpts.serviceCtx?.allowWrites).toBe(false)
  })
})

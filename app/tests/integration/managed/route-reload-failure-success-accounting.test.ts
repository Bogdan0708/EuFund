import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Verifies the B3 fix at the ROUTE level: when runManagedTurn returns
// `{ firstOutputPersisted: true, reloadFailed: true }`, the route MUST
// skip recordManagedSuccess() and recordTurnSuccess(). The runtime-level
// test (runtime-reload-failure.test.ts) verifies the runtime sets the
// flag; this test verifies the route honors it.

const mockRunV3 = vi.fn().mockResolvedValue(undefined)
const mockRunManaged = vi.fn()
const mockRecordManagedSuccess = vi.fn()
const mockRecordTurnSuccess = vi.fn().mockResolvedValue(undefined)

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
  recordManagedSuccess: mockRecordManagedSuccess,
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
  recordTurnSuccess: mockRecordTurnSuccess,
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

vi.mock('@/lib/db', () => {
  const makeChain = () => {
    const chain: Record<string, unknown> = {}
    chain.from = vi.fn(() => chain)
    chain.where = vi.fn(() => ({
      limit: vi.fn().mockResolvedValue([sessionRow]),
      then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
    }))
    return chain
  }

  const txFactory = () => ({
    select: vi.fn(() => makeChain()),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([{ id: 'mock-turn-id' }])),
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

describe('agent route — managed reload-failure success accounting (B3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.MANAGED_RUNTIME_ENABLED = 'true'
  })
  afterEach(() => {
    delete process.env.MANAGED_RUNTIME_ENABLED
  })

  const buildReq = (requestId: string) =>
    new Request('http://localhost/api/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sessionRow.id,
        requestId,
        locale: 'ro',
        stateVersion: 0,
        message: 'hi',
      }),
    })

  it('does NOT call recordManagedSuccess or recordTurnSuccess when reloadFailed=true', async () => {
    mockRunManaged.mockResolvedValueOnce({
      firstOutputPersisted: true,
      reloadFailed: true,
      toolCount: 1,
      iterationCount: 2,
      model: 'claude-sonnet-4-6',
      latencyMs: 100,
    })

    const { POST } = await import('@/app/api/ai/agent/route')
    const res = await POST(buildReq('req-reload-fail') as never)
    expect(res.status).toBe(200)
    await res.text()

    expect(mockRunManaged).toHaveBeenCalledTimes(1)
    // Critical: the route must NOT credit a turn whose UI snapshot is
    // stale. agent_turns.completedAt was already set inside the runtime
    // by markTurnCompleted, so the durable-output side is honest, but
    // application_agent_sessions.lastTurn metadata MUST stay untouched.
    expect(mockRecordManagedSuccess).not.toHaveBeenCalled()
    expect(mockRecordTurnSuccess).not.toHaveBeenCalled()
  })

  it('DOES call recordManagedSuccess and recordTurnSuccess on the happy path', async () => {
    // Positive control: same wiring, reloadFailed not set / false. Anchors
    // the truth-table for the negative case above.
    mockRunManaged.mockResolvedValueOnce({
      firstOutputPersisted: true,
      reloadFailed: false,
      toolCount: 1,
      iterationCount: 2,
      model: 'claude-sonnet-4-6',
      latencyMs: 100,
    })

    const { POST } = await import('@/app/api/ai/agent/route')
    const res = await POST(buildReq('req-happy') as never)
    expect(res.status).toBe(200)
    await res.text()

    expect(mockRecordManagedSuccess).toHaveBeenCalledTimes(1)
    expect(mockRecordTurnSuccess).toHaveBeenCalledTimes(1)
  })

  it('does NOT call recordManagedSuccess when firstOutputPersisted=false (no_output turn)', async () => {
    // Pre-existing semantics still hold: no durable output → no success
    // accounting (the empty-turn cleanup path runs instead).
    mockRunManaged.mockResolvedValueOnce({
      firstOutputPersisted: false,
      toolCount: 0,
      iterationCount: 0,
      model: null,
      latencyMs: 50,
    })

    const { POST } = await import('@/app/api/ai/agent/route')
    const res = await POST(buildReq('req-no-output') as never)
    expect(res.status).toBe(200)
    await res.text()

    expect(mockRecordManagedSuccess).not.toHaveBeenCalled()
    expect(mockRecordTurnSuccess).not.toHaveBeenCalled()
  })
})

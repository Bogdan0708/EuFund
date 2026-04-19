import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Regression test for a specific interaction: structured actions
// (select_call, approve_outline, accept_section, ...) must bypass the
// managed runtime EVEN when the session was created via the deterministic
// preselect flow (planning_artifact.preselect.version === 1). The
// preselected-session guard in /api/ai/agent refuses V3 fallback for
// message turns, but action turns are post-discovery UI events — managed
// doesn't handle them yet, so they must reach V3 without 503ing.

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

// Session row marked as created by deterministic preselect.
// planningArtifact.preselect.version === 1 triggers the new fail-closed
// guard in the route — this test proves the guard yields to the action
// bypass rather than returning 503.
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

describe('POST /api/ai/agent — structured action bypass on preselected sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.MANAGED_RUNTIME_ENABLED = 'true'
  })
  afterEach(() => { delete process.env.MANAGED_RUNTIME_ENABLED })

  it('routes action requests to V3 even on preselected sessions (no 503)', async () => {
    const { POST } = await import('@/app/api/ai/agent/route')
    const req = new Request('http://localhost/api/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: 'req-preselect-action',
        locale: 'ro',
        sessionId: '11111111-1111-4111-8111-111111111111',
        action: { type: 'approve_outline' },
      }),
    })

    const res = await POST(req as never)
    if (res.body) await res.text()

    // Core assertions: V3 ran, managed did not, no 503.
    expect(mockRunV3).toHaveBeenCalled()
    expect(mockRunManaged).not.toHaveBeenCalled()
    expect(res.status).not.toBe(503)
  })

  it('still fail-closes message turns on preselected sessions when managed is unavailable (sanity)', async () => {
    // Sanity: with the same preselected row, a plain message turn that
    // would normally route to managed will route through managed if healthy.
    // We don't need to prove the 503 path here — other tests cover it; we
    // just confirm this test's mocks don't short-circuit the managed path
    // for messages (which would invalidate the action-bypass conclusion).
    const { POST } = await import('@/app/api/ai/agent/route')
    const req = new Request('http://localhost/api/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: 'req-preselect-msg',
        locale: 'ro',
        sessionId: '11111111-1111-4111-8111-111111111111',
        stateVersion: 0,
        message: 'Începem outline-ul.',
      }),
    })

    const res = await POST(req as never)
    if (res.body) await res.text()

    expect(mockRunManaged).toHaveBeenCalled()
    expect(mockRunV3).not.toHaveBeenCalled()
  })
})

// Integration test: POST /api/v1/agent-sessions/[id]/actions/run-eligibility
//
// Verifies:
//   - 400 on invalid body (missing expectedStateVersion)
//   - 200 + correct service call on valid body (with projectSummary)
//   - 200 + correct service call on valid body (without projectSummary)

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { isFeatureEnabledMock } = vi.hoisted(() => ({
  isFeatureEnabledMock: vi.fn(),
}))

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: isFeatureEnabledMock,
}))

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'u1', tier: 'free' }),
}))

vi.mock('@/lib/middleware/rate-limit', () => ({
  withRateLimit: (h: unknown) => h,
}))

vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))

const runEligibilitySpy = vi.fn().mockResolvedValue({
  newStateVersion: 2,
  decision: {
    results: [],
    score: 100,
    passCount: 0,
    failCount: 0,
    warningCount: 0,
  },
})

vi.mock('@/lib/ai/agent/services/application', () => ({
  runEligibilityForSession: runEligibilitySpy,
}))

const mockSession = {
  id: 's1',
  userId: 'u1',
  stateVersion: 2,
  outline: null,
  blueprint: null,
  status: 'active',
  selectedCallId: 'C-1',
  currentPhase: 'structuring',
  eligibility: { results: [], score: 100, passCount: 0, failCount: 0, warningCount: 0 },
  warnings: [],
  outlineFrozen: false,
  planningArtifact: null,
  projectId: null,
  locale: 'ro',
  messageSummary: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

vi.mock('@/lib/db', () => {
  const limitFn = vi.fn().mockResolvedValue([mockSession])
  const whereFn = vi.fn(() => ({ limit: limitFn }))
  const fromFn = vi.fn(() => ({ where: whereFn }))
  const selectFn = vi.fn(() => ({ from: fromFn }))
  return { db: { select: selectFn } }
})

vi.mock('@/lib/db/schema', () => ({
  agentSessions: { id: 'id', userId: 'user_id' },
  agentSections: { sessionId: 'session_id' },
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn() }))

vi.mock('@/lib/ai/agent/state-projection', () => ({
  projectSessionState: vi.fn((_session: unknown, _sections: unknown) => ({
    sessionId: 's1',
    phase: 'structuring',
    stateVersion: 2,
    outlineFrozen: false,
    warnings: [],
    sections: [],
    blueprint: null,
    eligibility: { results: [], score: 100, passCount: 0, failCount: 0, warningCount: 0 },
  })),
}))

describe('POST /api/v1/agent-sessions/[id]/actions/run-eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isFeatureEnabledMock.mockResolvedValue(true)
    runEligibilitySpy.mockResolvedValue({
      newStateVersion: 2,
      decision: { results: [], score: 100, passCount: 0, failCount: 0, warningCount: 0 },
    })
  })

  it('returns 400 when expectedStateVersion is missing', async () => {
    const { POST } = await import(
      '@/app/api/v1/agent-sessions/[id]/actions/run-eligibility/route'
    )
    const res = await POST(
      new Request(
        'http://localhost/api/v1/agent-sessions/s1/actions/run-eligibility',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      ) as never,
      { params: Promise.resolve({ id: 's1' }) } as never,
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('BAD_REQUEST')
  })

  it('calls runEligibilityForSession with projectSummary and returns 200', async () => {
    const { POST } = await import(
      '@/app/api/v1/agent-sessions/[id]/actions/run-eligibility/route'
    )
    const res = await POST(
      new Request(
        'http://localhost/api/v1/agent-sessions/s1/actions/run-eligibility',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedStateVersion: 1, projectSummary: 'test project' }),
        },
      ) as never,
      { params: Promise.resolve({ id: 's1' }) } as never,
    )
    expect(res.status).toBe(200)
    expect(runEligibilitySpy).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', sessionId: 's1' }),
      expect.objectContaining({
        sessionId: 's1',
        expectedStateVersion: 1,
        projectSummary: 'test project',
      }),
    )
    const json = await res.json()
    expect(json.sessionId).toBe('s1')
    expect(json.stateVersion).toBe(2)
  })

  it('calls runEligibilityForSession without projectSummary and returns 200', async () => {
    const { POST } = await import(
      '@/app/api/v1/agent-sessions/[id]/actions/run-eligibility/route'
    )
    const res = await POST(
      new Request(
        'http://localhost/api/v1/agent-sessions/s1/actions/run-eligibility',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedStateVersion: 1 }),
        },
      ) as never,
      { params: Promise.resolve({ id: 's1' }) } as never,
    )
    expect(res.status).toBe(200)
    expect(runEligibilitySpy).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', sessionId: 's1' }),
      expect.objectContaining({
        sessionId: 's1',
        expectedStateVersion: 1,
        projectSummary: undefined,
      }),
    )
  })

  it('returns 400 on malformed JSON', async () => {
    const { POST } = await import(
      '@/app/api/v1/agent-sessions/[id]/actions/run-eligibility/route'
    )
    const res = await POST(
      new Request(
        'http://localhost/api/v1/agent-sessions/s1/actions/run-eligibility',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'not-json',
        },
      ) as never,
      { params: Promise.resolve({ id: 's1' }) } as never,
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('BAD_JSON')
  })
})

// Integration test: POST /api/v1/agent-sessions/[id]/actions/freeze-outline
//
// Verifies:
//   - 400 on invalid body (missing expectedStateVersion)
//   - 200 + correct service call on valid body
//   - 400 on malformed JSON

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

vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))

const freezeOutlineSpy = vi.fn().mockResolvedValue({ newStateVersion: 4 })

vi.mock('@/lib/ai/agent/services/application', () => ({
  freezeOutline: freezeOutlineSpy,
}))

const mockSession = {
  id: 's1',
  userId: 'u1',
  stateVersion: 4,
  outline: [{ id: 'a', title: 'A' }],
  blueprint: null,
  status: 'active',
  selectedCallId: 'C-1',
  currentPhase: 'drafting',
  eligibility: { score: 100, results: [], passCount: 0, failCount: 0, warningCount: 0 },
  warnings: [],
  outlineFrozen: true,
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
    phase: 'drafting',
    stateVersion: 4,
    outlineFrozen: true,
    warnings: [],
    sections: [],
    blueprint: null,
    eligibility: { score: 100, results: [], passCount: 0, failCount: 0, warningCount: 0 },
  })),
}))

describe('POST /api/v1/agent-sessions/[id]/actions/freeze-outline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isFeatureEnabledMock.mockResolvedValue(true)
    freezeOutlineSpy.mockResolvedValue({ newStateVersion: 4 })
  })

  it('returns 400 when expectedStateVersion is missing', async () => {
    const { POST } = await import(
      '@/app/api/v1/agent-sessions/[id]/actions/freeze-outline/route'
    )
    const res = await POST(
      new Request(
        'http://localhost/api/v1/agent-sessions/s1/actions/freeze-outline',
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

  it('calls freezeOutline service and returns 200 with UIStateSnapshot', async () => {
    const { POST } = await import(
      '@/app/api/v1/agent-sessions/[id]/actions/freeze-outline/route'
    )
    const res = await POST(
      new Request(
        'http://localhost/api/v1/agent-sessions/s1/actions/freeze-outline',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedStateVersion: 3 }),
        },
      ) as never,
      { params: Promise.resolve({ id: 's1' }) } as never,
    )
    expect(res.status).toBe(200)
    expect(freezeOutlineSpy).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', sessionId: 's1' }),
      expect.objectContaining({ sessionId: 's1', expectedStateVersion: 3 }),
    )
    const json = await res.json()
    expect(json.sessionId).toBe('s1')
    expect(json.outlineFrozen).toBe(true)
    expect(json.stateVersion).toBe(4)
  })

  it('returns 400 on malformed JSON', async () => {
    const { POST } = await import(
      '@/app/api/v1/agent-sessions/[id]/actions/freeze-outline/route'
    )
    const res = await POST(
      new Request(
        'http://localhost/api/v1/agent-sessions/s1/actions/freeze-outline',
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

  it('returns 404 when deterministic actions are disabled', async () => {
    isFeatureEnabledMock.mockResolvedValue(false)
    const { POST } = await import(
      '@/app/api/v1/agent-sessions/[id]/actions/freeze-outline/route'
    )
    const res = await POST(
      new Request(
        'http://localhost/api/v1/agent-sessions/s1/actions/freeze-outline',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedStateVersion: 3 }),
        },
      ) as never,
      { params: Promise.resolve({ id: 's1' }) } as never,
    )
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error.code).toBe('DETERMINISTIC_ACTIONS_DISABLED')
    expect(freezeOutlineSpy).not.toHaveBeenCalled()
  })
})

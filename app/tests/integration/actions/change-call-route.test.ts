// Integration test: POST /api/v1/agent-sessions/[id]/actions/change-call
//
// Verifies:
//   - 400 on invalid body (missing newCallId)
//   - 400 on invalid body (missing expectedStateVersion)
//   - 200 on happy path — service called with correct args, snapshot returned

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

const changeCallSpy = vi.fn().mockResolvedValue({
  session: {
    id: 's1',
    userId: 'u1',
    stateVersion: 4,
    outline: null,
    blueprint: null,
    status: 'active',
    selectedCallId: 'C-2',
    currentPhase: 'research',
    eligibility: null,
    warnings: [],
    outlineFrozen: false,
    planningArtifact: null,
    projectId: null,
    locale: 'ro',
    messageSummary: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  sectionsDiscarded: 2,
  blueprintSource: 'none',
})

vi.mock('@/lib/ai/agent/services/change-call', () => ({
  changeCall: changeCallSpy,
}))

vi.mock('@/lib/db', () => {
  const where = vi.fn().mockResolvedValue([])
  const from = vi.fn(() => ({ where }))
  const select = vi.fn(() => ({ from }))
  return { db: { select } }
})

vi.mock('@/lib/db/schema', () => ({
  agentSections: { sessionId: 'session_id' },
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))

vi.mock('@/lib/ai/agent/state-projection', () => ({
  projectSessionState: vi.fn((_session: unknown, _sections: unknown) => ({
    sessionId: 's1',
    phase: 'research',
    stateVersion: 4,
    outlineFrozen: false,
    warnings: [],
    sections: [],
    blueprint: null,
    eligibility: null,
  })),
}))

describe('POST /api/v1/agent-sessions/[id]/actions/change-call', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isFeatureEnabledMock.mockResolvedValue(true)
    changeCallSpy.mockResolvedValue({
      session: {
        id: 's1',
        userId: 'u1',
        stateVersion: 4,
        outline: null,
        blueprint: null,
        status: 'active',
        selectedCallId: 'C-2',
        currentPhase: 'research',
        eligibility: null,
        warnings: [],
        outlineFrozen: false,
        planningArtifact: null,
        projectId: null,
        locale: 'ro',
        messageSummary: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      sectionsDiscarded: 2,
      blueprintSource: 'none',
    })
  })

  it('returns 400 when newCallId is missing', async () => {
    const { POST } = await import(
      '@/app/api/v1/agent-sessions/[id]/actions/change-call/route'
    )
    const res = await POST(
      new Request(
        'http://localhost/api/v1/agent-sessions/s1/actions/change-call',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedStateVersion: 3 }),
        },
      ) as never,
      { params: Promise.resolve({ id: 's1' }) } as never,
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('BAD_REQUEST')
  })

  it('returns 400 when expectedStateVersion is missing', async () => {
    const { POST } = await import(
      '@/app/api/v1/agent-sessions/[id]/actions/change-call/route'
    )
    const res = await POST(
      new Request(
        'http://localhost/api/v1/agent-sessions/s1/actions/change-call',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newCallId: 'C-2' }),
        },
      ) as never,
      { params: Promise.resolve({ id: 's1' }) } as never,
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('BAD_REQUEST')
  })

  it('returns 200 and calls service with correct args on happy path', async () => {
    const { POST } = await import(
      '@/app/api/v1/agent-sessions/[id]/actions/change-call/route'
    )
    const res = await POST(
      new Request(
        'http://localhost/api/v1/agent-sessions/s1/actions/change-call',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newCallId: 'C-2', expectedStateVersion: 3 }),
        },
      ) as never,
      { params: Promise.resolve({ id: 's1' }) } as never,
    )
    expect(res.status).toBe(200)
    expect(changeCallSpy).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', sessionId: 's1' }),
      expect.objectContaining({ sessionId: 's1', newCallId: 'C-2', expectedStateVersion: 3 }),
    )
    const body = await res.json()
    expect(body).toMatchObject({ sessionId: 's1', stateVersion: 4 })
  })

  it('returns 400 on malformed JSON', async () => {
    const { POST } = await import(
      '@/app/api/v1/agent-sessions/[id]/actions/change-call/route'
    )
    const res = await POST(
      new Request(
        'http://localhost/api/v1/agent-sessions/s1/actions/change-call',
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

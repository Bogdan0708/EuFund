// Integration test: POST /api/v1/agent-sessions/[id]/actions/rollback-section
//
// Verifies:
//   - 400 on invalid body (missing sectionKey)
//   - 400 on invalid body (missing targetVersion)
//   - 200 + correct service call on valid body
//   - 400 on malformed JSON

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'u1', tier: 'free' }),
}))

vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))

const rollbackSectionSpy = vi.fn().mockResolvedValue({
  content: 'old content',
  restoredVersion: 1,
  newStateVersion: 5,
})

vi.mock('@/lib/ai/agent/services/sections', () => ({
  rollbackSection: rollbackSectionSpy,
}))

const mockSession = {
  id: 's1',
  userId: 'u1',
  stateVersion: 5,
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
    stateVersion: 5,
    outlineFrozen: true,
    warnings: [],
    sections: [],
    blueprint: null,
    eligibility: { score: 100, results: [], passCount: 0, failCount: 0, warningCount: 0 },
  })),
}))

describe('POST /api/v1/agent-sessions/[id]/actions/rollback-section', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rollbackSectionSpy.mockResolvedValue({
      content: 'old content',
      restoredVersion: 1,
      newStateVersion: 5,
    })
  })

  it('returns 400 when sectionKey is missing', async () => {
    const { POST } = await import(
      '@/app/api/v1/agent-sessions/[id]/actions/rollback-section/route'
    )
    const res = await POST(
      new Request(
        'http://localhost/api/v1/agent-sessions/s1/actions/rollback-section',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetVersion: 1, expectedStateVersion: 4 }),
        },
      ) as never,
      { params: Promise.resolve({ id: 's1' }) } as never,
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('BAD_REQUEST')
  })

  it('returns 400 when targetVersion is missing', async () => {
    const { POST } = await import(
      '@/app/api/v1/agent-sessions/[id]/actions/rollback-section/route'
    )
    const res = await POST(
      new Request(
        'http://localhost/api/v1/agent-sessions/s1/actions/rollback-section',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sectionKey: 'a', expectedStateVersion: 4 }),
        },
      ) as never,
      { params: Promise.resolve({ id: 's1' }) } as never,
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('BAD_REQUEST')
  })

  it('calls rollbackSection service and returns 200 with UIStateSnapshot', async () => {
    const { POST } = await import(
      '@/app/api/v1/agent-sessions/[id]/actions/rollback-section/route'
    )
    const res = await POST(
      new Request(
        'http://localhost/api/v1/agent-sessions/s1/actions/rollback-section',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sectionKey: 'a', targetVersion: 1, expectedStateVersion: 4 }),
        },
      ) as never,
      { params: Promise.resolve({ id: 's1' }) } as never,
    )
    expect(res.status).toBe(200)
    expect(rollbackSectionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', sessionId: 's1' }),
      expect.objectContaining({ sessionId: 's1', sectionKey: 'a', targetVersion: 1, expectedStateVersion: 4 }),
    )
    const json = await res.json()
    expect(json.sessionId).toBe('s1')
    expect(json.outlineFrozen).toBe(true)
    expect(json.stateVersion).toBe(5)
  })

  it('returns 400 on malformed JSON', async () => {
    const { POST } = await import(
      '@/app/api/v1/agent-sessions/[id]/actions/rollback-section/route'
    )
    const res = await POST(
      new Request(
        'http://localhost/api/v1/agent-sessions/s1/actions/rollback-section',
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

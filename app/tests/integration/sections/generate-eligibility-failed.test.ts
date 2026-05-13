// Integration test: POST /api/v1/agent-sessions/[id]/sections/generate
// Precondition failure: ELIGIBILITY_FAILED
//
// Verifies that when ensureDraftingReady returns ok=false with
// code='ELIGIBILITY_FAILED', the route returns 409 with the correct
// error envelope including bilingual messages and eligibility details.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'u1', tier: 'free' }),
}))
vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { child: vi.fn(() => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })) },
}))

const mockSession = {
  id: 's1',
  userId: 'u1',
  stateVersion: 0,
  outline: [
    {
      id: 'a',
      title: 'A',
      description: '',
      order: 1,
      generationOrder: 1,
      importance: 'standard',
      expectedLength: 'medium',
      dependsOn: [],
      modelHint: 'light',
      mandatory: true,
      confidence: 0.9,
    },
  ],
  blueprint: null,
  status: 'active',
  selectedCallId: 'C-1',
  currentPhase: 'structuring',
  eligibility: null,
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
  const sessionsWhereFn = vi.fn(() => ({ limit: limitFn }))
  const sectionsWhereFn = vi.fn().mockResolvedValue([])
  let callCount = 0
  const fromFn = vi.fn(() => {
    callCount++
    if (callCount % 2 === 1) {
      return { where: sessionsWhereFn }
    }
    return { where: sectionsWhereFn }
  })
  const selectFn = vi.fn(() => {
    callCount = 0
    return { from: fromFn }
  })
  return { db: { select: selectFn } }
})

vi.mock('@/lib/db/schema', () => ({
  agentSessions: { id: 'id', userId: 'user_id' },
  agentSections: { sessionId: 'session_id' },
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn() }))

const ensureSpy = vi.fn().mockResolvedValue({
  ok: false,
  code: 'ELIGIBILITY_FAILED',
  details: { score: 50, passCount: 0, failCount: 1, warningCount: 0, results: [] },
})
vi.mock('@/lib/ai/agent/services/ensure-drafting-ready', () => ({
  ensureDraftingReady: ensureSpy,
}))

vi.mock('@/lib/ai/agent/services/sections', () => ({ saveSectionDraft: vi.fn() }))
vi.mock('@/lib/ai/agent/services/section-generation', () => ({
  streamSectionGeneration: vi.fn(),
}))
vi.mock('@/lib/ai/agent/state-projection', () => ({ projectSessionState: vi.fn() }))
vi.mock('@/lib/monitoring/metrics', () => ({
  trackGenerateSectionTotal: vi.fn(),
  trackGenerateSectionLatency: vi.fn(),
}))

describe('POST /sections/generate — eligibility failed', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 409 ELIGIBILITY_FAILED with details', async () => {
    ensureSpy.mockResolvedValue({
      ok: false,
      code: 'ELIGIBILITY_FAILED',
      details: { score: 50, passCount: 0, failCount: 1, warningCount: 0, results: [] },
    })

    const { POST } = await import(
      '@/app/api/v1/agent-sessions/[id]/sections/generate/route'
    )
    const res = await POST(
      new Request(
        'http://localhost/api/v1/agent-sessions/s1/sections/generate',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedStateVersion: 0 }),
        },
      ) as never,
      { params: Promise.resolve({ id: 's1' }) } as never,
    )
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error.code).toBe('ELIGIBILITY_FAILED')
    expect(json.error.messageRo).toBeTruthy()
    expect(json.error.messageEn).toBeTruthy()
    expect(json.error.details).toMatchObject({ failCount: 1 })
  })
})

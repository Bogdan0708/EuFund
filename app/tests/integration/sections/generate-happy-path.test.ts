// Integration test: POST /api/v1/agent-sessions/[id]/sections/generate (happy path)
//
// Verifies the SSE stream emits start → delta(s) → done in the right
// shape when ensureDraftingReady returns ok and the generator produces
// content. saveSectionDraft is called with the post-saga stateVersion.

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
  stateVersion: 5,
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
  currentPhase: 'drafting',
  eligibility: { score: 100, results: [], passCount: 1, failCount: 0, warningCount: 0 },
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
  const sessionsWhereFn = vi.fn(() => ({ limit: limitFn }))
  const sectionsWhereFn = vi.fn().mockResolvedValue([])
  let callCount = 0
  const fromFn = vi.fn(() => {
    callCount++
    if (callCount % 2 === 1) {
      // odd calls: sessions select
      return { where: sessionsWhereFn }
    }
    // even calls: sections select
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
  ok: true,
  sectionSpec: {
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
  stateVersion: 6,
})
vi.mock('@/lib/ai/agent/services/ensure-drafting-ready', () => ({
  ensureDraftingReady: ensureSpy,
}))

const saveSpy = vi.fn().mockResolvedValue({
  sectionId: 'sec-1',
  versionNumber: 1,
  newStateVersion: 7,
})
vi.mock('@/lib/ai/agent/services/sections', () => ({
  saveSectionDraft: saveSpy,
}))

vi.mock('@/lib/ai/agent/services/section-generation', () => ({
  streamSectionGeneration: vi.fn(async function* () {
    yield { type: 'delta', content: 'Hello ' }
    yield { type: 'delta', content: 'world.' }
    yield { type: 'final', content: 'Hello world.', model: 'claude-sonnet-4-6' }
  }),
}))

vi.mock('@/lib/ai/agent/state-projection', () => ({
  projectSessionState: vi.fn(() => ({
    sessionId: 's1',
    phase: 'drafting',
    stateVersion: 7,
    outlineFrozen: true,
    warnings: [],
    sections: [],
    blueprint: null,
    eligibility: null,
  })),
}))

vi.mock('@/lib/monitoring/metrics', () => ({
  trackGenerateSectionTotal: vi.fn(),
  trackGenerateSectionLatency: vi.fn(),
}))

describe('POST /api/v1/agent-sessions/[id]/sections/generate happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureSpy.mockResolvedValue({
      ok: true,
      sectionSpec: {
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
      stateVersion: 6,
    })
    saveSpy.mockResolvedValue({ sectionId: 'sec-1', versionNumber: 1, newStateVersion: 7 })
  })

  it('streams start → delta(s) → done', async () => {
    const { POST } = await import(
      '@/app/api/v1/agent-sessions/[id]/sections/generate/route'
    )
    const res = await POST(
      new Request(
        'http://localhost/api/v1/agent-sessions/s1/sections/generate',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sectionKey: 'a', expectedStateVersion: 5 }),
        },
      ) as never,
      { params: Promise.resolve({ id: 's1' }) } as never,
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')

    const text = await new Response(res.body).text()
    expect(text).toMatch(/event: start\n/)
    expect(text).toMatch(/event: delta\n/)
    expect(text).toMatch(/event: done\n/)

    // Two delta events emitted
    const deltaMatches = text.match(/event: delta\n/g) ?? []
    expect(deltaMatches.length).toBe(2)

    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', sessionId: 's1' }),
      expect.objectContaining({
        sessionId: 's1',
        sectionKey: 'a',
        content: 'Hello world.',
        expectedStateVersion: 6,
      }),
    )
  })
})

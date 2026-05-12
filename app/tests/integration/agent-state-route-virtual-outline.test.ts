// app/tests/integration/agent-state-route-virtual-outline.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', tier: 'free' }),
}))

const mockSession = {
  id: 'sess-1', userId: 'user-1', projectId: null, status: 'active', locale: 'ro',
  selectedCallId: 'C-1', currentPhase: 'structuring',
  blueprint: null, eligibility: null,
  outline: [
    { id: 'a', title: 'A', description: '', order: 1, generationOrder: 1,
      importance: 'standard', expectedLength: 'medium', dependsOn: [],
      modelHint: 'light', mandatory: true, confidence: 0.9 },
  ],
  warnings: [], planningArtifact: null, outlineFrozen: false,
  messageSummary: null, stateVersion: 1,
  createdAt: new Date(0), updatedAt: new Date(0),
}

vi.mock('@/lib/db', () => {
  const sessionRowsLimit = vi.fn().mockResolvedValue([mockSession])
  const sessionRowsWhere = vi.fn(() => ({ limit: sessionRowsLimit }))
  const sessionFrom = vi.fn(() => ({ where: sessionRowsWhere }))

  // The second select() call is for agent_sections — return [] (no rows).
  const sectionsWhere = vi.fn(() => Promise.resolve([]))
  const sectionsFrom = vi.fn(() => ({ where: sectionsWhere }))

  let selectCallCount = 0
  const select = vi.fn(() => {
    selectCallCount += 1
    return selectCallCount === 1
      ? { from: sessionFrom }
      : { from: sectionsFrom }
  })
  return { db: { select } }
})

describe('GET /api/ai/agent/state', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns virtual pending sections when outline is set and rows are empty', async () => {
    const { GET } = await import('@/app/api/ai/agent/state/route')
    const req = new NextRequest('http://localhost/api/ai/agent/state?sessionId=sess-1')
    const res = await GET(req)
    const body = await res.json()
    expect(body.sections).toEqual([
      { sectionKey: 'a', title: 'A', status: 'pending', documentOrder: 1, content: null },
    ])
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockRequireAuth, mockIsFeatureEnabled, mockRankCandidates, mockInitializeSession } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockRankCandidates: vi.fn(),
  mockInitializeSession: vi.fn(),
}))

vi.mock('@/lib/auth/helpers', () => ({ requireAuth: mockRequireAuth }))
vi.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: mockIsFeatureEnabled }))
vi.mock('@/lib/ai/agent/services/preselect', async () => {
  const actual = await vi.importActual<any>('@/lib/ai/agent/services/preselect')
  return {
    ...actual,
    rankCandidates: mockRankCandidates,
    initializeSession: mockInitializeSession,
  }
})
vi.mock('@/lib/middleware/rate-limit', () => ({
  withRateLimit: (_opts: any, handler: any) => handler,
}))

import { POST } from '@/app/api/v1/projects/preselect/route'

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'u@test', name: 'U', isPlatformAdmin: false }

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireAuth.mockResolvedValue(USER)
  mockIsFeatureEnabled.mockResolvedValue(true)
})

const req = (body: unknown) =>
  new NextRequest('http://localhost/api/v1/projects/preselect', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

describe('POST /api/v1/projects/preselect — rank mode', () => {
  it('returns kind=selected when ranker produces a clear winner', async () => {
    mockRankCandidates.mockResolvedValue([
      { callId: 'top', title: 'Top', score: 0.8 },
      { callId: 'two', title: 'Two', score: 0.5 },
    ])
    mockInitializeSession.mockResolvedValue({
      sessionId: 'session-xyz', phase: 'structuring', blueprintKind: 'structured',
    })

    const res = await POST(req({
      description: 'a project description that is at least forty chars long',
      locale: 'ro',
    }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.kind).toBe('selected')
    expect(body.sessionId).toBe('session-xyz')
    expect(body.selectedCallId).toBe('top')
    expect(body.phase).toBe('structuring')
    expect(body.blueprintKind).toBe('structured')
    expect(body.candidates).toHaveLength(2)
  })

  it('returns kind=ambiguous without creating a session', async () => {
    mockRankCandidates.mockResolvedValue([
      { callId: 'a', title: 'A', score: 0.8 },
      { callId: 'b', title: 'B', score: 0.78 },
      { callId: 'c', title: 'C', score: 0.6 },
    ])

    const res = await POST(req({
      description: 'a project description that is at least forty chars long',
      locale: 'ro',
    }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.kind).toBe('ambiguous')
    expect(body.candidates).toHaveLength(3)
    expect(mockInitializeSession).not.toHaveBeenCalled()
  })

  it('returns kind=no_match when top score below floor', async () => {
    mockRankCandidates.mockResolvedValue([{ callId: 'x', title: 'X', score: 0.1 }])

    const res = await POST(req({
      description: 'a project description that is at least forty chars long',
      locale: 'ro',
    }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.kind).toBe('no_match')
    expect(body.reason).toBe('below_score_floor')
    expect(mockInitializeSession).not.toHaveBeenCalled()
  })
})

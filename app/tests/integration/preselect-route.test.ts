import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockRequireAuth, mockIsFeatureEnabled, mockRankCandidates, mockInitializeSession, mockSearchCalls } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockRankCandidates: vi.fn(),
  mockInitializeSession: vi.fn(),
  mockSearchCalls: vi.fn(),
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
vi.mock('@/lib/ai/agent/services/evidence', () => ({
  searchCalls: mockSearchCalls,
}))
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

describe('POST /api/v1/projects/preselect — error paths', () => {
  it('returns 401 when unauthenticated', async () => {
    mockRequireAuth.mockRejectedValue(new Error('unauthorized'))
    const res = await POST(req({ description: 'x'.repeat(50), locale: 'ro' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('returns 404 PRESELECT_DISABLED when preselect flag off', async () => {
    mockIsFeatureEnabled.mockImplementation(async (key) =>
      key === 'managed_agent_writes_enabled',
    )
    const res = await POST(req({ description: 'x'.repeat(50), locale: 'ro' }))
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('PRESELECT_DISABLED')
  })

  it('returns 404 PRESELECT_DISABLED when writes flag off', async () => {
    mockIsFeatureEnabled.mockImplementation(async (key) =>
      key === 'deterministic_preselect_enabled',
    )
    const res = await POST(req({ description: 'x'.repeat(50), locale: 'ro' }))
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('PRESELECT_DISABLED')
  })

  it('returns 400 DESCRIPTION_TOO_SHORT when description below min length', async () => {
    const res = await POST(req({ description: 'short', locale: 'ro' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('DESCRIPTION_TOO_SHORT')
  })

  it('returns 400 INVALID_REQUEST on malformed body', async () => {
    const res = await POST(new NextRequest('http://localhost/x', {
      method: 'POST', body: 'not json', headers: { 'content-type': 'application/json' },
    }))
    expect(res.status).toBe(400)
  })

  it('returns 400 CONFLICTING_MODE when sessionId and confirmCandidateId both present', async () => {
    const res = await POST(req({
      description: 'x'.repeat(50), locale: 'ro',
      sessionId: '00000000-0000-4000-8000-000000000000',
      expectedStateVersion: 0,
      confirmCandidateId: 'abc',
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('CONFLICTING_MODE')
  })

  it('returns 400 EXPECTED_STATE_VERSION_REQUIRED when sessionId without expectedStateVersion', async () => {
    const res = await POST(req({
      description: 'x'.repeat(50), locale: 'ro',
      sessionId: '00000000-0000-4000-8000-000000000000',
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('EXPECTED_STATE_VERSION_REQUIRED')
  })

  it('returns 503 PRESELECT_UNAVAILABLE when rankCandidates throws', async () => {
    mockRankCandidates.mockRejectedValue(new Error('qdrant down'))
    const res = await POST(req({ description: 'x'.repeat(50), locale: 'ro' }))
    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe('PRESELECT_UNAVAILABLE')
  })
})

describe('POST /api/v1/projects/preselect — confirm mode', () => {
  it('creates session with the specified confirmCandidateId, skips ranker', async () => {
    mockSearchCalls.mockResolvedValue({
      matches: [{ callId: 'chosen-call-id', title: 'Chosen', program: 'P', score: 0.9, snippet: '', sourceUrl: undefined }],
    })
    mockInitializeSession.mockResolvedValue({
      sessionId: 'session-confirm', phase: 'structuring', blueprintKind: 'structured',
    })

    const res = await POST(req({
      description: 'x'.repeat(50),
      locale: 'ro',
      confirmCandidateId: 'chosen-call-id',
    }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.kind).toBe('selected')
    expect(body.selectedCallId).toBe('chosen-call-id')
    expect(mockRankCandidates).not.toHaveBeenCalled()
    expect(mockSearchCalls).toHaveBeenCalledWith(expect.any(Object), 'chosen-call-id', expect.any(Object))
    expect(mockInitializeSession).toHaveBeenCalledWith(expect.objectContaining({
      selectedCallId: 'chosen-call-id',
      candidates: [{ callId: 'chosen-call-id', title: 'chosen-call-id', score: 1 }],
      excludeCallIdsApplied: [],
    }))
  })

  it('returns 400 INVALID_CALL_ID when confirmCandidateId is not a real indexed call', async () => {
    mockSearchCalls.mockResolvedValue({
      matches: [{ callId: 'something-else', title: 'X', program: 'P', score: 0.2, snippet: '', sourceUrl: undefined }],
    })

    const res = await POST(req({
      description: 'x'.repeat(50),
      locale: 'ro',
      confirmCandidateId: 'bogus-call-id',
    }))

    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('INVALID_CALL_ID')
    expect(mockInitializeSession).not.toHaveBeenCalled()
  })

  it('returns 503 PRESELECT_UNAVAILABLE when the existence check fails', async () => {
    mockSearchCalls.mockRejectedValue(new Error('vector store down'))

    const res = await POST(req({
      description: 'x'.repeat(50),
      locale: 'ro',
      confirmCandidateId: 'any',
    }))

    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe('PRESELECT_UNAVAILABLE')
    expect(mockInitializeSession).not.toHaveBeenCalled()
  })
})

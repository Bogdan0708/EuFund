import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ConcurrencyError, ValidationError } from '@/lib/ai/agent/services/errors'
import { Errors } from '@/lib/errors'

const { mockRequireAuth, mockIsFeatureEnabled, mockRankCandidates, mockInitializeSession, mockSearchCalls, mockSetSelectedCall, mockEnforceRateLimit } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockRankCandidates: vi.fn(),
  mockInitializeSession: vi.fn(),
  mockSearchCalls: vi.fn(),
  mockSetSelectedCall: vi.fn(),
  mockEnforceRateLimit: vi.fn(),
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
vi.mock('@/lib/ai/agent/services/application', () => ({
  setSelectedCall: mockSetSelectedCall,
}))
vi.mock('@/lib/middleware/rate-limit', () => ({
  enforceRateLimit: mockEnforceRateLimit,
}))

import { POST } from '@/app/api/v1/projects/preselect/route'

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'u@test', name: 'U', isPlatformAdmin: false }

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireAuth.mockResolvedValue(USER)
  mockIsFeatureEnabled.mockResolvedValue(true)
  // Default rate limit pass-through
  mockEnforceRateLimit.mockResolvedValue({ ok: true, headers: {} })
  // Route gates on MANAGED_RUNTIME_ENABLED env to prevent a DB flag flip
  // from leaking managed-runtime traffic into production. Tests simulate the
  // pilot environment where the env is set.
  process.env.MANAGED_RUNTIME_ENABLED = 'true'
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
    // requireAuth() throws Errors.unauthorized() — a FondEUError with
    // code='UNAUTHORIZED'. Must use the real class, not a plain Error
    // (the route discriminates via instanceof + code).
    mockRequireAuth.mockRejectedValue(Errors.unauthorized())
    const res = await POST(req({ description: 'x'.repeat(50), locale: 'ro' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('returns 500 AUTH_CHECK_FAILED when requireAuth throws a non-auth error', async () => {
    mockRequireAuth.mockRejectedValue(new Error('db connection refused'))
    const res = await POST(req({ description: 'x'.repeat(50), locale: 'ro' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error.code).toBe('AUTH_CHECK_FAILED')
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

  it('returns 404 PRESELECT_DISABLED when managed_agent_enabled flag off', async () => {
    mockIsFeatureEnabled.mockImplementation(async (key) =>
      key !== 'managed_agent_enabled',
    )
    const res = await POST(req({ description: 'x'.repeat(50), locale: 'ro' }))
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('PRESELECT_DISABLED')
  })

  it('returns 404 PRESELECT_DISABLED when MANAGED_RUNTIME_ENABLED env is unset', async () => {
    delete process.env.MANAGED_RUNTIME_ENABLED
    const res = await POST(req({ description: 'x'.repeat(50), locale: 'ro' }))
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('PRESELECT_DISABLED')
  })

  it('propagates the rate-limit response when enforceRateLimit rejects', async () => {
    const limitResp = new Response(
      JSON.stringify({ error: { code: 'RATE_LIMITED' } }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    )
    mockEnforceRateLimit.mockResolvedValue({ ok: false, response: limitResp })
    const res = await POST(req({ description: 'x'.repeat(50), locale: 'ro' }))
    expect(res.status).toBe(429)
  })

  it('rate-limits per user (passes keySuffix: user.id)', async () => {
    await POST(req({ description: 'x'.repeat(50), locale: 'ro' }))
    expect(mockEnforceRateLimit).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ keyPrefix: 'preselect', keySuffix: USER.id }),
    )
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
    // Existence probe uses a filtered Qdrant search, not semantic similarity.
    expect(mockSearchCalls).toHaveBeenCalledWith(
      expect.any(Object),
      'chosen-call-id',
      expect.objectContaining({ callId: 'chosen-call-id' }),
    )
    expect(mockInitializeSession).toHaveBeenCalledWith(expect.objectContaining({
      selectedCallId: 'chosen-call-id',
      candidates: [{ callId: 'chosen-call-id', title: 'chosen-call-id', score: 1 }],
      excludeCallIdsApplied: [],
    }))
  })

  it('returns 400 INVALID_CALL_ID when confirmCandidateId is not a real indexed call', async () => {
    // Both probes (filtered + unfiltered fallback) return no matching callId.
    mockSearchCalls.mockResolvedValue({ matches: [] })

    const res = await POST(req({
      description: 'x'.repeat(50),
      locale: 'ro',
      confirmCandidateId: 'bogus-call-id',
    }))

    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('INVALID_CALL_ID')
    expect(mockInitializeSession).not.toHaveBeenCalled()
  })

  it('confirms callIds derived from metadata.sourceId via the unfiltered fallback probe', async () => {
    // Real-world: the ambiguous picker surfaced a candidate whose metadata
    // had no callId — searchCalls emitted callId from sourceId. The filtered
    // probe returns empty (no metadata.callId match), but the unfiltered
    // fallback finds the same point and emits the target callId.
    mockSearchCalls
      .mockResolvedValueOnce({ matches: [] }) // filtered probe — empty
      .mockResolvedValueOnce({
        matches: [
          { callId: 'sourceid-call', title: 'From sourceId', program: 'P', score: 0.2, snippet: '', sourceUrl: undefined },
        ],
      })
    mockInitializeSession.mockResolvedValue({
      sessionId: 'session-xyz', phase: 'structuring', blueprintKind: 'structured',
    })

    const res = await POST(req({
      description: 'x'.repeat(50),
      locale: 'ro',
      confirmCandidateId: 'sourceid-call',
    }))

    expect(res.status).toBe(200)
    expect((await res.json()).kind).toBe('selected')
    expect(mockSearchCalls).toHaveBeenCalledTimes(2)
    // First call was the filtered probe with callId filter.
    expect(mockSearchCalls.mock.calls[0][2]).toMatchObject({ callId: 'sourceid-call' })
    // Second call was the unfiltered fallback (no callId in opts).
    expect(mockSearchCalls.mock.calls[1][2]).not.toHaveProperty('callId')
    expect(mockInitializeSession).toHaveBeenCalled()
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

describe('POST /api/v1/projects/preselect — override mode', () => {
  const SESSION_ID = '22222222-2222-4222-8222-222222222222'

  it('re-ranks with excludeCallIds and mutates existing session via setSelectedCall', async () => {
    mockRankCandidates.mockResolvedValue([
      { callId: 'newtop', title: 'NewTop', score: 0.8 },
      { callId: 'other', title: 'Other', score: 0.5 },
    ])
    mockSetSelectedCall.mockResolvedValue({ newStateVersion: 3 })

    const res = await POST(req({
      description: 'x'.repeat(50),
      locale: 'ro',
      sessionId: SESSION_ID,
      expectedStateVersion: 2,
      excludeCallIds: ['oldcall'],
    }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.kind).toBe('selected')
    expect(body.sessionId).toBe(SESSION_ID)
    expect(body.selectedCallId).toBe('newtop')
    // Override responses deliberately omit blueprintKind + phase —
    // setSelectedCall does not change them and the client already has the real
    // values from the session state. Pin this to prevent future drift.
    expect(body).not.toHaveProperty('blueprintKind')
    expect(body).not.toHaveProperty('phase')
    expect(mockSetSelectedCall).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        sessionId: SESSION_ID,
        callId: 'newtop',
        expectedStateVersion: 2,
      }),
    )
    expect(mockInitializeSession).not.toHaveBeenCalled()
  })

  it('returns 409 OUTLINE_FROZEN when setSelectedCall throws the policy error', async () => {
    mockRankCandidates.mockResolvedValue([{ callId: 'x', title: 'X', score: 0.9 }])
    mockSetSelectedCall.mockRejectedValue(
      new ValidationError('outlineFrozen', 'outline frozen', 'POLICY_OUTLINE_ALREADY_FROZEN'),
    )

    const res = await POST(req({
      description: 'x'.repeat(50),
      locale: 'ro',
      sessionId: SESSION_ID,
      expectedStateVersion: 2,
    }))
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('OUTLINE_FROZEN')
  })

  it('returns 409 CONCURRENCY_CONFLICT on stateVersion mismatch', async () => {
    mockRankCandidates.mockResolvedValue([{ callId: 'x', title: 'X', score: 0.9 }])
    mockSetSelectedCall.mockRejectedValue(new ConcurrencyError(1, 3))

    const res = await POST(req({
      description: 'x'.repeat(50),
      locale: 'ro',
      sessionId: SESSION_ID,
      expectedStateVersion: 1,
    }))
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('CONCURRENCY_CONFLICT')
  })

  it('falls back from selected → ambiguous when excludeCallIds removes the clear winner', async () => {
    mockRankCandidates.mockResolvedValue([
      { callId: 'a', title: 'A', score: 0.75 },
      { callId: 'b', title: 'B', score: 0.73 },
      { callId: 'c', title: 'C', score: 0.5 },
    ])

    const res = await POST(req({
      description: 'x'.repeat(50),
      locale: 'ro',
      sessionId: SESSION_ID,
      expectedStateVersion: 2,
      excludeCallIds: ['oldcall'],
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.kind).toBe('ambiguous')
    expect(body.candidates.map((c: any) => c.callId)).toEqual(['a', 'b', 'c'])
    expect(mockSetSelectedCall).not.toHaveBeenCalled()
  })

  it('returns 500 OVERRIDE_FAILED on unclassified setSelectedCall errors', async () => {
    mockRankCandidates.mockResolvedValue([{ callId: 'x', title: 'X', score: 0.9 }])
    mockSetSelectedCall.mockRejectedValue(new Error('unexpected boom'))

    const res = await POST(req({
      description: 'x'.repeat(50),
      locale: 'ro',
      sessionId: SESSION_ID,
      expectedStateVersion: 2,
    }))
    expect(res.status).toBe(500)
    expect((await res.json()).error.code).toBe('OVERRIDE_FAILED')
  })
})

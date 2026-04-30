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

  it('attaches X-RateLimit-* headers to successful responses', async () => {
    mockEnforceRateLimit.mockResolvedValue({
      ok: true,
      headers: {
        'X-RateLimit-Limit': '10',
        'X-RateLimit-Remaining': '7',
        'X-RateLimit-Reset': '1234567890',
      },
    })
    mockRankCandidates.mockResolvedValue([{ callId: 'top', title: 'T', score: 0.8 }])
    mockInitializeSession.mockResolvedValue({
      sessionId: 's', phase: 'structuring', blueprintKind: 'structured',
    })

    const res = await POST(req({ description: 'x'.repeat(50), locale: 'ro' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('X-RateLimit-Limit')).toBe('10')
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('7')
    expect(res.headers.get('X-RateLimit-Reset')).toBe('1234567890')
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

  // Historical note: sessionId + confirmCandidateId was previously rejected
  // as CONFLICTING_MODE. That turned out to be wrong — it blocked the
  // legitimate "user picked a candidate from an override-mode ambiguous
  // response" flow. See the confirm-override tests below.

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
    // Description-ranked search (probe 1) finds the target — its score is
    // similarity-to-description, the only meaningful signal for telemetry.
    mockSearchCalls.mockResolvedValueOnce({
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
    // First probe: description search (no filter), query=description.
    expect(mockSearchCalls.mock.calls[0][1]).toBe('x'.repeat(50))
    expect(mockSearchCalls.mock.calls[0][2]).toMatchObject({ maxResults: 25 })
    expect(mockSearchCalls.mock.calls[0][2]).not.toHaveProperty('callId')
    expect(mockInitializeSession).toHaveBeenCalledWith(expect.objectContaining({
      selectedCallId: 'chosen-call-id',
      // Score comes from the description-ranked search, NOT the callId-string
      // query that the old findMatchedCall ran. Real similarity-to-description.
      candidates: [{ callId: 'chosen-call-id', title: 'Chosen', score: 0.9 }],
      selectedScore: 0.9,
      excludeCallIdsApplied: [],
    }))
  })

  it('returns 400 INVALID_CALL_ID when all four existence prongs reject', async () => {
    // Probe 1 (description search) and probes 2-4 (callId / callCode /
    // sourceId filters) all return no matching callId — genuinely absent.
    mockSearchCalls.mockResolvedValue({ matches: [] })

    const res = await POST(req({
      description: 'x'.repeat(50),
      locale: 'ro',
      confirmCandidateId: 'bogus-call-id',
    }))

    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('INVALID_CALL_ID')
    expect(mockSearchCalls).toHaveBeenCalledTimes(4)
    expect(mockInitializeSession).not.toHaveBeenCalled()
  })

  it('confirms callIds via the metadata.callId identifier probe with score=0', async () => {
    // Description search misses (target not in top-25); callId filter hits.
    // Score is sentinel 0 because we only have similarity-to-callId, which
    // is not a meaningful signal — flagging it lets dashboards distinguish
    // identifier-only confirmations from real description matches.
    mockSearchCalls
      .mockResolvedValueOnce({ matches: [] }) // probe 1: description search
      .mockResolvedValueOnce({                // probe 2: metadata.callId filter
        matches: [
          { callId: 'callid-call', title: 'From callId', program: 'P', score: 0.95, snippet: '', sourceUrl: undefined },
        ],
      })
    mockInitializeSession.mockResolvedValue({
      sessionId: 'session-xyz', phase: 'structuring', blueprintKind: 'structured',
    })

    const res = await POST(req({
      description: 'x'.repeat(50),
      locale: 'ro',
      confirmCandidateId: 'callid-call',
    }))

    expect(res.status).toBe(200)
    expect((await res.json()).kind).toBe('selected')
    expect(mockSearchCalls).toHaveBeenCalledTimes(2)
    expect(mockSearchCalls.mock.calls[0][2]).not.toHaveProperty('callId') // description
    expect(mockSearchCalls.mock.calls[1][2]).toMatchObject({ callId: 'callid-call' })
    // Score sentinel: identifier-only match gets score=0, NOT the 0.95 from
    // the filter-by-callId search (that's similarity-to-id-string, junk).
    expect(mockInitializeSession).toHaveBeenCalledWith(expect.objectContaining({
      selectedScore: 0,
      candidates: [{ callId: 'callid-call', title: 'From callId', score: 0 }],
    }))
  })

  it('confirms callIds via the metadata.callCode authoritative prong with score=0', async () => {
    // Bulk-ingested points often carry callCode as the primary identifier.
    // Probe 1 (description) and probe 2 (callId filter) miss; probe 3
    // (callCode filter) hits. Sentinel score=0.
    mockSearchCalls
      .mockResolvedValueOnce({ matches: [] }) // probe 1: description
      .mockResolvedValueOnce({ matches: [] }) // probe 2: callId filter
      .mockResolvedValueOnce({                // probe 3: callCode filter
        matches: [
          { callId: 'callcode-call', title: 'From callCode', program: 'P', score: 0.7, snippet: '', sourceUrl: undefined },
        ],
      })
    mockInitializeSession.mockResolvedValue({
      sessionId: 'session-xyz', phase: 'structuring', blueprintKind: 'structured',
    })

    const res = await POST(req({
      description: 'x'.repeat(50),
      locale: 'ro',
      confirmCandidateId: 'callcode-call',
    }))

    expect(res.status).toBe(200)
    expect((await res.json()).kind).toBe('selected')
    expect(mockSearchCalls).toHaveBeenCalledTimes(3)
    expect(mockSearchCalls.mock.calls[2][2]).toMatchObject({ callCode: 'callcode-call' })
    expect(mockInitializeSession).toHaveBeenCalledWith(expect.objectContaining({
      selectedScore: 0,
    }))
  })

  it('confirms callIds via the metadata.sourceId authoritative prong with score=0', async () => {
    // Probe 1 (description), 2 (callId), 3 (callCode) all miss; probe 4
    // (sourceId filter) hits. Sentinel score=0.
    mockSearchCalls
      .mockResolvedValueOnce({ matches: [] }) // probe 1: description
      .mockResolvedValueOnce({ matches: [] }) // probe 2: callId filter
      .mockResolvedValueOnce({ matches: [] }) // probe 3: callCode filter
      .mockResolvedValueOnce({                // probe 4: sourceId filter
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
    expect(mockSearchCalls).toHaveBeenCalledTimes(4)
    expect(mockSearchCalls.mock.calls[3][2]).toMatchObject({ sourceId: 'sourceid-call' })
    expect(mockInitializeSession).toHaveBeenCalledWith(expect.objectContaining({
      selectedScore: 0,
    }))
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

describe('POST /api/v1/projects/preselect — confirm-override mode', () => {
  const SESSION_ID = '33333333-3333-4333-8333-333333333333'

  it('validates + mutates existing session when sessionId + confirmCandidateId both present', async () => {
    // Prong 1 of the existence probe finds the call.
    mockSearchCalls.mockResolvedValueOnce({
      matches: [{ callId: 'picked-call', title: 'Picked', program: 'P', score: 0.9, snippet: '', sourceUrl: undefined }],
    })
    mockSetSelectedCall.mockResolvedValue({ newStateVersion: 7 })

    const res = await POST(req({
      description: 'x'.repeat(50),
      locale: 'ro',
      sessionId: SESSION_ID,
      expectedStateVersion: 5,
      confirmCandidateId: 'picked-call',
    }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.kind).toBe('selected')
    expect(body.sessionId).toBe(SESSION_ID)
    expect(body.selectedCallId).toBe('picked-call')
    // Override semantics: blueprintKind/phase are NOT returned because
    // setSelectedCall doesn't change them — same contract as plain override.
    expect(body).not.toHaveProperty('blueprintKind')
    expect(body).not.toHaveProperty('phase')

    // Mutated the existing session, did NOT create a new one.
    expect(mockSetSelectedCall).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        sessionId: SESSION_ID,
        callId: 'picked-call',
        expectedStateVersion: 5,
      }),
    )
    expect(mockInitializeSession).not.toHaveBeenCalled()
    expect(mockRankCandidates).not.toHaveBeenCalled()
  })

  it('returns 400 INVALID_CALL_ID when confirm-override sends an unindexed callId', async () => {
    mockSearchCalls.mockResolvedValue({ matches: [] })

    const res = await POST(req({
      description: 'x'.repeat(50),
      locale: 'ro',
      sessionId: SESSION_ID,
      expectedStateVersion: 5,
      confirmCandidateId: 'bogus',
    }))

    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('INVALID_CALL_ID')
    expect(mockSetSelectedCall).not.toHaveBeenCalled()
    expect(mockInitializeSession).not.toHaveBeenCalled()
  })

  it('returns 409 OUTLINE_FROZEN when confirm-override hits the policy gate', async () => {
    mockSearchCalls.mockResolvedValueOnce({
      matches: [{ callId: 'picked', title: 'P', program: 'P', score: 0.9, snippet: '', sourceUrl: undefined }],
    })
    mockSetSelectedCall.mockRejectedValue(
      new ValidationError('outlineFrozen', 'outline frozen', 'POLICY_OUTLINE_ALREADY_FROZEN'),
    )

    const res = await POST(req({
      description: 'x'.repeat(50),
      locale: 'ro',
      sessionId: SESSION_ID,
      expectedStateVersion: 5,
      confirmCandidateId: 'picked',
    }))

    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('OUTLINE_FROZEN')
  })

  it('returns 409 CONCURRENCY_CONFLICT when confirm-override has stale stateVersion', async () => {
    mockSearchCalls.mockResolvedValueOnce({
      matches: [{ callId: 'picked', title: 'P', program: 'P', score: 0.9, snippet: '', sourceUrl: undefined }],
    })
    mockSetSelectedCall.mockRejectedValue(new ConcurrencyError(5, 7))

    const res = await POST(req({
      description: 'x'.repeat(50),
      locale: 'ro',
      sessionId: SESSION_ID,
      expectedStateVersion: 5,
      confirmCandidateId: 'picked',
    }))

    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('CONCURRENCY_CONFLICT')
  })

  it('still requires expectedStateVersion on confirm-override', async () => {
    // Without expectedStateVersion, we can't issue a CAS mutation — the
    // EXPECTED_STATE_VERSION_REQUIRED guard fires before the mode dispatch.
    const res = await POST(req({
      description: 'x'.repeat(50),
      locale: 'ro',
      sessionId: SESSION_ID,
      confirmCandidateId: 'picked',
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('EXPECTED_STATE_VERSION_REQUIRED')
    expect(mockSetSelectedCall).not.toHaveBeenCalled()
  })
})

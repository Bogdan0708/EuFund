import { describe, it, expect, vi, beforeEach } from 'vitest';

const { initializeSessionMock, setSelectedCallMock } = vi.hoisted(() => ({
  initializeSessionMock: vi.fn(),
  setSelectedCallMock: vi.fn(),
}));

vi.mock('@/lib/ai/agent/services/preselect', () => ({
  initializeSession: initializeSessionMock,
  rankCandidates: vi.fn().mockResolvedValue([
    { callId: 'CODE-1', title: 'Call 1', score: 0.9, program: 'PNRR', sourceUrl: '' },
    { callId: 'CODE-2', title: 'Call 2', score: 0.5, program: 'PNRR', sourceUrl: '' },
  ]),
  decideSelection: vi.fn().mockReturnValue({
    kind: 'selected',
    callId: 'CODE-1',
    candidates: [{ callId: 'CODE-1', title: 'Call 1', score: 0.9 }],
  }),
  MIN_DESCRIPTION_LENGTH: 40,
}));
vi.mock('@/lib/ai/agent/services/application', () => ({ setSelectedCall: setSelectedCallMock }));
vi.mock('@/lib/auth/helpers', () => ({ requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }) }));
vi.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/middleware/rate-limit', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue({ ok: true, headers: {} }),
}));
vi.mock('@/lib/ai/agent/services/evidence', () => ({
  searchCalls: vi.fn().mockResolvedValue({ matches: [{ callId: 'CODE-1' }] }),
}));

import { POST } from '@/app/api/v1/projects/preselect/route';

describe('preselect route — projectId in response', () => {
  beforeEach(() => {
    process.env.MANAGED_RUNTIME_ENABLED = 'true';
    initializeSessionMock.mockReset();
    setSelectedCallMock.mockReset();
  });

  function makeReq(body: Record<string, unknown>) {
    return new Request('http://x/api/v1/projects/preselect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('rank+select branch — projectId in response (initializeSession path)', async () => {
    initializeSessionMock.mockResolvedValueOnce({
      sessionId: 'sess-1', phase: 'structuring', blueprintKind: 'structured', projectId: 'proj-1',
    });
    const res = await POST(makeReq({
      description: 'A description that is long enough to pass.',
      locale: 'ro',
    }) as any);
    const json = await res.json();
    expect(json).toMatchObject({ kind: 'selected', sessionId: 'sess-1', projectId: 'proj-1' });
  });

  it('rank+select branch — projectId: null when initializeSession reports null', async () => {
    initializeSessionMock.mockResolvedValueOnce({
      sessionId: 'sess-2', phase: 'research', blueprintKind: 'none', projectId: null,
    });
    const res = await POST(makeReq({
      description: 'A description that is long enough to pass.',
      locale: 'ro',
    }) as any);
    const json = await res.json();
    expect(json.projectId).toBeNull();
  });

  it('confirm-new branch — projectId in response (initializeSession path with confirmCandidateId)', async () => {
    initializeSessionMock.mockResolvedValueOnce({
      sessionId: 'sess-cn', phase: 'structuring', blueprintKind: 'structured', projectId: 'proj-cn',
    });
    const res = await POST(makeReq({
      description: 'A description that is long enough to pass.',
      locale: 'ro',
      confirmCandidateId: 'CODE-1',
    }) as any);
    const json = await res.json();
    expect(json).toMatchObject({
      kind: 'selected',
      sessionId: 'sess-cn',
      selectedCallId: 'CODE-1',
      projectId: 'proj-cn',
    });
  });

  it('override-rerank branch — projectId in response (setSelectedCall path)', async () => {
    setSelectedCallMock.mockResolvedValueOnce({ newStateVersion: 4, projectId: 'proj-or' });
    const res = await POST(makeReq({
      description: 'A description that is long enough to pass.',
      locale: 'ro',
      sessionId: '11111111-1111-4111-8111-111111111111',
      expectedStateVersion: 3,
    }) as any);
    const json = await res.json();
    expect(json).toMatchObject({
      kind: 'selected',
      sessionId: '11111111-1111-4111-8111-111111111111',
      selectedCallId: 'CODE-1',
      projectId: 'proj-or',
    });
  });

  it('confirm-override branch — projectId in response (setSelectedCall with both sessionId + confirmCandidateId)', async () => {
    setSelectedCallMock.mockResolvedValueOnce({ newStateVersion: 4, projectId: 'proj-co' });
    const res = await POST(makeReq({
      description: 'A description that is long enough to pass.',
      locale: 'ro',
      sessionId: '11111111-1111-4111-8111-111111111111',
      expectedStateVersion: 3,
      confirmCandidateId: 'CODE-1',
    }) as any);
    const json = await res.json();
    expect(json).toMatchObject({
      kind: 'selected',
      sessionId: '11111111-1111-4111-8111-111111111111',
      selectedCallId: 'CODE-1',
      projectId: 'proj-co',
    });
  });
});

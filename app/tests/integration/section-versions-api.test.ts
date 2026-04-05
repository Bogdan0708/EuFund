import { describe, it, expect, vi, beforeEach } from 'vitest';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

describe('GET /api/ai/orchestrator/sessions/:sessionId/sections/:sectionId/versions', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@/lib/feature-flags', () => ({
      isFeatureEnabled: vi.fn().mockResolvedValue(true),
    }));
  });

  function mockSuccessfulAuth(userId = USER_ID) {
    vi.doMock('@/lib/ai/orchestrator/require-owned-session', () => ({
      requireOwnedSession: vi.fn().mockResolvedValue({
        user: { id: userId },
        session: { id: SESSION_ID, userId },
      }),
    }));
  }

  function mockLogger() {
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => new Proxy({}, { get: () => vi.fn() }) },
    }));
  }

  it('returns versions and stateTransitions for the session owner', async () => {
    mockSuccessfulAuth();
    mockLogger();

    const historySpy = vi.fn().mockResolvedValue({
      versions: [
        { id: 'v1', version: 1, content: 'a', contentHash: 'h1', title: 'T', metadata: {}, reason: 'init', createdAt: '2026-04-05T00:00:00Z', createdBy: USER_ID },
      ],
      stateTransitions: [],
    });

    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      getVersionHistory: historySpy,
    }));

    const { GET } = await import('@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/versions/route');

    const request = new Request(`http://localhost/api/ai/orchestrator/sessions/${SESSION_ID}/sections/context/versions`);
    const response = await GET(request as any, { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.versions).toHaveLength(1);
    expect(body.stateTransitions).toEqual([]);
    expect(historySpy).toHaveBeenCalledWith(SESSION_ID, 'context');
  });

  it('returns 200 with empty arrays when there is no history', async () => {
    mockSuccessfulAuth();
    mockLogger();

    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      getVersionHistory: vi.fn().mockResolvedValue({ versions: [], stateTransitions: [] }),
    }));

    const { GET } = await import('@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/versions/route');

    const request = new Request(`http://localhost/api/ai/orchestrator/sessions/${SESSION_ID}/sections/context/versions`);
    const response = await GET(request as any, { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.versions).toEqual([]);
    expect(body.stateTransitions).toEqual([]);
  });

  it('returns 401 when unauthenticated', async () => {
    const { Errors } = await import('@/lib/errors');

    vi.doMock('@/lib/ai/orchestrator/require-owned-session', () => ({
      requireOwnedSession: vi.fn().mockRejectedValue(Errors.unauthorized()),
    }));

    mockLogger();

    const historySpy = vi.fn();
    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      getVersionHistory: historySpy,
    }));

    const { GET } = await import('@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/versions/route');

    const request = new Request(`http://localhost/api/ai/orchestrator/sessions/${SESSION_ID}/sections/context/versions`);
    const response = await GET(request as any, { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any);

    expect(response.status).toBe(401);
    expect(historySpy).not.toHaveBeenCalled();
  });

  it('returns 400 when sessionId is not a valid UUID', async () => {
    const { Errors } = await import('@/lib/errors');

    vi.doMock('@/lib/ai/orchestrator/require-owned-session', () => ({
      requireOwnedSession: vi
        .fn()
        .mockRejectedValue(
          Errors.validation('sessionId', 'ID de sesiune invalid', 'Invalid session ID'),
        ),
    }));

    mockLogger();

    const historySpy = vi.fn();
    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      getVersionHistory: historySpy,
    }));

    const { GET } = await import('@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/versions/route');

    const request = new Request(`http://localhost/api/ai/orchestrator/sessions/not-a-uuid/sections/context/versions`);
    const response = await GET(request as any, { params: { sessionId: 'not-a-uuid', sectionId: 'context' } } as any);

    expect(response.status).toBe(400);
    expect(historySpy).not.toHaveBeenCalled();
  });

  it('returns 404 when session belongs to a different user', async () => {
    const { Errors } = await import('@/lib/errors');

    vi.doMock('@/lib/ai/orchestrator/require-owned-session', () => ({
      requireOwnedSession: vi.fn().mockRejectedValue(Errors.notFound('session', SESSION_ID)),
    }));

    mockLogger();

    const historySpy = vi.fn();
    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      getVersionHistory: historySpy,
    }));

    const { GET } = await import('@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/versions/route');

    const request = new Request(`http://localhost/api/ai/orchestrator/sessions/${SESSION_ID}/sections/context/versions`);
    const response = await GET(request as any, { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any);

    expect(response.status).toBe(404);
    expect(historySpy).not.toHaveBeenCalled();
  });

  it('returns 500 and logs when getVersionHistory throws', async () => {
    mockSuccessfulAuth();
    mockLogger();

    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      getVersionHistory: vi.fn().mockRejectedValue(new Error('database exploded')),
    }));

    const { GET } = await import('@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/versions/route');

    const request = new Request(`http://localhost/api/ai/orchestrator/sessions/${SESSION_ID}/sections/context/versions`);
    const response = await GET(request as any, { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Internal error');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

describe('POST /api/ai/orchestrator/sessions/:sessionId/sections/:sectionId/rollback', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function mockOwnership() {
    vi.doMock('@/lib/ai/orchestrator/require-owned-session', () => ({
      requireOwnedSession: vi.fn().mockResolvedValue({
        user: { id: USER_ID },
        session: { id: SESSION_ID, userId: USER_ID },
      }),
    }));
  }

  function mockLogger() {
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => new Proxy({}, { get: () => vi.fn() }) },
    }));
  }

  it('rolls back to targetVersion and publishes SSE event', async () => {
    const rolled = {
      id: 'context', title: 'Context', content: 'v1 content', order: 1,
      source: 'generated',
      state: 'draft', currentVersion: 4, versionCount: 4,
      contentHash: 'abcd',
      lastStateChangeAt: '2026-04-05T00:00:00Z', lastStateChangeBy: USER_ID,
      metadata: {},
    };
    const publishSpy = vi.fn().mockResolvedValue(undefined);

    mockOwnership();
    mockLogger();
    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      rollbackSection: vi.fn().mockResolvedValue(rolled),
      SectionVersionError: class extends Error {
        constructor(public code: string, msg: string, public details?: Record<string, unknown>) {
          super(msg);
          this.name = 'SectionVersionError';
        }
      },
    }));
    vi.doMock('@/lib/ai/orchestrator/pubsub', () => ({ publishEvent: publishSpy }));

    const { POST } = await import('@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/rollback/route');

    const request = new Request(`http://localhost/`, {
      method: 'POST',
      body: JSON.stringify({ targetVersion: 1, expectedCurrentVersion: 3, reason: 'test' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request as any, { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.section.currentVersion).toBe(4);
    expect(body.section.content).toBe('v1 content');
    expect(publishSpy).toHaveBeenCalledTimes(1);
    const event = publishSpy.mock.calls[0][1];
    expect(event.type).toBe('section_updated');
    expect(event.sectionId).toBe('context');
  });

  it('returns 404 VersionNotFound when target version does not exist', async () => {
    class SectionVersionError extends Error {
      constructor(public code: string, msg: string) { super(msg); this.name = 'SectionVersionError'; }
    }

    mockOwnership();
    mockLogger();
    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      rollbackSection: vi.fn().mockRejectedValue(new SectionVersionError('VersionNotFound', 'no such version')),
      SectionVersionError,
    }));
    vi.doMock('@/lib/ai/orchestrator/pubsub', () => ({ publishEvent: vi.fn() }));

    const { POST } = await import('@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/rollback/route');

    const request = new Request('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ targetVersion: 99, expectedCurrentVersion: 3 }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request as any, { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any);
    expect(response.status).toBe(404);
  });

  it('returns 409 ConcurrentModification with currentVersion when stale', async () => {
    class SectionVersionError extends Error {
      constructor(public code: string, msg: string, public details?: Record<string, unknown>) {
        super(msg);
        this.name = 'SectionVersionError';
      }
    }

    mockOwnership();
    mockLogger();
    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      rollbackSection: vi.fn().mockRejectedValue(
        new SectionVersionError('ConcurrentModification', 'stale', { currentVersion: 7 }),
      ),
      SectionVersionError,
    }));
    vi.doMock('@/lib/ai/orchestrator/pubsub', () => ({ publishEvent: vi.fn() }));

    const { POST } = await import('@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/rollback/route');

    const request = new Request('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ targetVersion: 1, expectedCurrentVersion: 3 }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request as any, { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('ConcurrentModification');
    expect(body.currentVersion).toBe(7);
  });

  it('returns 400 when targetVersion is missing', async () => {
    mockOwnership();
    mockLogger();
    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      rollbackSection: vi.fn(),
      SectionVersionError: class extends Error { constructor(public code: string, msg: string) { super(msg); } },
    }));
    vi.doMock('@/lib/ai/orchestrator/pubsub', () => ({ publishEvent: vi.fn() }));

    const { POST } = await import('@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/rollback/route');

    const request = new Request('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ expectedCurrentVersion: 3 }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request as any, { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any);
    expect(response.status).toBe(400);
  });

  it('returns 400 when targetVersion is NaN or negative', async () => {
    mockOwnership();
    mockLogger();
    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      rollbackSection: vi.fn(),
      SectionVersionError: class extends Error { constructor(public code: string, msg: string) { super(msg); } },
    }));
    vi.doMock('@/lib/ai/orchestrator/pubsub', () => ({ publishEvent: vi.fn() }));

    const { POST } = await import('@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/rollback/route');

    const requestNaN = new Request('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ targetVersion: Number.NaN, expectedCurrentVersion: 3 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const responseNaN = await POST(requestNaN as any, { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any);
    expect(responseNaN.status).toBe(400);

    const requestNeg = new Request('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ targetVersion: -1, expectedCurrentVersion: 3 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const responseNeg = await POST(requestNeg as any, { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any);
    expect(responseNeg.status).toBe(400);
  });

  it('returns 401 when unauthenticated even with malformed body', async () => {
    vi.doMock('@/lib/ai/orchestrator/require-owned-session', async () => {
      const { Errors } = await import('@/lib/errors');
      return {
        requireOwnedSession: vi.fn().mockRejectedValue(Errors.unauthorized()),
      };
    });
    mockLogger();
    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      rollbackSection: vi.fn(),
      SectionVersionError: class extends Error { constructor(public code: string, msg: string) { super(msg); } },
    }));
    vi.doMock('@/lib/ai/orchestrator/pubsub', () => ({ publishEvent: vi.fn() }));

    const { POST } = await import('@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/rollback/route');

    const request = new Request('http://localhost/', {
      method: 'POST',
      body: 'not valid json',
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request as any, { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any);
    expect(response.status).toBe(401);
  });
});

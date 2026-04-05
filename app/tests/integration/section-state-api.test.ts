import { describe, it, expect, vi, beforeEach } from 'vitest';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function stubSection(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'context', title: 'Context', content: 'Text', order: 1,
    source: 'generated',
    state: 'draft', currentVersion: 2, versionCount: 2,
    contentHash: 'deadbeef',
    lastStateChangeAt: '2026-04-05T00:00:00Z', lastStateChangeBy: USER_ID,
    metadata: {},
    ...overrides,
  };
}

describe('POST /api/ai/orchestrator/sessions/:sessionId/sections/:sectionId/state', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@/lib/feature-flags', () => ({
      isFeatureEnabled: vi.fn().mockResolvedValue(true),
    }));
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

  it('transitions draft → reviewed successfully and publishes SSE event', async () => {
    const transitioned = stubSection({ state: 'reviewed' });
    const publishSpy = vi.fn().mockResolvedValue(undefined);

    mockOwnership();
    mockLogger();
    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      transitionSectionState: vi.fn().mockResolvedValue(transitioned),
      verifySectionIntegrity: vi.fn().mockResolvedValue(undefined),
      SectionVersionError: class extends Error {
        constructor(public code: string, msg: string, public details?: Record<string, unknown>) {
          super(msg);
          this.name = 'SectionVersionError';
        }
      },
    }));
    vi.doMock('@/lib/ai/orchestrator/pubsub', () => ({
      publishEvent: publishSpy,
    }));

    const { POST } = await import('@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/state/route');

    const request = new Request(`http://localhost/api/ai/orchestrator/sessions/${SESSION_ID}/sections/context/state`, {
      method: 'POST',
      body: JSON.stringify({ state: 'reviewed', expectedCurrentVersion: 2 }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request as any, { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.section.state).toBe('reviewed');
    expect(publishSpy).toHaveBeenCalledTimes(1);
    const event = publishSpy.mock.calls[0][1];
    expect(event.type).toBe('section_updated');
    expect(event.sectionId).toBe('context');
    expect(event.section.state).toBe('reviewed');
  });

  it('returns 400 when body is missing state', async () => {
    mockOwnership();
    mockLogger();
    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      transitionSectionState: vi.fn(),
      verifySectionIntegrity: vi.fn().mockResolvedValue(undefined),
      SectionVersionError: class extends Error { constructor(public code: string, msg: string) { super(msg); } },
    }));
    vi.doMock('@/lib/ai/orchestrator/pubsub', () => ({ publishEvent: vi.fn() }));

    const { POST } = await import('@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/state/route');

    const request = new Request('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ expectedCurrentVersion: 2 }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request as any, { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any);
    expect(response.status).toBe(400);
  });

  it('returns 400 when state is invalid', async () => {
    mockOwnership();
    mockLogger();
    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      transitionSectionState: vi.fn(),
      verifySectionIntegrity: vi.fn().mockResolvedValue(undefined),
      SectionVersionError: class extends Error { constructor(public code: string, msg: string) { super(msg); } },
    }));
    vi.doMock('@/lib/ai/orchestrator/pubsub', () => ({ publishEvent: vi.fn() }));

    const { POST } = await import('@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/state/route');

    const request = new Request('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ state: 'published', expectedCurrentVersion: 2 }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request as any, { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any);
    expect(response.status).toBe(400);
  });

  it('returns 409 with currentVersion when expectedCurrentVersion is stale', async () => {
    class SectionVersionError extends Error {
      constructor(public code: string, msg: string, public details?: Record<string, unknown>) {
        super(msg);
        this.name = 'SectionVersionError';
      }
    }

    mockOwnership();
    mockLogger();
    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      transitionSectionState: vi.fn().mockRejectedValue(
        new SectionVersionError('ConcurrentModification', 'stale', { currentVersion: 5 }),
      ),
      verifySectionIntegrity: vi.fn().mockResolvedValue(undefined),
      SectionVersionError,
    }));
    vi.doMock('@/lib/ai/orchestrator/pubsub', () => ({ publishEvent: vi.fn() }));

    const { POST } = await import('@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/state/route');

    const request = new Request('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ state: 'reviewed', expectedCurrentVersion: 2 }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request as any, { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('ConcurrentModification');
    expect(body.currentVersion).toBe(5);
  });

  it('returns 400 when section is failed-source and target is approved', async () => {
    class SectionVersionError extends Error {
      constructor(public code: string, msg: string) {
        super(msg);
        this.name = 'SectionVersionError';
      }
    }

    mockOwnership();
    mockLogger();
    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      transitionSectionState: vi.fn().mockRejectedValue(
        new SectionVersionError('FailedSectionCannotBeApproved', 'failed section'),
      ),
      verifySectionIntegrity: vi.fn().mockResolvedValue(undefined),
      SectionVersionError,
    }));
    vi.doMock('@/lib/ai/orchestrator/pubsub', () => ({ publishEvent: vi.fn() }));

    const { POST } = await import('@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/state/route');

    const request = new Request('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ state: 'approved', expectedCurrentVersion: 2 }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request as any, { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any);
    expect(response.status).toBe(400);
  });

  it('returns 401 when unauthenticated (propagates from requireOwnedSession)', async () => {
    vi.doMock('@/lib/ai/orchestrator/require-owned-session', async () => {
      const { Errors } = await import('@/lib/errors');
      return {
        requireOwnedSession: vi.fn().mockRejectedValue(Errors.unauthorized()),
      };
    });
    mockLogger();
    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      transitionSectionState: vi.fn(),
      verifySectionIntegrity: vi.fn().mockResolvedValue(undefined),
      SectionVersionError: class extends Error { constructor(public code: string, msg: string) { super(msg); } },
    }));
    vi.doMock('@/lib/ai/orchestrator/pubsub', () => ({ publishEvent: vi.fn() }));

    const { POST } = await import('@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/state/route');

    const request = new Request('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ state: 'reviewed', expectedCurrentVersion: 2 }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request as any, { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any);
    expect(response.status).toBe(401);
  });

  it('returns 400 when expectedCurrentVersion is NaN', async () => {
    mockOwnership();
    mockLogger();
    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      transitionSectionState: vi.fn(),
      verifySectionIntegrity: vi.fn().mockResolvedValue(undefined),
      SectionVersionError: class extends Error { constructor(public code: string, msg: string) { super(msg); } },
    }));
    vi.doMock('@/lib/ai/orchestrator/pubsub', () => ({ publishEvent: vi.fn() }));

    const { POST } = await import('@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/state/route');

    const request = new Request('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ state: 'reviewed', expectedCurrentVersion: Number.NaN }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request as any, { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any);
    expect(response.status).toBe(400);
  });

  it('returns 400 when expectedCurrentVersion is negative or zero', async () => {
    mockOwnership();
    mockLogger();
    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      transitionSectionState: vi.fn(),
      verifySectionIntegrity: vi.fn().mockResolvedValue(undefined),
      SectionVersionError: class extends Error { constructor(public code: string, msg: string) { super(msg); } },
    }));
    vi.doMock('@/lib/ai/orchestrator/pubsub', () => ({ publishEvent: vi.fn() }));

    const { POST } = await import('@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/state/route');

    const requestZero = new Request('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ state: 'reviewed', expectedCurrentVersion: 0 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const responseZero = await POST(requestZero as any, { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any);
    expect(responseZero.status).toBe(400);

    const requestNegative = new Request('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ state: 'reviewed', expectedCurrentVersion: -1 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const responseNegative = await POST(requestNegative as any, { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any);
    expect(responseNegative.status).toBe(400);
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
      transitionSectionState: vi.fn(),
      verifySectionIntegrity: vi.fn().mockResolvedValue(undefined),
      SectionVersionError: class extends Error { constructor(public code: string, msg: string) { super(msg); } },
    }));
    vi.doMock('@/lib/ai/orchestrator/pubsub', () => ({ publishEvent: vi.fn() }));

    const { POST } = await import('@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/state/route');

    const request = new Request('http://localhost/', {
      method: 'POST',
      body: 'not valid json',
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request as any, { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any);
    expect(response.status).toBe(401);
  });
});

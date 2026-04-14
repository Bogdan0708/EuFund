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

describe('Section state concurrency', () => {
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
        // context.projectSections: [] means the targetSection lookup in the
        // route returns undefined, so verifySectionIntegrity is never called.
        // Keeps the test focused on the concurrency/publish path.
        session: { id: SESSION_ID, userId: USER_ID, context: { projectSections: [] } },
      }),
    }));
  }

  function mockLogger() {
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => new Proxy({}, { get: () => vi.fn() }) },
    }));
  }

  it('returns 409 with server currentVersion when second state change has stale expectedCurrentVersion', async () => {
    // Real class so `err instanceof SectionVersionError` inside the route
    // identifies the error correctly.
    class SectionVersionError extends Error {
      constructor(public code: string, msg: string, public details?: Record<string, unknown>) {
        super(msg);
        this.name = 'SectionVersionError';
      }
    }

    const firstTransitioned = stubSection({ state: 'reviewed', currentVersion: 3, versionCount: 3 });
    const transitionSpy = vi
      .fn()
      .mockResolvedValueOnce(firstTransitioned)
      .mockRejectedValueOnce(
        new SectionVersionError('ConcurrentModification', 'stale expectedCurrentVersion', {
          currentVersion: 3,
        }),
      );
    const publishSpy = vi.fn().mockResolvedValue(undefined);

    mockOwnership();
    mockLogger();
    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      transitionSectionState: transitionSpy,
      verifySectionIntegrity: vi.fn().mockResolvedValue(undefined),
      SectionVersionError,
    }));
    vi.doMock('@/lib/ai/orchestrator/pubsub', () => ({ persistAndPublishSectionUpdatedEvent: publishSpy }));

    const { POST } = await import(
      '@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/state/route'
    );

    // First call succeeds: draft → reviewed, server now at currentVersion 3.
    const firstRequest = new Request('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ state: 'reviewed', expectedCurrentVersion: 2 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const firstResponse = await POST(
      firstRequest as any,
      { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any,
    );
    const firstBody = await firstResponse.json();
    expect(firstResponse.status).toBe(200);
    expect(firstBody.section.currentVersion).toBe(3);

    // Second call uses the stale expectedCurrentVersion=2 (simulating a second
    // tab that hasn't seen the first mutation). Must return 409 with the
    // server's real currentVersion so the client can refresh its view.
    const secondRequest = new Request('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ state: 'approved', expectedCurrentVersion: 2 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const secondResponse = await POST(
      secondRequest as any,
      { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any,
    );
    const secondBody = await secondResponse.json();

    expect(secondResponse.status).toBe(409);
    expect(secondBody.code).toBe('ConcurrentModification');
    expect(secondBody.currentVersion).toBe(3);

    // Only the successful mutation should have published an event.
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it('publishes section updates for each successful mutation', async () => {
    const reviewed = stubSection({ state: 'reviewed', currentVersion: 3, versionCount: 3 });
    const approved = stubSection({ state: 'approved', currentVersion: 4, versionCount: 4 });

    const transitionSpy = vi
      .fn()
      .mockResolvedValueOnce(reviewed)
      .mockResolvedValueOnce(approved);

    const publishSpy = vi.fn().mockResolvedValue(undefined);

    mockOwnership();
    mockLogger();
    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      transitionSectionState: transitionSpy,
      verifySectionIntegrity: vi.fn().mockResolvedValue(undefined),
      SectionVersionError: class extends Error {
        constructor(public code: string, msg: string, public details?: Record<string, unknown>) {
          super(msg);
          this.name = 'SectionVersionError';
        }
      },
    }));
    vi.doMock('@/lib/ai/orchestrator/pubsub', () => ({ persistAndPublishSectionUpdatedEvent: publishSpy }));

    const { POST } = await import(
      '@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/state/route'
    );

    const firstRequest = new Request('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ state: 'reviewed', expectedCurrentVersion: 2 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const firstResponse = await POST(
      firstRequest as any,
      { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any,
    );
    expect(firstResponse.status).toBe(200);

    const secondRequest = new Request('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ state: 'approved', expectedCurrentVersion: 3 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const secondResponse = await POST(
      secondRequest as any,
      { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any,
    );
    expect(secondResponse.status).toBe(200);

    expect(publishSpy).toHaveBeenCalledTimes(2);
    expect(publishSpy.mock.calls[0][1]).toBe('context');
    expect(publishSpy.mock.calls[0][2].state).toBe('reviewed');
    expect(publishSpy.mock.calls[1][2].state).toBe('approved');
  });

  it('serializes a cross-endpoint race: state change succeeds, stale rollback returns 409', async () => {
    // Shared class across both route imports — critical because both endpoints
    // do `err instanceof SectionVersionError` and the mock factory below uses
    // the same class identity for transitionSectionState and rollbackSection.
    class SectionVersionError extends Error {
      constructor(public code: string, msg: string, public details?: Record<string, unknown>) {
        super(msg);
        this.name = 'SectionVersionError';
      }
    }

    const transitioned = stubSection({ state: 'reviewed', currentVersion: 3, versionCount: 3 });
    const transitionSpy = vi.fn().mockResolvedValueOnce(transitioned);
    const rollbackSpy = vi
      .fn()
      .mockRejectedValueOnce(
        new SectionVersionError('ConcurrentModification', 'stale expectedCurrentVersion', {
          currentVersion: 3,
        }),
      );
    const publishSpy = vi.fn().mockResolvedValue(undefined);

    mockOwnership();
    mockLogger();
    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      transitionSectionState: transitionSpy,
      rollbackSection: rollbackSpy,
      verifySectionIntegrity: vi.fn().mockResolvedValue(undefined),
      SectionVersionError,
    }));
    vi.doMock('@/lib/ai/orchestrator/pubsub', () => ({ persistAndPublishSectionUpdatedEvent: publishSpy }));

    const stateModule = await import(
      '@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/state/route'
    );
    const rollbackModule = await import(
      '@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/rollback/route'
    );

    // Step 1: state change draft → reviewed, expected v2 → becomes v3.
    const stateRequest = new Request('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ state: 'reviewed', expectedCurrentVersion: 2 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const stateResponse = await stateModule.POST(
      stateRequest as any,
      { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any,
    );
    const stateBody = await stateResponse.json();
    expect(stateResponse.status).toBe(200);
    expect(stateBody.section.currentVersion).toBe(3);

    // Step 2: rollback attempt using the pre-transition expectedCurrentVersion=2.
    // The caller never saw the state change, so they send a stale lock value.
    // The route must serialize this through the SectionVersionError path.
    const rollbackRequest = new Request('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ targetVersion: 1, expectedCurrentVersion: 2 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const rollbackResponse = await rollbackModule.POST(
      rollbackRequest as any,
      { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any,
    );
    const rollbackBody = await rollbackResponse.json();

    expect(rollbackResponse.status).toBe(409);
    expect(rollbackBody.code).toBe('ConcurrentModification');
    expect(rollbackBody.currentVersion).toBe(3);

    // Only the successful state change published an event — the failed
    // rollback must NOT publish (it throws before the event helper call).
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy.mock.calls[0][1]).toBe('context');
  });
});

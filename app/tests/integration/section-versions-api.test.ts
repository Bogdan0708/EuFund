import { describe, it, expect, vi, beforeEach } from 'vitest';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333';

describe('GET /api/ai/orchestrator/sessions/:sessionId/sections/:sectionId/versions', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns versions and stateTransitions for the session owner', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'user@test.com' }),
    }));

    vi.doMock('@/lib/db', () => ({
      db: {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockResolvedValue([{ id: SESSION_ID, userId: USER_ID }]),
            })),
          })),
        })),
      },
    }));

    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      getVersionHistory: vi.fn().mockResolvedValue({
        versions: [
          { id: 'v1', version: 1, content: 'a', contentHash: 'h1', title: 'T', metadata: {}, reason: 'init', createdAt: '2026-04-05T00:00:00Z', createdBy: USER_ID },
        ],
        stateTransitions: [],
      }),
    }));

    vi.doMock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), error: vi.fn() }) } }));

    const { GET } = await import('@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/versions/route');

    const request = new Request(`http://localhost/api/ai/orchestrator/sessions/${SESSION_ID}/sections/context/versions`);
    const response = await GET(request as any, { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.versions).toHaveLength(1);
    expect(body.stateTransitions).toEqual([]);
  });

  it('returns 404 when session belongs to a different user', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'user@test.com' }),
    }));

    vi.doMock('@/lib/db', () => ({
      db: {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockResolvedValue([]), // no rows match (sessionId + userId filter)
            })),
          })),
        })),
      },
    }));

    vi.doMock('@/lib/ai/orchestrator/section-versions', () => ({
      getVersionHistory: vi.fn(),
    }));

    vi.doMock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), error: vi.fn() }) } }));

    const { GET } = await import('@/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/versions/route');

    const request = new Request(`http://localhost/api/ai/orchestrator/sessions/${SESSION_ID}/sections/context/versions`);
    const response = await GET(request as any, { params: { sessionId: SESSION_ID, sectionId: 'context' } } as any);

    expect(response.status).toBe(404);
  });
});

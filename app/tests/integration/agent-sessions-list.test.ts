import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('GET /api/ai/agent/sessions', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
    }));
  });

  it('returns sessions for the authenticated user', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }));

    const mockSessions = [
      {
        id: 'sess-1',
        userId: USER_ID,
        projectId: 'proj-1',
        status: 'active',
        currentPhase: 'drafting',
        locale: 'ro',
        selectedCallId: null,
        messageSummary: 'Working on proposal',
        stateVersion: 3,
        createdAt: new Date('2026-04-09T10:00:00Z'),
        updatedAt: new Date('2026-04-09T11:00:00Z'),
      },
    ];

    vi.doMock('@/lib/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue(
                    mockSessions.map(s => ({ ...s, projectTitle: 'Test Project', sectionCount: 5 }))
                  ),
                }),
              }),
            }),
          }),
        }),
      },
    }));

    const { GET } = await import('@/app/api/ai/agent/sessions/route');
    const req = new NextRequest('http://localhost/api/ai/agent/sessions');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].id).toBe('sess-1');
    expect(json.data[0].currentPhase).toBe('drafting');
  });

  it('returns 401 when not authenticated', async () => {
    const { Errors } = await import('@/lib/errors');
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockRejectedValue(Errors.unauthorized()),
    }));
    vi.doMock('@/lib/db', () => ({ db: {} }));

    const { GET } = await import('@/app/api/ai/agent/sessions/route');
    const req = new NextRequest('http://localhost/api/ai/agent/sessions');
    const res = await GET(req);

    expect(res.status).toBe(401);
  });
});

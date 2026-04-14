import { describe, it, expect, vi, beforeEach } from 'vitest';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SESSION_ID = '99999999-9999-4999-8999-999999999999';
const USER_ID = '22222222-2222-4222-8222-222222222222';

describe('requireOwnedSession', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns user and session when authenticated and session is owned', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: SESSION_ID, userId: USER_ID }]),
            }),
          }),
        }),
      },
    }));

    const { requireOwnedSession } = await import('@/lib/ai/orchestrator/require-owned-session');
    const result = await requireOwnedSession(SESSION_ID);

    expect(result.user.id).toBe(USER_ID);
    expect(result.session.id).toBe(SESSION_ID);
  });

  it('throws validation error for non-UUID sessionId', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: { select: vi.fn() },
    }));

    const { requireOwnedSession } = await import('@/lib/ai/orchestrator/require-owned-session');
    const { FondEUError } = await import('@/lib/errors');

    await expect(requireOwnedSession('not-a-uuid')).rejects.toBeInstanceOf(FondEUError);
    await expect(requireOwnedSession('not-a-uuid')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws not-found when session does not exist or belongs to another user', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]), // no rows match the combined WHERE
            }),
          }),
        }),
      },
    }));

    const { requireOwnedSession } = await import('@/lib/ai/orchestrator/require-owned-session');
    const { FondEUError } = await import('@/lib/errors');

    await expect(requireOwnedSession(OTHER_SESSION_ID)).rejects.toBeInstanceOf(FondEUError);
    await expect(requireOwnedSession(OTHER_SESSION_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('propagates requireAuth throw (unauthenticated)', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockImplementation(async () => {
        const { Errors } = await import('@/lib/errors');
        throw Errors.unauthorized();
      }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: { select: vi.fn() },
    }));

    const { requireOwnedSession } = await import('@/lib/ai/orchestrator/require-owned-session');
    const { FondEUError } = await import('@/lib/errors');

    await expect(requireOwnedSession(SESSION_ID)).rejects.toBeInstanceOf(FondEUError);
    await expect(requireOwnedSession(SESSION_ID)).rejects.toMatchObject({ statusCode: 401 });
  });
});

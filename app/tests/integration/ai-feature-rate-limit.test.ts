import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Validates the fail-closed AI rate-limiting behaviour in
 * `app/src/lib/middleware/auth.ts` after the bypass introduced in commit
 * 40507cb was reverted. Covers:
 *   - 200 on requests within the per-tier hourly + per-feature daily limits
 *   - 503 when Redis is unavailable (fail-closed)
 *   - 429 when the hourly tier limit is exhausted
 *   - 429 when the per-feature daily limit is exhausted
 */

type Mocks = {
  isRedisAvailable?: () => Promise<boolean>;
  checkRateLimit?: ReturnType<typeof vi.fn>;
  incr?: ReturnType<typeof vi.fn>;
  expire?: ReturnType<typeof vi.fn>;
  userRow?: {
    tier: string | null;
    subscriptionStatus: string | null;
    stripeSubscriptionId: string | null;
    createdAt: Date | null;
  } | null;
};

function installMocks(m: Mocks = {}) {
  const isRedisAvailable = m.isRedisAvailable ?? vi.fn().mockResolvedValue(true);
  const checkRateLimit =
    m.checkRateLimit ??
    vi.fn().mockResolvedValue({
      allowed: true,
      remaining: 9,
      resetTime: Date.now() + 60 * 60 * 1000,
    });
  const incr = m.incr ?? vi.fn().mockResolvedValue(1);
  const expire = m.expire ?? vi.fn().mockResolvedValue(1);

  vi.doMock('@/lib/redis/client', () => ({
    isRedisAvailable,
    checkRateLimit,
    getRedis: vi.fn().mockReturnValue({ incr, expire }),
  }));

  vi.doMock('@/lib/auth', () => ({
    auth: () => Promise.resolve({ user: { id: 'user-1', email: 'user@example.com' } }),
  }));

  const userRow =
    m.userRow === null
      ? null
      : m.userRow ?? {
          tier: 'free',
          subscriptionStatus: 'none',
          stripeSubscriptionId: null,
          createdAt: new Date('2020-01-01T00:00:00.000Z'), // well outside trial window
        };

  vi.doMock('@/lib/db', () => ({
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue(userRow ? [userRow] : []),
          }),
        }),
      }),
    },
  }));

  vi.doMock('@/lib/db/schema', () => ({
    users: {
      id: 'id',
      tier: 'tier',
      subscriptionStatus: 'subscriptionStatus',
      stripeSubscriptionId: 'stripeSubscriptionId',
      createdAt: 'createdAt',
    },
  }));

  vi.doMock('lru-cache', () => ({
    LRUCache: class {
      get = () => undefined;
      set = vi.fn();
      delete = vi.fn();
    },
  }));

  vi.doMock('@/lib/logger', () => ({
    logger: {
      child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
    },
  }));

  return { isRedisAvailable, checkRateLimit, incr, expire };
}

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/ai/generate-proposal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
}

describe('AI rate limiting (fail-closed)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('allows a request within per-tier hourly + daily limits', async () => {
    const { isRedisAvailable, checkRateLimit, incr } = installMocks();

    const { withAIAuth } = await import('@/lib/middleware/auth');
    const res = await withAIAuth(
      makeRequest(),
      async () => NextResponse.json({ success: true }),
      { feature: 'proposal' },
    );

    expect(res.status).toBe(200);
    expect(isRedisAvailable).toHaveBeenCalled();
    expect(checkRateLimit).toHaveBeenCalledWith(
      'ai_requests:user-1',
      10, // free tier hourly limit
      60 * 60 * 1000,
    );
    // Daily feature counter was incremented for the 'proposal' feature.
    expect(incr).toHaveBeenCalledTimes(1);
    const key = incr.mock.calls[0][0] as string;
    expect(key).toMatch(/^ai_usage:user-1:proposal:\d{4}-\d{2}-\d{2}$/);
  });

  it('returns 503 when Redis is unavailable (fail-closed)', async () => {
    const { checkRateLimit, incr } = installMocks({
      isRedisAvailable: vi.fn().mockResolvedValue(false),
    });

    const { withAIAuth } = await import('@/lib/middleware/auth');
    const res = await withAIAuth(
      makeRequest(),
      async () => NextResponse.json({ success: true }),
      { feature: 'proposal' },
    );

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('RATE_LIMIT_UNAVAILABLE');
    // Rate-limit checks must not run once Redis is declared unavailable.
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(incr).not.toHaveBeenCalled();
  });

  it('returns 429 when the per-tier hourly limit is exceeded', async () => {
    const resetTime = Date.now() + 60 * 60 * 1000;
    const checkRateLimit = vi.fn().mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetTime,
    });
    const { incr } = installMocks({ checkRateLimit });

    const { withAIAuth } = await import('@/lib/middleware/auth');
    const res = await withAIAuth(
      makeRequest(),
      async () => NextResponse.json({ success: true }),
      { feature: 'proposal' },
    );

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(body.tier).toBe('free');
    expect(body.limit).toBe(10);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    // Feature-daily check is skipped once the hourly check has already failed.
    expect(incr).not.toHaveBeenCalled();
  });

  it('returns 429 when the per-feature daily limit is exceeded', async () => {
    // 11th proposal generation today → over the 10/day limit from AI_CONFIG.
    const incr = vi.fn().mockResolvedValue(11);
    installMocks({ incr });

    const { withAIAuth } = await import('@/lib/middleware/auth');
    const res = await withAIAuth(
      makeRequest(),
      async () => NextResponse.json({ success: true }),
      { feature: 'proposal' },
    );

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe('FEATURE_LIMIT_EXCEEDED');
    expect(body.feature).toBe('proposal');
    expect(body.limit).toBe(10);
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });
});

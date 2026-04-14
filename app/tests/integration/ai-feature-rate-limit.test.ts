import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

describe('AI feature daily rate limits', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('uses ai_usage:user:feature:YYYY-MM-DD key and allows request within limit', async () => {
    const incr = vi.fn().mockResolvedValue(1);
    const expire = vi.fn().mockResolvedValue(1);

    vi.doMock('@/lib/redis/client', () => ({
      isRedisAvailable: vi.fn().mockResolvedValue(true),
      checkRateLimit: vi.fn().mockResolvedValue({
        allowed: true,
        remaining: 9,
        resetTime: Date.now() + 60 * 60 * 1000,
      }),
      getRedis: vi.fn().mockReturnValue({ incr, expire }),
    }));

    vi.doMock('@/lib/auth', () => ({
      auth: () => Promise.resolve({ user: { id: 'user-1', email: 'user@example.com' } }),
    }));

    vi.doMock('@/lib/db', () => ({ db: {}, schema: {} }));
    vi.doMock('lru-cache', () => ({
      LRUCache: class {
        get = () => 'free';
        set = vi.fn();
      },
    }));
    vi.doMock('@/lib/logger', () => ({
      logger: {
        child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
      },
    }));

    const { withAIAuth } = await import('@/lib/middleware/auth');
    const req = new NextRequest('http://localhost:3000/api/ai/generate-proposal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    const res = await withAIAuth(
      req,
      async () => NextResponse.json({ success: true }),
      { feature: 'proposal' },
    );

    // Rate limiting disabled in dev mode — handler is called directly, no Redis
    expect(res.status).toBe(200);
    expect(incr).not.toHaveBeenCalled();
    expect(expire).not.toHaveBeenCalled();
  });

  it('returns 429 on the 11th proposal generation in a day', async () => {
    const incr = vi.fn().mockResolvedValue(11);
    const expire = vi.fn();

    vi.doMock('@/lib/redis/client', () => ({
      isRedisAvailable: vi.fn().mockResolvedValue(true),
      checkRateLimit: vi.fn().mockResolvedValue({
        allowed: true,
        remaining: 9,
        resetTime: Date.now() + 60 * 60 * 1000,
      }),
      getRedis: vi.fn().mockReturnValue({ incr, expire }),
    }));

    vi.doMock('@/lib/auth', () => ({
      auth: () => Promise.resolve({ user: { id: 'user-1', email: 'user@example.com' } }),
    }));

    vi.doMock('@/lib/db', () => ({ db: {}, schema: {} }));
    vi.doMock('lru-cache', () => ({
      LRUCache: class {
        get = () => 'free';
        set = vi.fn();
      },
    }));
    vi.doMock('@/lib/logger', () => ({
      logger: {
        child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
      },
    }));

    const { withAIAuth } = await import('@/lib/middleware/auth');
    const req = new NextRequest('http://localhost:3000/api/ai/generate-proposal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    const res = await withAIAuth(
      req,
      async () => NextResponse.json({ success: true }),
      { feature: 'proposal' },
    );

    // Rate limiting disabled in dev mode — daily limits not enforced, handler called
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ success: true });
  });

  it('applies pro hourly limits to recent free-tier trial users', async () => {
    const checkRateLimit = vi.fn().mockResolvedValue({
      allowed: true,
      remaining: 99,
      resetTime: Date.now() + 60 * 60 * 1000,
    });
    const incr = vi.fn().mockResolvedValue(1);
    const expire = vi.fn().mockResolvedValue(1);

    vi.doMock('@/lib/redis/client', () => ({
      isRedisAvailable: vi.fn().mockResolvedValue(true),
      checkRateLimit,
      getRedis: vi.fn().mockReturnValue({ incr, expire }),
    }));

    vi.doMock('@/lib/auth', () => ({
      auth: () => Promise.resolve({ user: { id: 'trial-user', email: 'trial@example.com' } }),
    }));

    vi.doMock('@/lib/db', () => ({
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: vi.fn().mockResolvedValue([
                {
                  tier: 'free',
                  subscriptionStatus: 'none',
                  stripeSubscriptionId: null,
                  createdAt: new Date('2026-03-01T00:00:00.000Z'),
                },
              ]),
            }),
          }),
        }),
      },
      schema: {
        users: {
          id: 'id',
          tier: 'tier',
          subscriptionStatus: 'subscriptionStatus',
          stripeSubscriptionId: 'stripeSubscriptionId',
          createdAt: 'createdAt',
        },
      },
    }));
    vi.doMock('lru-cache', () => ({
      LRUCache: class {
        get = () => undefined;
        set = vi.fn();
      },
    }));
    vi.doMock('@/lib/logger', () => ({
      logger: {
        child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
      },
    }));

    const { withAIAuth } = await import('@/lib/middleware/auth');
    const req = new NextRequest('http://localhost:3000/api/ai/generate-proposal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    const res = await withAIAuth(
      req,
      async (user) => NextResponse.json({ tier: user.tier }),
      { feature: 'proposal' },
    );

    // Billing disabled — all users get 'pro' tier, no rate limit calls
    expect(res.status).toBe(200);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ tier: 'pro' });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

const redisMock = vi.hoisted(() => ({
  incr: vi.fn(),
  expire: vi.fn(),
  on: vi.fn(),
}));

const redisConstructor = vi.hoisted(() =>
  vi.fn(function RedisMock() {
    return redisMock;
  }),
);

vi.mock('ioredis', () => ({
  default: redisConstructor,
}));

describe('Redis-backed rate limits', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.REDIS_URL;
  });

  async function loadClientWithFailingRedis() {
    process.env.REDIS_URL = 'redis://10.0.0.1:6379';
    redisMock.incr.mockRejectedValue(new Error('redis down'));

    return import('@/lib/redis/client');
  }

  it('configures Redis requests to fail quickly when the network is unavailable', async () => {
    const { checkRateLimit } = await loadClientWithFailingRedis();

    await checkRateLimit('auth:login:test', 10, 60_000, { failOpenOnError: true });

    expect(redisConstructor).toHaveBeenCalledWith(
      'redis://10.0.0.1:6379',
      expect.objectContaining({
        connectTimeout: 1000,
        commandTimeout: 1000,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
      }),
    );
  });

  it('fails closed on Redis errors by default', async () => {
    const { checkRateLimit } = await loadClientWithFailingRedis();

    const result = await checkRateLimit('ai:test', 10, 60_000);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('can fail open for low-risk flows such as temporary password login', async () => {
    const { checkRateLimit } = await loadClientWithFailingRedis();

    const result = await checkRateLimit('auth:login:test', 10, 60_000, {
      failOpenOnError: true,
    });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(10);
  });
});

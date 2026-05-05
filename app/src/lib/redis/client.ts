// ─── Redis Client Configuration ───────────────────────────
import Redis from 'ioredis';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'redis-client' });

let redis: Redis | null = null;

export function getRedis(): Redis | null {
  if (!process.env.REDIS_URL) {
    return null;
  }

  if (!redis) {
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 1000,
      commandTimeout: 1000,
      keepAlive: 30000,
    });

    redis.on('error', (error) => {
      log.error({ error }, 'Redis connection error');
    });

    redis.on('connect', () => {
      log.info('Redis connected successfully');
    });
  }

  return redis;
}

/**
 * Returns true if Redis is configured and the connection is healthy.
 * Used by AI endpoint auth to enforce fail-closed behaviour.
 */
export async function isRedisAvailable(): Promise<boolean> {
  if (!process.env.REDIS_URL) {
    return false;
  }

  const client = getRedis();
  if (!client) {
    return false;
  }

  try {
    const result = await client.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

// Rate limiting helper
export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
  options: { failOpenOnError?: boolean } = {},
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const redis = getRedis();
  
  if (!redis) {
    // Fail-open when Redis is not configured (no REDIS_URL) — allow requests through
    // Rate limiting is defense-in-depth; auth + CSRF are the primary security layers
    log.warn('Redis not configured - allowing request (fail-open)');
    return { allowed: true, remaining: maxRequests, resetTime: Date.now() + windowMs };
  }

  const now = Date.now();
  const window = Math.floor(now / windowMs);
  const redisKey = `rate_limit:${key}:${window}`;

  try {
    const current = await redis.incr(redisKey);
    
    if (current === 1) {
      // First request in this window, set expiry
      await redis.expire(redisKey, Math.ceil(windowMs / 1000));
    }

    const allowed = current <= maxRequests;
    const remaining = Math.max(0, maxRequests - current);
    const resetTime = (window + 1) * windowMs;

    return { allowed, remaining, resetTime };
  } catch (error) {
    log.error({ error }, 'Rate limit check failed');
    if (options.failOpenOnError) {
      return { allowed: true, remaining: maxRequests, resetTime: now + windowMs };
    }
    // Fail-closed: deny on error (security-critical)
    return { allowed: false, remaining: 0, resetTime: now + windowMs };
  }
}

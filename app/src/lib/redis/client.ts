// ─── Redis Client Configuration ───────────────────────────
import Redis from 'ioredis';

let redis: Redis | null = null;

export function getRedis(): Redis | null {
  if (!process.env.REDIS_URL) {
    return null;
  }

  if (!redis) {
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      keepAlive: 30000,
    });

    redis.on('error', (error) => {
      console.error('Redis connection error:', error);
    });

    redis.on('connect', () => {
      console.log('Redis connected successfully');
    });
  }

  return redis;
}

// Rate limiting helper
export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const redis = getRedis();
  
  if (!redis) {
    // If Redis is not available, allow the request
    return { allowed: true, remaining: maxRequests - 1, resetTime: Date.now() + windowMs };
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
    console.error('Rate limit check failed:', error);
    // On error, allow the request
    return { allowed: true, remaining: maxRequests - 1, resetTime: now + windowMs };
  }
}
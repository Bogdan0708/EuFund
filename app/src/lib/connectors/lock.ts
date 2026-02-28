import { getRedis } from '@/lib/redis/client';

const LOCK_TTL = 3600; // 1 hour max

export async function acquireConnectorLock(slug: string): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    const key = `lock:connector:${slug}`;
    const acquired = await redis.set(key, '1', 'EX', LOCK_TTL, 'NX');
    return acquired === 'OK';
  }

  // Fallback to DB-based lock if Redis is not available
  // This is a simple implementation using a boolean flag or similar.
  // Given schema doesn't have an 'is_running' flag yet, we'll skip DB lock for now
  // or we could use sourceRuns 'running' status as a proxy.
  return true; 
}

export async function releaseConnectorLock(slug: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    const key = `lock:connector:${slug}`;
    await redis.del(key);
  }
}

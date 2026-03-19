import crypto from 'crypto'

function cacheKey(prefix: string, params: Record<string, unknown>): string {
  const hash = crypto.createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 16)
  return `cache:orchestrator:${prefix}:${hash}`
}

export async function getCachedResult<T>(prefix: string, params: Record<string, unknown>): Promise<T | null> {
  try {
    const { getRedis } = await import('@/lib/redis/client')
    const redis = getRedis()
    const cached = await redis.get(cacheKey(prefix, params))
    return cached ? JSON.parse(cached) : null
  } catch {
    return null
  }
}

export async function setCachedResult(
  prefix: string,
  params: Record<string, unknown>,
  result: unknown,
  ttlSeconds: number
): Promise<void> {
  try {
    const { getRedis } = await import('@/lib/redis/client')
    const redis = getRedis()
    await redis.setex(cacheKey(prefix, params), ttlSeconds, JSON.stringify(result))
  } catch {
    // Non-fatal — cache miss on next call
  }
}

export const CACHE_TTLS = {
  match: 3600,
  validate: 86400,
  research: 86400,
}

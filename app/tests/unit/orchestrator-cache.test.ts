import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/redis/client', () => ({
  getRedis: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
  })),
}))

describe('Orchestrator Cache', () => {
  it('getCachedResult returns null on miss', async () => {
    const { getCachedResult } = await import('@/lib/ai/orchestrator/cache')
    const result = await getCachedResult('match', { sector: 'Energy' })
    expect(result).toBeNull()
  })

  it('CACHE_TTLS has correct values', async () => {
    const { CACHE_TTLS } = await import('@/lib/ai/orchestrator/cache')
    expect(CACHE_TTLS.match).toBe(3600)
    expect(CACHE_TTLS.validate).toBe(86400)
  })
})

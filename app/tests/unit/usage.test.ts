import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/redis/client', () => ({
  getRedis: vi.fn(() => ({
    incr: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue('0'),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(2592000),
  })),
}))

describe('Usage tracking', () => {
  it('checkWorkflowLimit returns allowed when under limit', async () => {
    const { checkWorkflowLimit } = await import('@/lib/billing/usage')
    const result = await checkWorkflowLimit('user-123', 'plus')
    expect(result.allowed).toBe(true)
  })

  it('checkWorkflowLimit returns denied when over limit', async () => {
    vi.doMock('@/lib/redis/client', () => ({
      getRedis: vi.fn(() => ({
        get: vi.fn().mockResolvedValue('10'),
        ttl: vi.fn().mockResolvedValue(2592000),
      })),
    }))
    vi.resetModules()
    const { checkWorkflowLimit } = await import('@/lib/billing/usage')
    const result = await checkWorkflowLimit('user-123', 'plus')
    expect(result.allowed).toBe(false)
  })

  it('incrementWorkflowCount increments Redis counter', async () => {
    vi.doMock('@/lib/redis/client', () => ({
      getRedis: vi.fn(() => ({
        incr: vi.fn().mockResolvedValue(1),
        get: vi.fn().mockResolvedValue('0'),
        expire: vi.fn().mockResolvedValue(1),
        ttl: vi.fn().mockResolvedValue(2592000),
      })),
    }))
    vi.resetModules()
    const { incrementWorkflowCount } = await import('@/lib/billing/usage')
    await incrementWorkflowCount('user-123')
  })
})

import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue([]),
  },
}))
vi.mock('@/lib/ai/orchestrator/gateway', () => ({
  createGatewayClient: vi.fn(() => ({
    generate: vi.fn().mockResolvedValue({ content: '[]', tokensUsed: 100 }),
  })),
}))

describe('Discovery Pipeline', () => {
  it('exports runDiscovery function', async () => {
    const { runDiscovery } = await import('@/lib/discovery/pipeline')
    expect(typeof runDiscovery).toBe('function')
  })

  it('returns result with counts', async () => {
    const { runDiscovery } = await import('@/lib/discovery/pipeline')
    const result = await runDiscovery()
    expect(result).toHaveProperty('newCalls')
    expect(result).toHaveProperty('duplicates')
    expect(result).toHaveProperty('errors')
  })
})

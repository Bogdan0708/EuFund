import { describe, it, expect, vi } from 'vitest'

const mockWhere = vi.fn()
const mockChain = {
  from: vi.fn().mockReturnThis(),
  where: mockWhere,
  orderBy: vi.fn().mockResolvedValue([]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
}
mockWhere.mockImplementation(() => ({
  ...mockChain,
  then: (resolve: (v: any[]) => any) => Promise.resolve([]).then(resolve),
}))

vi.mock('@/lib/db', () => ({
  db: new Proxy(mockChain, {
    get(target, prop) {
      if (prop === 'select') return () => mockChain
      return (target as any)[prop]
    },
  }),
}))

describe('Session Lifecycle', () => {
  it('enforceMaxSessions exports correctly', async () => {
    const { enforceMaxSessions } = await import('@/lib/ai/orchestrator/lifecycle')
    expect(typeof enforceMaxSessions).toBe('function')
    await enforceMaxSessions('user-1', 'free')
  })

  it('cleanupAbandonedSessions exports correctly', async () => {
    const { cleanupAbandonedSessions } = await import('@/lib/ai/orchestrator/lifecycle')
    expect(typeof cleanupAbandonedSessions).toBe('function')
    const count = await cleanupAbandonedSessions()
    expect(count).toBe(0)
  })
})

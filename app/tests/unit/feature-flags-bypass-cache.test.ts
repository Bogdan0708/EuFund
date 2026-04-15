import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockDbSelect = vi.fn()

vi.mock('@/lib/db', () => ({
  db: { select: () => mockDbSelect() },
}))

describe('feature-flags bypassCache + fail-closed', () => {
  beforeEach(() => {
    vi.resetModules()
    mockDbSelect.mockReset()
  })

  afterEach(() => vi.restoreAllMocks())

  it('bypassCache=true reads DB on every call', async () => {
    mockDbSelect.mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([{ key: 'test_flag', enabled: true, targeting: null }]) }) }),
    })
    const { isFeatureEnabled } = await import('@/lib/feature-flags')
    await isFeatureEnabled('test_flag', { userId: 'u1', bypassCache: true })
    await isFeatureEnabled('test_flag', { userId: 'u1', bypassCache: true })
    expect(mockDbSelect).toHaveBeenCalledTimes(2)
  })

  it('bypassCache=false uses LRU on repeat calls', async () => {
    mockDbSelect.mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([{ key: 'cached_flag', enabled: true, targeting: null }]) }) }),
    })
    const { isFeatureEnabled } = await import('@/lib/feature-flags')
    await isFeatureEnabled('cached_flag', { userId: 'u1' })
    await isFeatureEnabled('cached_flag', { userId: 'u1' })
    expect(mockDbSelect).toHaveBeenCalledTimes(1)
  })

  it('fail-closed: returns false when bypassCache read throws', async () => {
    mockDbSelect.mockImplementation(() => { throw new Error('db down') })
    const { isFeatureEnabled } = await import('@/lib/feature-flags')
    const result = await isFeatureEnabled('kill_switch', { userId: 'u1', bypassCache: true })
    expect(result).toBe(false)
  })
})

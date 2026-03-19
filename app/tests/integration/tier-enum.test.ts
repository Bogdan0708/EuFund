import { describe, it, expect } from 'vitest'

describe('User tier enum', () => {
  it('includes plus and ultra tiers', async () => {
    const { userTierEnum } = await import('@/lib/db/schema')
    expect(userTierEnum.enumValues).toContain('plus')
    expect(userTierEnum.enumValues).toContain('ultra')
  })
})

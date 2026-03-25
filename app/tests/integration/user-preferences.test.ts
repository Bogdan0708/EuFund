import { describe, it, expect } from 'vitest'

describe('User preferences schema', () => {
  it('exports userPreferences table', async () => {
    const { userPreferences } = await import('@/lib/db/schema')
    expect(userPreferences).toBeDefined()
  })
})

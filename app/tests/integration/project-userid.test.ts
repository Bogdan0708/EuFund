import { describe, it, expect } from 'vitest'

describe('Projects table', () => {
  it('has userId column', async () => {
    const { projects } = await import('@/lib/db/schema')
    expect(projects.userId).toBeDefined()
  })
})

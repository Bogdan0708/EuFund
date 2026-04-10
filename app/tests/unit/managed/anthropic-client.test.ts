import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('getAnthropicClient', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY

  beforeEach(async () => {
    vi.resetModules()
    try {
      const mod = await import('@/lib/ai/anthropic-client')
      mod.__resetAnthropicClientForTests()
    } catch {
      // Module may not exist yet on first test run
    }
  })

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalKey
  })

  it('returns the same instance across calls (singleton)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
    const { getAnthropicClient } = await import('@/lib/ai/anthropic-client')
    const a = getAnthropicClient()
    const b = getAnthropicClient()
    expect(a).toBe(b)
  })

  it('throws if ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { getAnthropicClient } = await import('@/lib/ai/anthropic-client')
    expect(() => getAnthropicClient()).toThrow(/ANTHROPIC_API_KEY/)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateMock = vi.fn()
vi.mock('@/lib/ai/providers/router', () => ({
  generate: generateMock,
  embed: vi.fn(),
}))

vi.mock('@/lib/ai/model-routing', () => ({
  resolveAgentModel: () => ({ provider: 'anthropic', model: 'claude-sonnet-4-6', tier: 'standard' }),
  SECTION_MODEL_ROUTING: {},
}))

vi.mock('@/lib/errors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/errors')>()
  return {
    ...actual,
    // CircuitBreaker still wraps; let it pass through the function.
    CircuitBreaker: class {
      execute<T>(fn: () => Promise<T>): Promise<T> { return fn() }
    },
    withRetry: vi.fn(),
    Errors: actual.Errors,
  }
})

vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))

describe('aiGenerate — no outer withRetry, original errors preserved', () => {
  beforeEach(() => { generateMock.mockReset() })

  it('does NOT wrap call in @/lib/errors withRetry', async () => {
    generateMock.mockResolvedValueOnce({
      content: 'ok', tokensUsed: { input: 1, output: 1 }, model: 'claude-sonnet-4-6', provider: 'anthropic',
    })
    const { withRetry } = await import('@/lib/errors')
    const { aiGenerate } = await import('@/lib/ai/client')

    await aiGenerate({ system: 's', prompt: 'p' })

    // withRetry from @/lib/errors should NOT be invoked anywhere in this path.
    expect(vi.mocked(withRetry)).not.toHaveBeenCalled()
  })

  it('propagates original provider error type (status preserved)', async () => {
    const upstreamError = Object.assign(new Error('rate limited'), { status: 429 })
    generateMock.mockRejectedValueOnce(upstreamError)
    const { aiGenerate } = await import('@/lib/ai/client')

    await expect(aiGenerate({ system: 's', prompt: 'p' })).rejects.toBe(upstreamError)
    // Specifically: NOT wrapped as Errors.serviceUnavailable(...)
  })
})

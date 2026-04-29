import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UnsupportedOperationError } from '@/lib/errors'
import type { GenerateRequest } from '@/lib/ai/providers/types'

const createMock = vi.fn()

class MockOpenAI {
  chat = { completions: { create: createMock } }
}

vi.mock('openai', () => ({ default: MockOpenAI }))

describe('perplexityProvider.generate', () => {
  beforeEach(() => {
    createMock.mockReset()
    createMock.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })
  })

  it('cache.enabled=true returns cacheUsage with supported:false, hit:unsupported', async () => {
    const { perplexityProvider } = await import('@/lib/ai/providers/perplexity')
    const req: GenerateRequest = {
      provider: 'perplexity',
      model: 'sonar-pro',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true, breakpoints: ['system'] },
    }
    const result = await perplexityProvider.generate(req)
    expect(result.cacheUsage).toBeDefined()
    expect(result.cacheUsage!.supported).toBe(false)
    expect(result.cacheUsage!.hit).toBe('unsupported')
    expect(result.cacheUsage!.enabled).toBe(true)
    expect(result.cacheUsage!.disabledReason).toBe('none')
    expect(result.cacheUsage!.reads).toBe(0)
    expect(result.cacheUsage!.writes).toBe(0)
  })

  it('cache.enabled=false does NOT emit cacheUsage (router owns disabled presence, §5.2/§5.4)', async () => {
    const { perplexityProvider } = await import('@/lib/ai/providers/perplexity')
    const result = await perplexityProvider.generate({
      provider: 'perplexity',
      model: 'sonar-pro',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: false },
    })
    expect(result.cacheUsage).toBeUndefined()
  })

  it('throws UnsupportedOperationError when messages contain tool_calls', async () => {
    const { perplexityProvider } = await import('@/lib/ai/providers/perplexity')
    const req: GenerateRequest = {
      provider: 'perplexity',
      model: 'sonar-pro',
      messages: [{
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{}' } }],
      }],
    }
    await expect(perplexityProvider.generate(req)).rejects.toBeInstanceOf(UnsupportedOperationError)
  })

  it('omits cacheUsage when req.cache was not provided', async () => {
    const { perplexityProvider } = await import('@/lib/ai/providers/perplexity')
    const result = await perplexityProvider.generate({
      provider: 'perplexity',
      model: 'sonar-pro',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(result.cacheUsage).toBeUndefined()
  })

  it('passes AbortSignal to chat.completions.create options', async () => {
    const { perplexityProvider } = await import('@/lib/ai/providers/perplexity')
    const controller = new AbortController()
    await perplexityProvider.generate({
      provider: 'perplexity',
      model: 'sonar',
      messages: [{ role: 'user', content: 'hi' }],
    }, controller.signal)
    const optionsArg = createMock.mock.calls[0][1] as { signal?: AbortSignal } | undefined
    expect(optionsArg?.signal).toBe(controller.signal)
  })

  it('omits signal option when called without one', async () => {
    const { perplexityProvider } = await import('@/lib/ai/providers/perplexity')
    await perplexityProvider.generate({
      provider: 'perplexity',
      model: 'sonar',
      messages: [{ role: 'user', content: 'hi' }],
    })
    const optionsArg = createMock.mock.calls[0][1]
    expect(optionsArg).toBeUndefined()
  })
})

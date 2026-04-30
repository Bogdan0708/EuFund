import { describe, it, expect, vi, beforeEach } from 'vitest'

const createMock = vi.fn()

class MockOpenAI {
  chat = { completions: { create: createMock } }
  embeddings = { create: vi.fn() }
}

vi.mock('openai', () => ({
  default: MockOpenAI,
}))

describe('openaiProvider.generate', () => {
  beforeEach(() => {
    createMock.mockReset()
    createMock.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 50,
        prompt_tokens_details: { cached_tokens: 400 },
      },
    })
  })

  it('passes prompt_cache_key when cache.enabled and caller provided key', async () => {
    const { openaiProvider } = await import('@/lib/ai/providers/openai')
    await openaiProvider.generate({
      provider: 'openai',
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true, key: 'custom-key' },
    })
    expect(createMock.mock.calls[0][0]).toMatchObject({ prompt_cache_key: 'custom-key' })
  })

  it('falls back to identity key when cache.enabled and caller omits key', async () => {
    const { openaiProvider } = await import('@/lib/ai/providers/openai')
    await openaiProvider.generate({
      provider: 'openai',
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true },
    })
    const call = createMock.mock.calls[0][0]
    expect(call.prompt_cache_key).toMatch(/^[0-9a-f]{64}$/)
  })

  it('omits prompt_cache_key when cache.enabled=false', async () => {
    const { openaiProvider } = await import('@/lib/ai/providers/openai')
    await openaiProvider.generate({
      provider: 'openai',
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: false },
    })
    const call = createMock.mock.calls[0][0]
    expect(call.prompt_cache_key).toBeUndefined()
  })

  it('extracts cached_tokens into cacheUsage.reads', async () => {
    const { openaiProvider } = await import('@/lib/ai/providers/openai')
    const result = await openaiProvider.generate({
      provider: 'openai',
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true },
    })
    expect(result.cacheUsage).toBeDefined()
    expect(result.cacheUsage!.reads).toBe(400)
    expect(result.cacheUsage!.writes).toBe(0)
    expect(result.cacheUsage!.hit).toBe('read')
    expect(result.cacheUsage!.supported).toBe(true)
  })

  it('hit=miss when cached_tokens is 0', async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 0 } },
    })
    const { openaiProvider } = await import('@/lib/ai/providers/openai')
    const result = await openaiProvider.generate({
      provider: 'openai',
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true },
    })
    expect(result.cacheUsage!.hit).toBe('miss')
  })

  it('passes assistant tool_calls through to OpenAI message shape', async () => {
    const { openaiProvider } = await import('@/lib/ai/providers/openai')
    await openaiProvider.generate({
      provider: 'openai',
      model: 'gpt-5.4',
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{}' } }],
        },
        { role: 'tool', content: '{"ok":true}', tool_call_id: 'c1' },
      ],
    })
    const call = createMock.mock.calls[0][0]
    const assistantMsg = call.messages.find((m: { role: string }) => m.role === 'assistant')
    expect(assistantMsg.tool_calls).toHaveLength(1)
    expect(assistantMsg.tool_calls[0].id).toBe('c1')
  })

  it('omits cacheUsage at the adapter level when cache.enabled=false (router owns disabled presence)', async () => {
    const { openaiProvider } = await import('@/lib/ai/providers/openai')
    const result = await openaiProvider.generate({
      provider: 'openai',
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: false },
    })
    expect(result.cacheUsage).toBeUndefined()
  })

  it('omits cacheUsage when req.cache not provided (§5.4)', async () => {
    const { openaiProvider } = await import('@/lib/ai/providers/openai')
    const result = await openaiProvider.generate({
      provider: 'openai',
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(result.cacheUsage).toBeUndefined()
  })

  it('passes AbortSignal to chat.completions.create options', async () => {
    const { openaiProvider } = await import('@/lib/ai/providers/openai')
    const controller = new AbortController()
    await openaiProvider.generate({
      provider: 'openai',
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hi' }],
    }, controller.signal)
    const optionsArg = createMock.mock.calls[0][1] as { signal?: AbortSignal } | undefined
    expect(optionsArg?.signal).toBe(controller.signal)
  })

  it('omits signal option when called without one', async () => {
    const { openaiProvider } = await import('@/lib/ai/providers/openai')
    await openaiProvider.generate({
      provider: 'openai',
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hi' }],
    })
    const optionsArg = createMock.mock.calls[0][1]
    expect(optionsArg).toBeUndefined()
  })
})

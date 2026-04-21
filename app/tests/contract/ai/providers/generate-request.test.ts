import { describe, it, expect, vi, beforeEach } from 'vitest'

const anthropicNativeCreateMock = vi.fn()
const openaiCreateMock = vi.fn()
const shimCreateMock = vi.fn()

vi.mock('@/lib/ai/anthropic-client', () => ({
  getAnthropicClient: vi.fn(() => ({ messages: { create: anthropicNativeCreateMock } })),
}))

// Class-based mock so `new OpenAI(...)` works
class MockOpenAI {
  chat: { completions: { create: typeof openaiCreateMock } }
  constructor(opts?: { baseURL?: string }) {
    this.chat = {
      completions: {
        create: opts?.baseURL?.includes('anthropic') ? shimCreateMock : openaiCreateMock,
      },
    }
  }
}

vi.mock('openai', () => ({
  default: MockOpenAI,
}))

vi.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: vi.fn(async () => true) }))
vi.mock('@/lib/ai/providers/retry', () => ({ withRetry: (fn: () => Promise<unknown>) => fn() }))

const canonicalRequest = {
  provider: 'anthropic' as const,
  model: 'claude-opus-4-6',
  system: 'You are helpful.',
  tools: [{
    type: 'function' as const,
    function: { name: 'search', description: 'search tool', parameters: { type: 'object', properties: { q: { type: 'string' } } } },
  }],
  messages: [
    { role: 'user' as const, content: 'find X' },
    {
      role: 'assistant' as const,
      content: 'calling',
      tool_calls: [{ id: 'c1', type: 'function' as const, function: { name: 'search', arguments: '{"q":"X"}' } }],
    },
    { role: 'tool' as const, content: '{"hit":1}', tool_call_id: 'c1' },
  ],
}

describe('contract — Anthropic native request body', () => {
  beforeEach(() => {
    anthropicNativeCreateMock.mockReset()
    anthropicNativeCreateMock.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    })
  })
  it('matches the snapshot when cache is enabled', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    await generate({ ...canonicalRequest, cache: { enabled: true, breakpoints: ['system', 'tools'] } })
    expect(anthropicNativeCreateMock.mock.calls[0][0]).toMatchSnapshot()
  })
})

describe('contract — Anthropic OpenAI-compat shim request body', () => {
  beforeEach(() => {
    shimCreateMock.mockReset()
    shimCreateMock.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
  })
  it('matches the snapshot when cache is absent', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    await generate(canonicalRequest)
    expect(shimCreateMock.mock.calls[0][0]).toMatchSnapshot()
  })
  it('matches the snapshot when cache.enabled=false', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    await generate({ ...canonicalRequest, cache: { enabled: false } })
    expect(shimCreateMock.mock.calls[0][0]).toMatchSnapshot()
  })
})

describe('contract — OpenAI request body', () => {
  beforeEach(() => {
    openaiCreateMock.mockReset()
    openaiCreateMock.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } },
    })
  })
  it('matches the snapshot when cache is enabled', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    await generate({ ...canonicalRequest, provider: 'openai', model: 'gpt-5.4', cache: { enabled: true, key: 'test-key' } })
    expect(openaiCreateMock.mock.calls[0][0]).toMatchSnapshot()
  })
  it('matches the snapshot when cache is absent', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    await generate({ ...canonicalRequest, provider: 'openai', model: 'gpt-5.4' })
    expect(openaiCreateMock.mock.calls[0][0]).toMatchSnapshot()
  })
})

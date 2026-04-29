import { describe, it, expect, vi, beforeEach } from 'vitest'

const nativeMock = vi.fn()
const shimCreateMock = vi.fn()

vi.mock('@/lib/ai/providers/anthropic-native', () => ({
  anthropicNativeGenerate: nativeMock,
}))

class MockOpenAI {
  chat = { completions: { create: shimCreateMock } }
}

vi.mock('openai', () => ({
  default: MockOpenAI,
}))

describe('anthropicProvider.generate — branching', () => {
  beforeEach(() => {
    nativeMock.mockReset()
    shimCreateMock.mockReset()
    nativeMock.mockResolvedValue({
      content: 'native', tokensUsed: { input: 1, output: 1 }, model: 'claude-opus-4-6', provider: 'anthropic',
    })
    shimCreateMock.mockResolvedValue({
      choices: [{ message: { content: 'shim' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
  })

  it('uses the native path when cache.enabled=true', async () => {
    const { anthropicProvider } = await import('@/lib/ai/providers/anthropic')
    await anthropicProvider.generate({
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true },
    })
    expect(nativeMock).toHaveBeenCalledTimes(1)
    expect(shimCreateMock).not.toHaveBeenCalled()
  })

  it('uses the shim path when cache.enabled=false', async () => {
    const { anthropicProvider } = await import('@/lib/ai/providers/anthropic')
    await anthropicProvider.generate({
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: false },
    })
    expect(shimCreateMock).toHaveBeenCalledTimes(1)
    expect(nativeMock).not.toHaveBeenCalled()
  })

  it('uses the shim path when cache is omitted', async () => {
    const { anthropicProvider } = await import('@/lib/ai/providers/anthropic')
    await anthropicProvider.generate({
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(shimCreateMock).toHaveBeenCalledTimes(1)
    expect(nativeMock).not.toHaveBeenCalled()
  })

  it('shim path passes assistant tool_calls through to the OpenAI message shape', async () => {
    const { anthropicProvider } = await import('@/lib/ai/providers/anthropic')
    await anthropicProvider.generate({
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{}' } }],
        },
        { role: 'tool', content: '{"ok":true}', tool_call_id: 'c1' },
      ],
    })
    const call = shimCreateMock.mock.calls[0][0]
    const asst = call.messages.find((m: { role: string }) => m.role === 'assistant')
    expect(asst.tool_calls).toHaveLength(1)
    expect(asst.tool_calls[0].id).toBe('c1')
  })

  it('passes AbortSignal to chat.completions.create options', async () => {
    const { anthropicProvider } = await import('@/lib/ai/providers/anthropic')
    const controller = new AbortController()
    await anthropicProvider.generate({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
    }, controller.signal)
    const optionsArg = shimCreateMock.mock.calls[0][1] as { signal?: AbortSignal } | undefined
    expect(optionsArg?.signal).toBe(controller.signal)
  })

  it('omits signal option when called without one', async () => {
    const { anthropicProvider } = await import('@/lib/ai/providers/anthropic')
    await anthropicProvider.generate({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
    })
    const optionsArg = shimCreateMock.mock.calls[0][1]
    expect(optionsArg).toBeUndefined()
  })
})

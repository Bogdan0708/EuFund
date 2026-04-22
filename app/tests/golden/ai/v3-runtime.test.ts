import { describe, it, expect, vi, beforeEach } from 'vitest'
import { normalizeAnthropicNativeRequest, normalizeShimRequest } from './_helpers/record-replay'

const nativeCreateMock = vi.fn()
const shimCreateMock = vi.fn()

vi.mock('@/lib/ai/anthropic-client', () => ({
  getAnthropicClient: () => ({ messages: { create: nativeCreateMock } }),
}))

class MockOpenAI {
  chat = { completions: { create: shimCreateMock } }
}

vi.mock('openai', () => ({
  default: MockOpenAI,
}))
vi.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: vi.fn(async () => true) }))
vi.mock('@/lib/ai/providers/retry', () => ({ withRetry: (fn: () => Promise<unknown>) => fn() }))

const fixedNativeResponse = {
  content: [{ type: 'text', text: 'Hello there.' }],
  usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 80, cache_read_input_tokens: 0 },
}
const fixedShimResponse = {
  choices: [{ message: { content: 'Hello there.' } }],
  usage: { prompt_tokens: 100, completion_tokens: 10 },
}

describe('golden — V3 runtime no-tool parity', () => {
  beforeEach(() => {
    nativeCreateMock.mockReset()
    shimCreateMock.mockReset()
    nativeCreateMock.mockResolvedValue(fixedNativeResponse)
    shimCreateMock.mockResolvedValue(fixedShimResponse)
  })

  it('cache-on and cache-off produce the same normalized request', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    const baseReq = {
      provider: 'anthropic' as const,
      model: 'claude-opus-4-6',
      system: 'You are helpful.',
      messages: [{ role: 'user' as const, content: 'hi' }],
    }
    await generate({ ...baseReq, cache: { enabled: false } })
    const offShape = normalizeShimRequest(shimCreateMock.mock.calls[0][0])

    await generate({ ...baseReq, cache: { enabled: true, breakpoints: ['system'] } })
    const onShape = normalizeAnthropicNativeRequest(nativeCreateMock.mock.calls[0][0])

    expect(onShape.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(offShape.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(offShape.model).toBe(onShape.model)
  })

  it('cache-on request has cache_control blocks; cache-off does not', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    const baseReq = {
      provider: 'anthropic' as const,
      model: 'claude-opus-4-6',
      system: 'You are helpful.',
      messages: [{ role: 'user' as const, content: 'hi' }],
    }
    await generate({ ...baseReq, cache: { enabled: true, breakpoints: ['system'] } })
    const nativeBody = nativeCreateMock.mock.calls[0][0] as { system: unknown }
    expect(JSON.stringify(nativeBody.system)).toContain('cache_control')

    await generate({ ...baseReq, cache: { enabled: false } })
    const shimBody = shimCreateMock.mock.calls[0][0] as { messages: unknown }
    expect(JSON.stringify(shimBody)).not.toContain('cache_control')
  })
})

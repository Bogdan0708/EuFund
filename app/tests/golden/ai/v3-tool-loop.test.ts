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

describe('golden — V3 tool-loop parity', () => {
  beforeEach(() => {
    nativeCreateMock.mockReset()
    shimCreateMock.mockReset()
  })

  const tooledRequest = (cache: { enabled: boolean; breakpoints?: ('system' | 'tools')[] } | undefined) => ({
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
    ...(cache ? { cache } : {}),
  })

  it('normalized request shapes match between cache-on and cache-off for a tool-loop turn', async () => {
    nativeCreateMock.mockResolvedValue({
      content: [{ type: 'text', text: 'Found X.' }],
      usage: { input_tokens: 50, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    })
    shimCreateMock.mockResolvedValue({
      choices: [{ message: { content: 'Found X.' } }],
      usage: { prompt_tokens: 50, completion_tokens: 10 },
    })

    const { generate } = await import('@/lib/ai/providers/router')

    await generate(tooledRequest(undefined))
    const offShape = normalizeShimRequest(shimCreateMock.mock.calls[0][0])

    await generate(tooledRequest({ enabled: true, breakpoints: ['system', 'tools'] }))
    const onShape = normalizeAnthropicNativeRequest(nativeCreateMock.mock.calls[0][0])

    // Shim shape keeps OpenAI-style messages (role:'tool' entries as-is).
    // Native shape groups tool_result into a user message. The two aren't byte-equal
    // across shapes — but within each provider, the message SEMANTICS preserve: assistant
    // message with one tool_use, immediately followed by a tool_result for c1.
    const onMessages = onShape.messages as Array<{ role: string; content: unknown }>
    expect(onMessages).toHaveLength(3)
    expect(onMessages[1].role).toBe('assistant')
    expect(JSON.stringify(onMessages[1].content)).toContain('tool_use')
    expect(JSON.stringify(onMessages[1].content)).toContain('c1')
    expect(onMessages[2].role).toBe('user')
    expect(JSON.stringify(onMessages[2].content)).toContain('tool_result')

    const offMessages = offShape.messages as Array<{ role: string; tool_calls?: unknown; tool_call_id?: string }>
    const assistantInOff = offMessages.find((m) => m.role === 'assistant')
    expect(assistantInOff?.tool_calls).toBeDefined()
    const toolInOff = offMessages.find((m) => m.role === 'tool')
    expect(toolInOff?.tool_call_id).toBe('c1')
  })

  it('cache-on native body has cache_control on system + last tool', async () => {
    nativeCreateMock.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    })
    const { generate } = await import('@/lib/ai/providers/router')
    await generate(tooledRequest({ enabled: true, breakpoints: ['system', 'tools'] }))
    const body = nativeCreateMock.mock.calls[0][0] as { system: unknown; tools: Array<{ cache_control?: unknown }> }
    expect(JSON.stringify(body.system)).toContain('cache_control')
    expect(body.tools[body.tools.length - 1].cache_control).toBeDefined()
  })
})

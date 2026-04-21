import { describe, it, expect, vi } from 'vitest'
import { translateRequestToAnthropic, translateResponseFromAnthropic, clampTtl, anthropicNativeGenerate } from '@/lib/ai/providers/anthropic-native'
import type { GenerateRequest } from '@/lib/ai/providers/types'

vi.mock('@/lib/ai/anthropic-client', () => ({
  getAnthropicClient: vi.fn(() => ({
    messages: {
      create: vi.fn(async () => ({
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      })),
    },
  })),
}))

const baseReq: GenerateRequest = {
  provider: 'anthropic',
  model: 'claude-opus-4-6',
  system: 'You are helpful.',
  messages: [{ role: 'user', content: 'hi' }],
  tools: [
    { type: 'function', function: { name: 'a', description: 'a tool', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'b', description: 'b tool', parameters: { type: 'object', properties: {} } } },
  ],
  cache: { enabled: true, breakpoints: ['system', 'tools'] },
}

describe('translateRequestToAnthropic — system block', () => {
  it('wraps system into a text block with cache_control when breakpoints includes system', () => {
    const out = translateRequestToAnthropic(baseReq)
    expect(out.system).toEqual([
      { type: 'text', text: 'You are helpful.', cache_control: { type: 'ephemeral' } },
    ])
  })

  it('wraps system into a plain text block when breakpoints omits system', () => {
    const out = translateRequestToAnthropic({
      ...baseReq,
      cache: { enabled: true, breakpoints: ['tools'] },
    })
    expect(out.system).toEqual([{ type: 'text', text: 'You are helpful.' }])
  })

  it('omits system entirely when req.system is undefined', () => {
    const out = translateRequestToAnthropic({ ...baseReq, system: undefined })
    expect(out.system).toBeUndefined()
  })
})

describe('translateRequestToAnthropic — tools', () => {
  it('converts OpenAI-shape tools to Anthropic native shape', () => {
    const out = translateRequestToAnthropic(baseReq)
    expect(out.tools).toEqual([
      { name: 'a', description: 'a tool', input_schema: { type: 'object', properties: {} }, cache_control: undefined },
      { name: 'b', description: 'b tool', input_schema: { type: 'object', properties: {} }, cache_control: { type: 'ephemeral' } },
    ])
  })

  it('stamps cache_control only on the LAST tool when breakpoints includes tools', () => {
    const out = translateRequestToAnthropic(baseReq)
    expect(out.tools![0].cache_control).toBeUndefined()
    expect(out.tools![out.tools!.length - 1].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('does not stamp any tool when breakpoints omits tools', () => {
    const out = translateRequestToAnthropic({ ...baseReq, cache: { enabled: true, breakpoints: ['system'] } })
    for (const t of out.tools!) expect(t.cache_control).toBeUndefined()
  })
})

describe('translateRequestToAnthropic — messages', () => {
  const withMessages = (messages: GenerateRequest['messages']): GenerateRequest => ({
    ...baseReq,
    messages,
    tools: undefined,
    cache: { enabled: false },
  })

  it('passes plain user message through', () => {
    const out = translateRequestToAnthropic(withMessages([{ role: 'user', content: 'hello' }]))
    expect(out.messages).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('passes plain assistant message (no tool_calls) through as string content', () => {
    const out = translateRequestToAnthropic(withMessages([{ role: 'assistant', content: 'hi back' }]))
    expect(out.messages).toEqual([{ role: 'assistant', content: 'hi back' }])
  })

  it('translates assistant with tool_calls to content blocks (text + tool_use)', () => {
    const out = translateRequestToAnthropic(withMessages([
      {
        role: 'assistant',
        content: 'calling tool',
        tool_calls: [{
          id: 'toolu_1',
          type: 'function',
          function: { name: 'search', arguments: '{"q":"x"}' },
        }],
      },
    ]))
    expect(out.messages).toEqual([{
      role: 'assistant',
      content: [
        { type: 'text', text: 'calling tool' },
        { type: 'tool_use', id: 'toolu_1', name: 'search', input: { q: 'x' } },
      ],
    }])
  })

  it('omits the text block when assistant content is empty alongside tool_calls', () => {
    const out = translateRequestToAnthropic(withMessages([
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 't1', type: 'function', function: { name: 's', arguments: '{}' } }],
      },
    ]))
    expect(out.messages[0]).toEqual({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't1', name: 's', input: {} }],
    })
  })

  it('wraps a single tool-role message into a user message with a single tool_result block', () => {
    const out = translateRequestToAnthropic(withMessages([
      { role: 'tool', content: '{"ok":true}', tool_call_id: 'toolu_1' },
    ]))
    expect(out.messages).toEqual([{
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true}' }],
    }])
  })

  it('groups contiguous tool messages into one user message with ordered tool_result blocks (§6.1)', () => {
    const out = translateRequestToAnthropic(withMessages([
      { role: 'tool', content: 'first', tool_call_id: 'toolu_a' },
      { role: 'tool', content: 'second', tool_call_id: 'toolu_b' },
    ]))
    expect(out.messages).toEqual([{
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_a', content: 'first' },
        { type: 'tool_result', tool_use_id: 'toolu_b', content: 'second' },
      ],
    }])
  })

  it('starts a new user group when a non-tool message breaks contiguity', () => {
    const out = translateRequestToAnthropic(withMessages([
      { role: 'tool', content: 'a', tool_call_id: 't_a' },
      { role: 'assistant', content: 'thinking' },
      { role: 'tool', content: 'b', tool_call_id: 't_b' },
    ]))
    expect(out.messages).toHaveLength(3)
    expect(out.messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't_a', content: 'a' }],
    })
    expect(out.messages[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't_b', content: 'b' }],
    })
  })

  it('hoists a system-role message to an additional (uncached) top-level system block', () => {
    const out = translateRequestToAnthropic({
      ...baseReq,
      system: 'Main system prompt.',
      messages: [
        { role: 'system', content: 'Previous conversation summary:\nfoo' },
        { role: 'user', content: 'hi' },
      ],
      tools: undefined,
      cache: { enabled: true, breakpoints: ['system'] },
    })
    // Main system block is cached; hoisted history summary is appended uncached.
    expect(out.system).toEqual([
      { type: 'text', text: 'Main system prompt.', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'Previous conversation summary:\nfoo' },
    ])
    // The system-role message is removed from messages.
    expect(out.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('hoists multiple system-role messages in order, after the req.system block', () => {
    const out = translateRequestToAnthropic({
      ...baseReq,
      system: undefined,
      messages: [
        { role: 'system', content: 'first' },
        { role: 'user', content: 'hi' },
        { role: 'system', content: 'second' },
      ],
      tools: undefined,
      cache: { enabled: false },
    })
    expect(out.system).toEqual([
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' },
    ])
  })
})

describe('translateResponseFromAnthropic', () => {
  it('extracts text content from text blocks', () => {
    const result = translateResponseFromAnthropic({
      content: [{ type: 'text', text: 'hello' }],
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    }, { model: 'claude-opus-4-6' })
    expect(result.content).toBe('hello')
    expect(result.toolCalls).toBeUndefined()
  })

  it('extracts tool_use blocks into router toolCalls shape', () => {
    const result = translateResponseFromAnthropic({
      content: [
        { type: 'text', text: 'calling' },
        { type: 'tool_use', id: 'toolu_1', name: 'search', input: { q: 'x' } },
      ],
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    }, { model: 'claude-opus-4-6' })
    expect(result.content).toBe('calling')
    expect(result.toolCalls).toEqual([{ id: 'toolu_1', name: 'search', arguments: '{"q":"x"}' }])
  })

  it('populates cacheUsage when request.cache is present', () => {
    const result = translateResponseFromAnthropic({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 500, cache_read_input_tokens: 1200 },
    }, {
      model: 'claude-opus-4-6',
      cacheRequested: { enabled: true },
      identityKey: 'a'.repeat(64),
    })
    expect(result.cacheUsage).toEqual({
      requested: true,
      enabled: true,
      disabledReason: 'none',
      identityKey: 'a'.repeat(64),
      supported: true,
      reads: 1200,
      writes: 500,
      hit: 'read',
    })
  })

  it('hit=miss when reads is zero', () => {
    const result = translateResponseFromAnthropic({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 500, cache_read_input_tokens: 0 },
    }, { model: 'claude-opus-4-6', cacheRequested: { enabled: true }, identityKey: 'b'.repeat(64) })
    expect(result.cacheUsage!.hit).toBe('miss')
  })

  it('no cacheUsage when cacheRequested omitted', () => {
    const result = translateResponseFromAnthropic({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 100, output_tokens: 20 },
    }, { model: 'claude-opus-4-6' })
    expect(result.cacheUsage).toBeUndefined()
  })
})

describe('clampTtl', () => {
  it('returns the input when <= 300', () => {
    expect(clampTtl(120)).toEqual({ effective: 120, clamped: false })
    expect(clampTtl(300)).toEqual({ effective: 300, clamped: false })
  })

  it('clamps to 300 and flags when > 300', () => {
    expect(clampTtl(600)).toEqual({ effective: 300, clamped: true })
  })

  it('returns undefined effective when input is undefined', () => {
    expect(clampTtl(undefined)).toEqual({ effective: undefined, clamped: false })
  })
})

describe('anthropicNativeGenerate — end to end', () => {
  it('sends the translated request and returns router-shape result with cacheUsage', async () => {
    const result = await anthropicNativeGenerate({
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true, breakpoints: ['system'] },
    })
    expect(result.content).toBe('hi')
    expect(result.cacheUsage).toBeDefined()
    expect(result.cacheUsage!.supported).toBe(true)
  })

  it('passes effectiveTtlSeconds back when caller provided ttlSeconds', async () => {
    const result = await anthropicNativeGenerate({
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true, breakpoints: ['system'], ttlSeconds: 600 },
    })
    expect(result.cacheUsage!.effectiveTtlSeconds).toBe(300)
  })
})

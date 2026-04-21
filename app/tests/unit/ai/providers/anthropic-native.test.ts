import { describe, it, expect } from 'vitest'
import { translateRequestToAnthropic } from '@/lib/ai/providers/anthropic-native'
import type { GenerateRequest } from '@/lib/ai/providers/types'

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

import { describe, it, expect } from 'vitest'
import {
  translateAnthropicEvent,
  createTranslatorContext,
} from '@/lib/ai/agent/managed/translator'

// Use a permissive cast for synthetic stream events — the SDK types
// are branded and strict, but the runtime only cares about the shape.
type AnyEvent = Record<string, unknown>

describe('translateAnthropicEvent', () => {
  it('message_start captures model and emits nothing', () => {
    const tctx = createTranslatorContext()
    const event: AnyEvent = {
      type: 'message_start',
      message: {
        id: 'msg_1', type: 'message', role: 'assistant',
        model: 'claude-sonnet-4-6', content: [],
        stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 0 },
      },
    }
    const result = translateAnthropicEvent(event as never, tctx)
    expect(result).toBeNull()
    expect(tctx.messageModel).toBe('claude-sonnet-4-6')
  })

  it('content_block_start type=text emits nothing', () => {
    const tctx = createTranslatorContext()
    const event: AnyEvent = {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    }
    expect(translateAnthropicEvent(event as never, tctx)).toBeNull()
  })

  it('content_block_start type=tool_use emits tool_start with empty input', () => {
    const tctx = createTranslatorContext()
    const event: AnyEvent = {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'tu_1', name: 'search_calls', input: {} },
    }
    const result = translateAnthropicEvent(event as never, tctx)
    expect(result).toEqual({ type: 'tool_start', tool: 'search_calls', input: {} })
  })

  it('content_block_delta text_delta emits text_delta', () => {
    const tctx = createTranslatorContext()
    const event: AnyEvent = {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Salut' },
    }
    const result = translateAnthropicEvent(event as never, tctx)
    expect(result).toEqual({ type: 'text_delta', content: 'Salut' })
  })

  it('content_block_delta input_json_delta emits nothing', () => {
    const tctx = createTranslatorContext()
    const event: AnyEvent = {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"query":' },
    }
    expect(translateAnthropicEvent(event as never, tctx)).toBeNull()
  })

  it('content_block_delta thinking_delta emits nothing', () => {
    const tctx = createTranslatorContext()
    const event: AnyEvent = {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'Let me think...' },
    }
    expect(translateAnthropicEvent(event as never, tctx)).toBeNull()
  })

  it('content_block_stop emits nothing', () => {
    const tctx = createTranslatorContext()
    const event: AnyEvent = { type: 'content_block_stop', index: 0 }
    expect(translateAnthropicEvent(event as never, tctx)).toBeNull()
  })

  it('message_delta with stop_reason=max_tokens emits error', () => {
    const tctx = createTranslatorContext()
    const event: AnyEvent = {
      type: 'message_delta',
      delta: { stop_reason: 'max_tokens', stop_sequence: null },
      usage: { output_tokens: 4096 },
    }
    const result = translateAnthropicEvent(event as never, tctx)
    expect(result).toEqual({
      type: 'error',
      message: 'Response truncated: model hit max token limit.',
      retryable: true,
    })
  })

  it('message_delta with stop_reason=end_turn emits nothing', () => {
    const tctx = createTranslatorContext()
    const event: AnyEvent = {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 500 },
    }
    expect(translateAnthropicEvent(event as never, tctx)).toBeNull()
  })

  it('message_delta with stop_reason=tool_use emits nothing', () => {
    const tctx = createTranslatorContext()
    const event: AnyEvent = {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { output_tokens: 300 },
    }
    expect(translateAnthropicEvent(event as never, tctx)).toBeNull()
  })

  it('message_stop emits nothing', () => {
    const tctx = createTranslatorContext()
    const event: AnyEvent = { type: 'message_stop' }
    expect(translateAnthropicEvent(event as never, tctx)).toBeNull()
  })
})

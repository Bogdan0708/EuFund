// ── Anthropic stream → AgentEvent translator ────────────────────
// Side-effect-free mapping function with caller-owned context.
// Returns null for events the frontend does not care about.
// The only state the translator touches is `tctx.messageModel`,
// written once when `message_start` is observed.

import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages'
import type { AgentEvent } from '../types'

export interface TranslatorContext {
  messageModel: string | null
}

export function createTranslatorContext(): TranslatorContext {
  return { messageModel: null }
}

export function translateAnthropicEvent(
  event: RawMessageStreamEvent,
  tctx: TranslatorContext,
): AgentEvent | null {
  switch (event.type) {
    case 'message_start': {
      tctx.messageModel = event.message.model
      return null
    }

    case 'content_block_start': {
      if (event.content_block.type === 'tool_use') {
        return {
          type: 'tool_start',
          tool: event.content_block.name,
          input: {},
        }
      }
      return null
    }

    case 'content_block_delta': {
      if (event.delta.type === 'text_delta') {
        return { type: 'text_delta', content: event.delta.text }
      }
      return null
    }

    case 'content_block_stop':
      return null

    case 'message_delta': {
      if (event.delta.stop_reason === 'max_tokens') {
        return {
          type: 'error',
          message: 'Response truncated: model hit max token limit.',
          retryable: true,
        }
      }
      return null
    }

    case 'message_stop':
      return null

    default:
      return null
  }
}

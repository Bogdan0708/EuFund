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
        let content = event.delta.text

        // Desk Audit Fix #15: Tool payload leakage scrubbing.
        // Prevent the model from quoting raw tool_result error prefixes
        // (CONCURRENCY, VALIDATION, NOT_FOUND, etc.) in its free-text
        // response. These prefixes are used by the executor to signal
        // errors back to the model, but should not leak to the user.
        //
        // Pattern: Matches a capital-case error prefix at the start of a
        // delta or after a newline. Since deltas can be small, we apply
        // this broadly but safely.
        const RAW_ERROR_PREFIXES = [
          'CONCURRENCY:',
          'VALIDATION:',
          'NOT_FOUND:',
          'AUTHORIZATION:',
          'POLICY:',
          'EXTERNAL_DEPENDENCY:',
          'INTERNAL:',
          'GENERIC:',
          'PARALLEL_WRITE_BLOCKED:',
        ]

        for (const prefix of RAW_ERROR_PREFIXES) {
          if (content.includes(prefix)) {
            content = content.replace(prefix, '').trimStart()
          }
        }

        return { type: 'text_delta', content }
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

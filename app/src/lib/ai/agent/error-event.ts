// app/src/lib/ai/agent/error-event.ts
//
// Issue #83 item 3: builds the SSE error event the route emits when
// runAgentTurn rejects. Single sanitization boundary — clients never see
// raw Error.message strings (which could carry session UUIDs / tool_call_ids
// / English-only internal text) and always receive a locale-selected
// bilingual message via the existing FondEUError envelope.
//
// Item 2 made the route the only emitter of SSE errors, so this helper is
// the only thing that builds the payload in production code paths.

import type { AgentEvent } from './types'
import { FondEUError, Errors } from '@/lib/errors'

// Narrow the return to the error variant so callers can read .message and
// .retryable without re-narrowing the AgentEvent union.
export type AgentErrorEvent = Extract<AgentEvent, { type: 'error' }>

export function buildAgentErrorEvent(error: unknown, locale: 'ro' | 'en'): AgentErrorEvent {
  const fondError =
    error instanceof FondEUError
      ? error
      : Errors.internal()
  return {
    type: 'error',
    message: locale === 'ro' ? fondError.messageRo : fondError.messageEn,
    retryable: fondError.retryable,
  }
}

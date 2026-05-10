// app/tests/unit/agent-error-event.test.ts
//
// Issue #83 item 3: SSE error events must carry bilingual, locale-selected,
// UUID-stripped messages — never the raw thrown error string. The route layer
// is the only place SSE errors get emitted (item 2), so the helper that
// builds the event is the single sanitization boundary.

import { describe, it, expect } from 'vitest'
import { buildAgentErrorEvent } from '@/lib/ai/agent/error-event'
import { FondEUError, Errors } from '@/lib/errors'

describe('buildAgentErrorEvent', () => {
  it('wraps unknown errors with Errors.internal() — never leaks raw message', () => {
    const event = buildAgentErrorEvent(
      new Error('agent-runtime: tool history row missing toolCallId (sessionId=11111111-1111-4111-8111-111111111111)'),
      'ro',
    )
    expect(event.type).toBe('error')
    // Must be the safe Romanian Errors.internal() message — not the raw throw.
    expect(event.message).toBe('A apărut o eroare internă. Vă rugăm să încercați din nou.')
    expect(event.message).not.toMatch(/sessionId|11111111/)
    expect(event.message).not.toContain('toolCallId')
    // internal() is retryable per the factory.
    expect(event.retryable).toBe(true)
  })

  it('uses messageEn for locale=en', () => {
    const event = buildAgentErrorEvent(new Error('boom'), 'en')
    expect(event.message).toBe('An internal error occurred. Please try again.')
  })

  it('uses the FondEUError bilingual messages when the error is one already', () => {
    const fondError = Errors.rateLimited(5_000)
    const ro = buildAgentErrorEvent(fondError, 'ro')
    const en = buildAgentErrorEvent(fondError, 'en')
    expect(ro.message).toBe('Prea multe cereri. Vă rugăm să așteptați.')
    expect(en.message).toBe('Too many requests. Please wait.')
    expect(ro.retryable).toBe(true)
  })

  it('preserves retryable=false for non-retryable FondEUError', () => {
    const event = buildAgentErrorEvent(Errors.unauthorized(), 'ro')
    expect(event.retryable).toBe(false)
  })

  it('handles non-Error throwables (string, undefined) without leaking them', () => {
    const fromString = buildAgentErrorEvent('weird raw string with id 12345-6789', 'ro')
    expect(fromString.message).not.toContain('weird raw string')
    expect(fromString.message).not.toContain('12345-6789')

    const fromUndefined = buildAgentErrorEvent(undefined, 'ro')
    expect(fromUndefined.message).toBe('A apărut o eroare internă. Vă rugăm să încercați din nou.')
  })

  it('returns a typed AgentEvent with type=error', () => {
    const event = buildAgentErrorEvent(new FondEUError({
      code: 'VALIDATION_ERROR',
      messageRo: 'Câmp invalid.',
      messageEn: 'Invalid field.',
      statusCode: 400,
      retryable: false,
    }), 'en')
    expect(event).toEqual({ type: 'error', message: 'Invalid field.', retryable: false })
  })
})

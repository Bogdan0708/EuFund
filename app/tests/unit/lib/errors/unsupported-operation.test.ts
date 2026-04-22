import { describe, it, expect } from 'vitest'
import { UnsupportedOperationError } from '@/lib/errors'

describe('UnsupportedOperationError', () => {
  it('carries a provider + feature descriptor in the message', () => {
    const err = new UnsupportedOperationError('google', 'tool_calls in messages')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('UnsupportedOperationError')
    expect(err.message).toContain('google')
    expect(err.message).toContain('tool_calls in messages')
  })

  it('exposes provider and feature as readable fields', () => {
    const err = new UnsupportedOperationError('perplexity', 'cache.breakpoints.tools')
    expect(err.provider).toBe('perplexity')
    expect(err.feature).toBe('cache.breakpoints.tools')
  })
})

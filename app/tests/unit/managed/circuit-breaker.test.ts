import { describe, it, expect, beforeEach } from 'vitest'
import {
  managedCircuitBreaker,
  recordManagedFailure,
  _resetForTest,
} from '@/lib/ai/agent/managed/circuit-breaker'

describe('managedCircuitBreaker', () => {
  beforeEach(() => {
    _resetForTest()
  })

  it('starts closed', () => {
    expect(managedCircuitBreaker.isOpen()).toBe(false)
  })

  it('stays closed after 1 failure', () => {
    recordManagedFailure('anthropic_unavailable')
    expect(managedCircuitBreaker.isOpen()).toBe(false)
  })

  it('stays closed after 2 failures', () => {
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    expect(managedCircuitBreaker.isOpen()).toBe(false)
  })

  it('opens after 3 consecutive failures', () => {
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    expect(managedCircuitBreaker.isOpen()).toBe(true)
  })

  it('accepts all persistable DegradedReason variants', () => {
    expect(() => recordManagedFailure('anthropic_unavailable')).not.toThrow()
    _resetForTest()
    expect(() => recordManagedFailure('anthropic_timeout')).not.toThrow()
    _resetForTest()
    expect(() => recordManagedFailure('stream_disconnect')).not.toThrow()
    _resetForTest()
    expect(() => recordManagedFailure('auth_setup_failure')).not.toThrow()
  })
})

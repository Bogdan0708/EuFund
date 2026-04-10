import { describe, it, expect, beforeEach } from 'vitest'
import {
  managedCircuitBreaker,
  recordManagedFailure,
  recordManagedSuccess,
  __resetBreakerForTests,
} from '@/lib/ai/agent/managed/circuit-breaker'

describe('managedCircuitBreaker', () => {
  beforeEach(() => {
    __resetBreakerForTests()
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

  it('resets failure count on success', () => {
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    recordManagedSuccess()
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    // Only 2 consecutive failures since last success
    expect(managedCircuitBreaker.isOpen()).toBe(false)
  })

  it('accepts all persistable DegradedReason variants', () => {
    expect(() => recordManagedFailure('anthropic_unavailable')).not.toThrow()
    __resetBreakerForTests()
    expect(() => recordManagedFailure('anthropic_timeout')).not.toThrow()
    __resetBreakerForTests()
    expect(() => recordManagedFailure('stream_disconnect')).not.toThrow()
    __resetBreakerForTests()
    expect(() => recordManagedFailure('auth_setup_failure')).not.toThrow()
  })
})

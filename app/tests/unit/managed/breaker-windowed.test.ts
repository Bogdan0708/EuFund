import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('managed breaker — rolling window', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
  })

  it('opens on 3 failures within 5 minutes', async () => {
    const { managedCircuitBreaker, recordManagedFailure, _resetForTest } = await import('@/lib/ai/agent/managed/circuit-breaker')
    _resetForTest()
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    expect(managedCircuitBreaker.isOpen()).toBe(true)
  })

  it('does NOT open when failures are spaced >5 minutes apart', async () => {
    const { managedCircuitBreaker, recordManagedFailure, _resetForTest } = await import('@/lib/ai/agent/managed/circuit-breaker')
    _resetForTest()
    recordManagedFailure('anthropic_unavailable')
    vi.advanceTimersByTime(6 * 60_000)
    recordManagedFailure('anthropic_unavailable')
    vi.advanceTimersByTime(6 * 60_000)
    recordManagedFailure('anthropic_unavailable')
    expect(managedCircuitBreaker.isOpen()).toBe(false)
  })

  it('stays open during 30s cooldown then allows exactly one probe', async () => {
    const { managedCircuitBreaker, recordManagedFailure, _resetForTest } = await import('@/lib/ai/agent/managed/circuit-breaker')
    _resetForTest()
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    expect(managedCircuitBreaker.isOpen()).toBe(true)
    vi.advanceTimersByTime(20_000)
    expect(managedCircuitBreaker.isOpen()).toBe(true)
    vi.advanceTimersByTime(15_000)
    // First caller after cooldown claims the probe slot — gets through.
    expect(managedCircuitBreaker.isOpen()).toBe(false)
    // Second concurrent caller sees breaker as still open until the probe resolves.
    expect(managedCircuitBreaker.isOpen()).toBe(true)
  })

  it('probe failure re-opens immediately without waiting for 3-failure window', async () => {
    const { managedCircuitBreaker, recordManagedFailure, _resetForTest } = await import('@/lib/ai/agent/managed/circuit-breaker')
    _resetForTest()
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    vi.advanceTimersByTime(35_000)
    expect(managedCircuitBreaker.isOpen()).toBe(false)  // probe claimed
    recordManagedFailure('anthropic_unavailable')       // probe fails
    expect(managedCircuitBreaker.isOpen()).toBe(true)   // re-opened
  })

  it('probe success closes the breaker', async () => {
    const { managedCircuitBreaker, recordManagedFailure, recordManagedSuccess, _resetForTest } = await import('@/lib/ai/agent/managed/circuit-breaker')
    _resetForTest()
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    vi.advanceTimersByTime(35_000)
    expect(managedCircuitBreaker.isOpen()).toBe(false)
    recordManagedSuccess()
    expect(managedCircuitBreaker.isOpen()).toBe(false)
    // After close, normal semantics resume.
    recordManagedFailure('anthropic_unavailable')
    expect(managedCircuitBreaker.isOpen()).toBe(false)
  })
})

// ── Managed-agent circuit breaker ───────────────────────────────
// Per-process in-memory breaker that protects the managed runtime
// from cascading Anthropic API failures. 3 consecutive failures
// open the breaker; a 30s cooldown precedes a half-open probe on
// the next request. Standalone implementation — does not share state
// with the general-purpose CircuitBreaker in @/lib/errors.

export type DegradedReason =
  | 'circuit_open'
  | 'anthropic_unavailable'   // 401, 429, 5xx
  | 'anthropic_timeout'
  | 'stream_disconnect'
  | 'auth_setup_failure'

type BreakerState = 'closed' | 'open'

const FAILURE_THRESHOLD = 3
const COOLDOWN_MS = 30_000

let consecutiveFailures = 0
let state: BreakerState = 'closed'
let openedAt = 0

export const managedCircuitBreaker = {
  /**
   * Returns true if requests should be short-circuited to V3.
   * If the breaker was open but the cooldown has elapsed, transitions
   * back to closed (half-open probe) and returns false so the next
   * request is allowed to try the managed runtime.
   */
  isOpen(): boolean {
    if (state === 'open') {
      if (Date.now() - openedAt >= COOLDOWN_MS) {
        // Cooldown elapsed — allow a probe attempt
        state = 'closed'
        consecutiveFailures = 0
        return false
      }
      return true
    }
    return false
  },
}

export function recordManagedFailure(_reason: DegradedReason): void {
  consecutiveFailures += 1
  if (consecutiveFailures >= FAILURE_THRESHOLD) {
    state = 'open'
    openedAt = Date.now()
  }
}

export function recordManagedSuccess(): void {
  consecutiveFailures = 0
  state = 'closed'
}

// Test-only reset. Do not call from production code.
export function __resetBreakerForTests(): void {
  consecutiveFailures = 0
  state = 'closed'
  openedAt = 0
}

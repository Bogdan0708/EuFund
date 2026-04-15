// ── Managed-agent circuit breaker ───────────────────────────────
// Per-process in-memory breaker that protects the managed runtime
// from cascading Anthropic API failures. Rolling 5-min window:
// 3 failures within the window open the breaker for a 30s cooldown,
// then one half-open probe is allowed. Probe success closes the
// breaker; probe failure re-opens it immediately. Standalone
// implementation — does not share state with the general-purpose
// CircuitBreaker in @/lib/errors.

// DegradedReason — the set of reasons the managed runtime can persist
// to application_agent_sessions.degraded_reason. This is deliberately
// narrower than "all the ways we might fall back". In particular,
// `circuit_open` is NOT in the union: when the breaker is open, the
// route degrades to V3 without creating a managed session row, so there
// is nothing to mark degraded. If Phase 3 wants to surface open-breaker
// events in observability, add it back AND persist it at the same time.
export type DegradedReason =
  | 'anthropic_unavailable'   // 401, 429, 5xx
  | 'anthropic_timeout'
  | 'stream_disconnect'
  | 'auth_setup_failure'

type BreakerState = 'closed' | 'open' | 'half_open'

const FAILURE_THRESHOLD = 3
const WINDOW_MS = 5 * 60_000
const COOLDOWN_MS = 30_000

let failureTimestamps: number[] = []
let state: BreakerState = 'closed'
let openedAt = 0
let probeInFlight = false

function pruneWindow(now: number): void {
  const cutoff = now - WINDOW_MS
  failureTimestamps = failureTimestamps.filter(t => t >= cutoff)
}

export const managedCircuitBreaker = {
  /**
   * Returns true if the request should be short-circuited to V3.
   *
   * Transitions:
   *  - closed: allow all requests.
   *  - open: reject all until cooldown elapses, then transition to half_open.
   *  - half_open: allow exactly ONE probe request. All concurrent callers
   *    after the probe is claimed continue to see open=true until the
   *    probe reports via recordManagedSuccess/recordManagedFailure.
   */
  isOpen(): boolean {
    const now = Date.now()

    if (state === 'open' && now - openedAt >= COOLDOWN_MS) {
      state = 'half_open'
      probeInFlight = false
    }

    if (state === 'open') return true

    if (state === 'half_open') {
      if (probeInFlight) return true     // probe already out; hold others
      probeInFlight = true                // claim the single probe slot
      return false
    }

    return false
  },
}

export function recordManagedSuccess(): void {
  // A successful turn (or probe) closes the breaker.
  if (state === 'half_open' || state === 'open') {
    state = 'closed'
    failureTimestamps = []
    openedAt = 0
    probeInFlight = false
    return
  }
  // Steady-state success prunes expired failures but does not zero them;
  // a single success should not let a long-running bad run cross the
  // window without penalty.
  pruneWindow(Date.now())
}

export function recordManagedFailure(reason: DegradedReason): void {
  // `reason` is part of the contract: route.ts and session-metadata.ts
  // classify failures and persist the reason to application_agent_sessions.
  // The breaker itself only counts failures, but keeping reason in the
  // signature lets callers pass classification through a single call site.
  void reason
  const now = Date.now()

  // Probe failure during half_open re-opens immediately, regardless of
  // the rolling-window count — the probe's whole purpose is a single-shot
  // trust check.
  if (state === 'half_open') {
    state = 'open'
    openedAt = now
    probeInFlight = false
    return
  }

  pruneWindow(now)
  failureTimestamps.push(now)
  if (failureTimestamps.length >= FAILURE_THRESHOLD) {
    state = 'open'
    openedAt = now
    probeInFlight = false
  }
}

/** Test-only. Resets breaker state between vitest cases. */
export function _resetForTest(): void {
  failureTimestamps = []
  state = 'closed'
  openedAt = 0
  probeInFlight = false
}

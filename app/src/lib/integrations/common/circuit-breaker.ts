// ─── Circuit Breaker ─────────────────────────────────────────────
// Prevents cascading failures when external APIs are down
import { trackExternalAPI } from '@/lib/monitoring/metrics';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenRequests: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
  halfOpenRequests: 1,
};

interface CircuitRecord {
  state: CircuitState;
  failures: number;
  lastFailureAt: number;
  halfOpenAttempts: number;
}

const circuits = new Map<string, CircuitRecord>();

function getCircuit(key: string): CircuitRecord {
  if (!circuits.has(key)) {
    circuits.set(key, { state: 'closed', failures: 0, lastFailureAt: 0, halfOpenAttempts: 0 });
  }
  return circuits.get(key)!;
}

export function getCircuitState(key: string): CircuitState {
  const circuit = getCircuit(key);
  if (circuit.state === 'open') {
    if (Date.now() - circuit.lastFailureAt >= DEFAULT_CONFIG.resetTimeoutMs) {
      circuit.state = 'half-open';
      circuit.halfOpenAttempts = 0;
    }
  }
  return circuit.state;
}

export class CircuitOpenError extends Error {
  constructor(key: string) {
    super(`Circuit breaker open for: ${key}`);
    this.name = 'CircuitOpenError';
  }
}

export async function withCircuitBreaker<T>(
  key: string,
  fn: () => Promise<T>,
  config: Partial<CircuitBreakerConfig> = {},
): Promise<T> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const circuit = getCircuit(key);
  const state = getCircuitState(key);

  if (state === 'open') {
    trackExternalAPI(key, false, 0);
    throw new CircuitOpenError(key);
  }

  if (state === 'half-open' && circuit.halfOpenAttempts >= cfg.halfOpenRequests) {
    trackExternalAPI(key, false, 0);
    throw new CircuitOpenError(key);
  }

  const startedAt = Date.now();

  try {
    if (state === 'half-open') circuit.halfOpenAttempts++;
    const result = await fn();
    // Success: reset circuit
    circuit.state = 'closed';
    circuit.failures = 0;
    circuit.halfOpenAttempts = 0;
    trackExternalAPI(key, true, Date.now() - startedAt);
    return result;
  } catch (error) {
    circuit.failures++;
    circuit.lastFailureAt = Date.now();
    if (circuit.failures >= cfg.failureThreshold) {
      circuit.state = 'open';
    }
    trackExternalAPI(key, false, Date.now() - startedAt);
    throw error;
  }
}

export function resetCircuit(key: string): void {
  circuits.delete(key);
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canMakeRequest, recordRequest, withRateLimit } from '@/lib/integrations/common/rate-limiter';
import { withCircuitBreaker, CircuitOpenError, getCircuitState, resetCircuit } from '@/lib/integrations/common/circuit-breaker';
import { cacheGet, cacheSet, cacheDelete, withCache, cacheClear } from '@/lib/integrations/common/cache';
import { requiresSCC, getLegalBasis, DOCUMENTED_TRANSFERS } from '@/lib/integrations/common/scc';

describe('Rate Limiter', () => {
  beforeEach(() => {
    // Clear state between tests by using unique keys
  });

  it('allows requests within limit', () => {
    const key = 'test-rl-1';
    expect(canMakeRequest(key, { maxRequests: 3, windowMs: 60000, maxRetries: 0, baseDelayMs: 100, maxDelayMs: 1000 })).toBe(true);
    recordRequest(key);
    recordRequest(key);
    expect(canMakeRequest(key, { maxRequests: 3, windowMs: 60000, maxRetries: 0, baseDelayMs: 100, maxDelayMs: 1000 })).toBe(true);
    recordRequest(key);
    expect(canMakeRequest(key, { maxRequests: 3, windowMs: 60000, maxRetries: 0, baseDelayMs: 100, maxDelayMs: 1000 })).toBe(false);
  });

  it('withRateLimit executes function successfully', async () => {
    const result = await withRateLimit('test-rl-2', async () => 42, { maxRequests: 10, windowMs: 60000, maxRetries: 0, baseDelayMs: 100, maxDelayMs: 1000 });
    expect(result).toBe(42);
  });

  it('withRateLimit retries on 429', async () => {
    let attempts = 0;
    const result = await withRateLimit('test-rl-3', async () => {
      attempts++;
      if (attempts < 2) throw Object.assign(new Error('rate limit'), { status: 429 });
      return 'ok';
    }, { maxRequests: 10, windowMs: 60000, maxRetries: 3, baseDelayMs: 50, maxDelayMs: 200 });
    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });
});

describe('Circuit Breaker', () => {
  beforeEach(() => {
    resetCircuit('test-cb');
  });

  it('starts in closed state', () => {
    expect(getCircuitState('test-cb')).toBe('closed');
  });

  it('opens after failure threshold', async () => {
    for (let i = 0; i < 5; i++) {
      try {
        await withCircuitBreaker('test-cb', async () => { throw new Error('fail'); });
      } catch {}
    }
    expect(getCircuitState('test-cb')).toBe('open');
  });

  it('throws CircuitOpenError when open', async () => {
    for (let i = 0; i < 5; i++) {
      try {
        await withCircuitBreaker('test-cb', async () => { throw new Error('fail'); });
      } catch {}
    }
    await expect(
      withCircuitBreaker('test-cb', async () => 'ok'),
    ).rejects.toThrow(CircuitOpenError);
  });

  it('resets on successful call', async () => {
    const result = await withCircuitBreaker('test-cb', async () => 'success');
    expect(result).toBe('success');
    expect(getCircuitState('test-cb')).toBe('closed');
  });
});

describe('Cache', () => {
  beforeEach(() => cacheClear());

  it('stores and retrieves values', () => {
    cacheSet('key1', 'value1', 60000);
    expect(cacheGet('key1')).toBe('value1');
  });

  it('returns null for expired entries', () => {
    cacheSet('key2', 'value2', 0); // expires immediately
    expect(cacheGet('key2')).toBeNull();
  });

  it('deletes entries', () => {
    cacheSet('key3', 'value3', 60000);
    cacheDelete('key3');
    expect(cacheGet('key3')).toBeNull();
  });

  it('withCache avoids re-fetching', async () => {
    let calls = 0;
    const fn = async () => { calls++; return 'data'; };
    await withCache('key4', 60000, fn);
    await withCache('key4', 60000, fn);
    expect(calls).toBe(1);
  });
});

describe('SCC Compliance', () => {
  it('does not require SCC for EEA countries', () => {
    expect(requiresSCC('RO')).toBe(false);
    expect(requiresSCC('DE')).toBe(false);
    expect(requiresSCC('FR')).toBe(false);
  });

  it('does not require SCC for adequacy countries', () => {
    expect(requiresSCC('GB')).toBe(false);
    expect(requiresSCC('JP')).toBe(false);
  });

  it('requires SCC for non-adequate countries', () => {
    expect(requiresSCC('CN')).toBe(true);
    expect(requiresSCC('IN')).toBe(true);
  });

  it('returns correct legal basis', () => {
    expect(getLegalBasis('RO')).toBe('adequacy_decision');
    expect(getLegalBasis('CN')).toBe('scc');
  });

  it('has documented transfers for all providers', () => {
    expect(DOCUMENTED_TRANSFERS.length).toBeGreaterThanOrEqual(5);
    DOCUMENTED_TRANSFERS.forEach((t) => {
      expect(t.provider).toBeTruthy();
      expect(t.tiaPerformed).toBe(true);
    });
  });
});

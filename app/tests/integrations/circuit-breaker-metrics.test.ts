import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('withCircuitBreaker metrics tracking', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('tracks successful external API calls', async () => {
    const trackExternalAPI = vi.fn();
    vi.doMock('@/lib/monitoring/metrics', () => ({ trackExternalAPI }));

    const { withCircuitBreaker } = await import('@/lib/integrations/common/circuit-breaker');
    const result = await withCircuitBreaker('test-api', async () => 'ok');

    expect(result).toBe('ok');
    expect(trackExternalAPI).toHaveBeenCalledWith('test-api', true, expect.any(Number));
  });

  it('tracks failed external API calls', async () => {
    const trackExternalAPI = vi.fn();
    vi.doMock('@/lib/monitoring/metrics', () => ({ trackExternalAPI }));

    const { withCircuitBreaker } = await import('@/lib/integrations/common/circuit-breaker');

    await expect(
      withCircuitBreaker('test-api-fail', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(trackExternalAPI).toHaveBeenCalledWith('test-api-fail', false, expect.any(Number));
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

// Parser-level coverage for searchEURLex: mocks global fetch with a realistic
// SPARQL endpoint response and asserts the parser maps bindings into
// EURLexSearchResult[] correctly.

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubWrappers() {
  vi.doMock('@/lib/integrations/common/cache', () => ({
    withCache: <T>(_key: string, _ttl: number, fn: () => Promise<T>) => fn(),
  }));
  vi.doMock('@/lib/integrations/common/circuit-breaker', () => ({
    withCircuitBreaker: <T>(_key: string, fn: () => Promise<T>) => fn(),
  }));
  vi.doMock('@/lib/integrations/common/rate-limiter', () => ({
    withRateLimit: <T>(_key: string, fn: () => Promise<T>) => fn(),
  }));
}

describe('EUR-Lex client searchEURLex parser', () => {
  it('maps SPARQL bindings into EURLexSearchResult[] with type inferred from CELEX', async () => {
    vi.resetModules();
    stubWrappers();

    const sparqlPayload = {
      results: {
        bindings: [
          {
            celex: { value: '32021R0241' },
            title: { value: 'Regulation establishing the Recovery and Resilience Facility' },
          },
          {
            celex: { value: '32014L0024' },
            title: { value: 'Directive on public procurement' },
          },
        ],
      },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sparqlPayload,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { searchEURLex } = await import('@/lib/integrations/eurlex/client');
    const results = await searchEURLex('fonduri', { language: 'ro', limit: 10 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(2);

    const [reg, dir] = results;
    expect(reg.celex).toBe('32021R0241');
    expect(reg.titleRo).toContain('Recovery and Resilience');
    expect(reg.inForce).toBe(true);
    expect(reg.url).toContain('CELEX:32021R0241');

    expect(dir.celex).toBe('32014L0024');
    expect(dir.titleRo).toContain('public procurement');
  });

  it('returns an empty array when SPARQL bindings is missing or empty', async () => {
    vi.resetModules();
    stubWrappers();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: {} }),
    }));

    const { searchEURLex } = await import('@/lib/integrations/eurlex/client');
    const results = await searchEURLex('no-match');
    expect(results).toEqual([]);
  });

  it('throws when SPARQL endpoint returns non-OK', async () => {
    vi.resetModules();
    stubWrappers();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({}),
    }));

    const { searchEURLex } = await import('@/lib/integrations/eurlex/client');
    await expect(searchEURLex('q')).rejects.toThrow(/EUR-Lex SPARQL error: 502/);
  });
});

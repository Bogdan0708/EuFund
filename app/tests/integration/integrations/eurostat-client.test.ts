import { afterEach, describe, expect, it, vi } from 'vitest';

// Parser-level coverage for getRegionalGDP / getRegionalUnemployment /
// getRegionalPopulation: mocks global fetch with a realistic Eurostat
// dataset response (JSON-stat-like) and asserts the parser maps it into
// EurostatRegionalData correctly.

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

function gdpPayloadForRO(): unknown {
  return {
    id: ['geo', 'unit', 'time'],
    size: [1, 1, 3],
    value: { '0': 250000, '1': 260000, '2': 270000 },
    dimension: {
      geo: {
        category: {
          index: ['RO'],
          label: { RO: 'Romania' },
        },
      },
      unit: {
        category: {
          index: ['MIO_EUR'],
          label: { MIO_EUR: 'Million EUR' },
        },
      },
      time: {
        category: {
          index: ['2020', '2021', '2022'],
          label: { '2020': '2020', '2021': '2021', '2022': '2022' },
        },
      },
    },
  };
}

describe('Eurostat client getRegionalGDP parser', () => {
  it('maps a realistic Eurostat dataset response into EurostatRegionalData', async () => {
    vi.resetModules();
    stubWrappers();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => gdpPayloadForRO(),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getRegionalGDP } = await import('@/lib/integrations/eurostat/client');
    const data = await getRegionalGDP('RO');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(data.nutsCode).toBe('RO');
    expect(data.nutsName).toBe('Romania');
    expect(data.source).toMatch(/Eurostat \(nama_10r_2gdp\)/);
    expect(data.indicators).toHaveLength(3);
    expect(data.indicators[0]).toEqual({
      label: 'GDP 2020',
      value: 250000,
      year: 2020,
      unit: 'Million EUR',
    });
    expect(data.indicators[2].year).toBe(2022);
    expect(data.indicators[2].value).toBe(270000);
  });

  it('returns null values for missing data points without throwing', async () => {
    vi.resetModules();
    stubWrappers();

    const sparsePayload = {
      id: ['geo', 'unit', 'time'],
      size: [1, 1, 2],
      value: { '0': 250000 }, // only year-0 value
      dimension: {
        geo: { category: { index: ['RO'], label: { RO: 'Romania' } } },
        unit: { category: { index: ['MIO_EUR'], label: { MIO_EUR: 'Million EUR' } } },
        time: { category: { index: ['2020', '2021'], label: { '2020': '2020', '2021': '2021' } } },
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sparsePayload,
    }));

    const { getRegionalGDP } = await import('@/lib/integrations/eurostat/client');
    const data = await getRegionalGDP('RO');

    expect(data.indicators).toHaveLength(2);
    expect(data.indicators[0].value).toBe(250000);
    expect(data.indicators[1].value).toBeNull();
  });

  it('throws when the upstream returns a non-OK response', async () => {
    vi.resetModules();
    stubWrappers();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));

    const { getRegionalGDP } = await import('@/lib/integrations/eurostat/client');
    await expect(getRegionalGDP('RO')).rejects.toThrow(/Eurostat API error \(nama_10r_2gdp\): 503/);
  });
});

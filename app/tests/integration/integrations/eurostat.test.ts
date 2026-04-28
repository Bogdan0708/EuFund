import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Migrated from e2e/api-admin.spec.ts ("/api/integrations/eurostat").
// Live upstream coverage moved to .github/workflows/upstream-drift.yml.

describe('GET /api/integrations/eurostat', () => {
  it('returns 200 with regional indicators on success', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'u-1' }),
    }));
    const mockGdp = { region: 'RO', values: [{ year: 2022, value: 250000 }] };
    const mockUnemployment = { region: 'RO', values: [{ year: 2022, value: 5.5 }] };
    const mockPopulation = { region: 'RO', values: [{ year: 2022, value: 19000000 }] };
    vi.doMock('@/lib/integrations/eurostat', () => ({
      getRegionalGDP: vi.fn().mockResolvedValue(mockGdp),
      getRegionalUnemployment: vi.fn().mockResolvedValue(mockUnemployment),
      getRegionalPopulation: vi.fn().mockResolvedValue(mockPopulation),
    }));

    const { GET } = await import('@/app/api/integrations/eurostat/route');
    const response = await GET(
      new NextRequest('http://localhost:3000/api/integrations/eurostat?nutsCode=RO'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.nutsCode).toBe('RO');
    expect(body.data.gdp).toEqual(mockGdp);
    expect(body.data.unemployment).toEqual(mockUnemployment);
    expect(body.data.population).toEqual(mockPopulation);
  });

  it('returns 400 when nutsCode is missing', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'u-1' }),
    }));
    vi.doMock('@/lib/integrations/eurostat', () => ({
      getRegionalGDP: vi.fn(),
      getRegionalUnemployment: vi.fn(),
      getRegionalPopulation: vi.fn(),
    }));

    const { GET } = await import('@/app/api/integrations/eurostat/route');
    const response = await GET(
      new NextRequest('http://localhost:3000/api/integrations/eurostat'),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('nutsCode');
  });

  it('returns 400 when nutsCode has an invalid format', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'u-1' }),
    }));
    vi.doMock('@/lib/integrations/eurostat', () => ({
      getRegionalGDP: vi.fn(),
      getRegionalUnemployment: vi.fn(),
      getRegionalPopulation: vi.fn(),
    }));

    const { GET } = await import('@/app/api/integrations/eurostat/route');
    const response = await GET(
      new NextRequest('http://localhost:3000/api/integrations/eurostat?nutsCode=NOT_A_CODE'),
    );

    expect(response.status).toBe(400);
  });

  it('returns 401 when requireAuth throws Unauthorized', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockImplementation(() => {
        throw new Error('Unauthorized');
      }),
    }));
    vi.doMock('@/lib/integrations/eurostat', () => ({
      getRegionalGDP: vi.fn(),
      getRegionalUnemployment: vi.fn(),
      getRegionalPopulation: vi.fn(),
    }));

    const { GET } = await import('@/app/api/integrations/eurostat/route');
    const response = await GET(
      new NextRequest('http://localhost:3000/api/integrations/eurostat?nutsCode=RO'),
    );

    expect(response.status).toBe(401);
  });

  it('returns 500 when an indicator client throws a generic error', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'u-1' }),
    }));
    vi.doMock('@/lib/integrations/eurostat', () => ({
      getRegionalGDP: vi.fn().mockRejectedValue(new Error('upstream 502')),
      getRegionalUnemployment: vi.fn().mockResolvedValue({ region: 'RO', values: [] }),
      getRegionalPopulation: vi.fn().mockResolvedValue({ region: 'RO', values: [] }),
    }));

    const { GET } = await import('@/app/api/integrations/eurostat/route');
    const response = await GET(
      new NextRequest('http://localhost:3000/api/integrations/eurostat?nutsCode=RO'),
    );

    expect(response.status).toBe(500);
  });

  it('returns 503 when the circuit breaker is open', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'u-1' }),
    }));
    const breakerError = new Error('breaker open');
    breakerError.name = 'CircuitOpenError';
    vi.doMock('@/lib/integrations/eurostat', () => ({
      getRegionalGDP: vi.fn().mockRejectedValue(breakerError),
      getRegionalUnemployment: vi.fn(),
      getRegionalPopulation: vi.fn(),
    }));

    const { GET } = await import('@/app/api/integrations/eurostat/route');
    const response = await GET(
      new NextRequest('http://localhost:3000/api/integrations/eurostat?nutsCode=RO'),
    );

    expect(response.status).toBe(503);
  });
});

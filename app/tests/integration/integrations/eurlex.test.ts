import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Migrated from e2e/api-admin.spec.ts ("/api/integrations/eurlex/search").
// Live upstream coverage moved to .github/workflows/upstream-drift.yml.

describe('GET /api/integrations/eurlex/search', () => {
  it('returns 200 with results array on success', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'u-1' }),
    }));
    vi.doMock('@/lib/integrations/eurlex', () => ({
      searchEURLex: vi.fn().mockResolvedValue([
        { celex: '32021R0241', title: 'Recovery and Resilience Facility' },
      ]),
    }));

    const { GET } = await import('@/app/api/integrations/eurlex/search/route');
    const response = await GET(
      new NextRequest('http://localhost:3000/api/integrations/eurlex/search?q=fonduri'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.count).toBe(1);
  });

  it('returns 400 when the q parameter is missing', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'u-1' }),
    }));
    vi.doMock('@/lib/integrations/eurlex', () => ({ searchEURLex: vi.fn() }));

    const { GET } = await import('@/app/api/integrations/eurlex/search/route');
    const response = await GET(
      new NextRequest('http://localhost:3000/api/integrations/eurlex/search'),
    );

    expect(response.status).toBe(400);
  });

  it('returns 500 when the upstream throws a generic error', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'u-1' }),
    }));
    vi.doMock('@/lib/integrations/eurlex', () => ({
      searchEURLex: vi.fn().mockRejectedValue(new Error('upstream HTML changed')),
    }));

    const { GET } = await import('@/app/api/integrations/eurlex/search/route');
    const response = await GET(
      new NextRequest('http://localhost:3000/api/integrations/eurlex/search?q=fonduri'),
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
    vi.doMock('@/lib/integrations/eurlex', () => ({
      searchEURLex: vi.fn().mockRejectedValue(breakerError),
    }));

    const { GET } = await import('@/app/api/integrations/eurlex/search/route');
    const response = await GET(
      new NextRequest('http://localhost:3000/api/integrations/eurlex/search?q=fonduri'),
    );

    expect(response.status).toBe(503);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Migrated from e2e/api-admin.spec.ts + e2e/funding-calls.spec.ts (live EC-portal tests).
// Live upstream coverage moved to .github/workflows/upstream-drift.yml.

const url = 'http://localhost:3000/api/integrations/funding-calls';

describe('GET /api/integrations/funding-calls', () => {
  it('returns 200 with calls array on success', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'u-1' }),
    }));
    vi.doMock('@/lib/integrations/ec-portal', () => ({
      searchFundingCalls: vi.fn().mockResolvedValue([
        { id: 'call-1', title: 'Mock funding call' },
      ]),
    }));

    const { GET } = await import('@/app/api/integrations/funding-calls/route');
    const response = await GET(new NextRequest(url));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(body.calls)).toBe(true);
    expect(body.count).toBe(1);
  });

  it('returns 500 when the upstream throws a generic error', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'u-1' }),
    }));
    vi.doMock('@/lib/integrations/ec-portal', () => ({
      searchFundingCalls: vi.fn().mockRejectedValue(new Error('upstream 502')),
    }));

    const { GET } = await import('@/app/api/integrations/funding-calls/route');
    const response = await GET(new NextRequest(url));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns 503 when the circuit breaker is open', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'u-1' }),
    }));
    const breakerError = new Error('breaker open');
    breakerError.name = 'CircuitOpenError';
    vi.doMock('@/lib/integrations/ec-portal', () => ({
      searchFundingCalls: vi.fn().mockRejectedValue(breakerError),
    }));

    const { GET } = await import('@/app/api/integrations/funding-calls/route');
    const response = await GET(new NextRequest(url));

    expect(response.status).toBe(503);
  });
});

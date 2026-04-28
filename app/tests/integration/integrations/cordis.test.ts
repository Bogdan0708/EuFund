import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Migrated from e2e/api-admin.spec.ts ("/api/integrations/cordis").
// Live upstream coverage moved to .github/workflows/upstream-drift.yml.
// This suite pins status mapping: 200 happy path, 401 unauth, 500 upstream error,
// 503 circuit-breaker open.

const url = 'http://localhost:3000/api/integrations/cordis?query=horizon';

describe('GET /api/integrations/cordis', () => {
  it('returns 200 with projects array on success', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' }),
    }));
    vi.doMock('@/lib/integrations/cordis', () => ({
      searchFundedProjects: vi.fn().mockResolvedValue([
        { id: 'proj-1', title: 'Mock CORDIS project' },
      ]),
    }));

    const { GET } = await import('@/app/api/integrations/cordis/route');
    const response = await GET(new NextRequest(url));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(body.projects)).toBe(true);
    expect(body.projects).toHaveLength(1);
    expect(body.count).toBe(1);
  });

  it('returns 401 when requireAuth throws Unauthorized', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockImplementation(() => {
        throw new Error('Unauthorized');
      }),
    }));
    vi.doMock('@/lib/integrations/cordis', () => ({
      searchFundedProjects: vi.fn(),
    }));

    const { GET } = await import('@/app/api/integrations/cordis/route');
    const response = await GET(new NextRequest(url));

    expect(response.status).toBe(401);
  });

  it('returns 500 when the upstream throws a generic error', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'u-1' }),
    }));
    vi.doMock('@/lib/integrations/cordis', () => ({
      searchFundedProjects: vi.fn().mockRejectedValue(new Error('upstream timeout')),
    }));

    const { GET } = await import('@/app/api/integrations/cordis/route');
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
    vi.doMock('@/lib/integrations/cordis', () => ({
      searchFundedProjects: vi.fn().mockRejectedValue(breakerError),
    }));

    const { GET } = await import('@/app/api/integrations/cordis/route');
    const response = await GET(new NextRequest(url));

    expect(response.status).toBe(503);
  });
});

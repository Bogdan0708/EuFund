import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

function createJsonRequest(path: string, body: unknown) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Tier-gated routes', () => {
  it('rejects MySMIS export for free-tier users', async () => {
    vi.resetModules();
    vi.stubEnv('BILLING_ENABLED', 'true');

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@test.com' }),
    }));
    vi.doMock('@/lib/middleware/tier-gate', async () => {
      const actual = await vi.importActual<typeof import('@/lib/middleware/tier-gate')>('@/lib/middleware/tier-gate');
      return {
        ...actual,
        requireTier: () => async () => {
          throw (await import('@/lib/errors')).Errors.forbidden();
        },
      };
    });

    const { GET } = await import('@/app/api/v1/projects/[id]/mysmis-export/route');
    const response = await GET(
      new NextRequest('http://localhost:3000/api/v1/projects/project-1/mysmis-export'),
      { params: { id: 'project-1' } },
    );
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('FORBIDDEN');
    vi.unstubAllEnvs();
  });
});

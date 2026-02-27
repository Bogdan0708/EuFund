import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('/api/v1/projects/[id]/compliance/evidence-coverage', () => {
  it('returns evidence coverage for authorized viewers', async () => {
    vi.resetModules();
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'user@test.com' }),
      requireOrgRole: vi.fn().mockResolvedValue('viewer'),
    }));
    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) => fn({
        query: {
          projects: {
            findFirst: vi.fn().mockResolvedValue({ id: '123e4567-e89b-42d3-a456-426614174000', orgId: 'org-1' }),
          },
        },
      })),
      db: {
        query: {
          projects: {
            findFirst: vi.fn().mockResolvedValue({ id: '123e4567-e89b-42d3-a456-426614174000', orgId: 'org-1' }),
          },
        },
      },
    }));
    vi.doMock('@/lib/services/compliance', () => ({
      getGhidEvidenceCoverage: vi.fn().mockResolvedValue({
        items: [{ obligationId: 'GHID-1-10', covered: true, evidenceCount: 1 }],
        meta: { total: 1, covered: 1, uncovered: 0, highRiskUncovered: 0 },
      }),
    }));

    const { GET } = await import('@/app/api/v1/projects/[id]/compliance/evidence-coverage/route');
    const req = new NextRequest('http://localhost:3000/api/v1/projects/123e4567-e89b-42d3-a456-426614174000/compliance/evidence-coverage');
    const res = await GET(req, { params: { id: '123e4567-e89b-42d3-a456-426614174000' } });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.meta.covered).toBe(1);
  });
});

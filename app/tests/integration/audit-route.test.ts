import { describe, expect, it, vi } from 'vitest';

describe('GET /api/v1/audit', () => {
  it('rejects audit listing without orgId when the user administers multiple orgs', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({
        id: '123e4567-e89b-42d3-a456-426614174000',
        email: 'admin@test.com',
      }),
      requireOrgRole: vi.fn().mockResolvedValue('org_admin'),
      getPaginationParams: vi.fn().mockReturnValue({ page: 1, perPage: 20, offset: 0 }),
    }));

    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: any) => Promise<unknown>) => fn({
        query: {
          orgMembers: {
            findMany: vi.fn().mockResolvedValue([
              { orgId: '123e4567-e89b-42d3-a456-426614174001' },
              { orgId: '123e4567-e89b-42d3-a456-426614174002' },
            ]),
          },
        },
        select: vi.fn(),
      })),
    }));
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ error: vi.fn() }) },
    }));

    const { GET } = await import('@/app/api/v1/audit/route');
    const request = new Request('http://localhost:3000/api/v1/audit');

    const res = await GET(request as any);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.details.reason).toBe('AUDIT_ORG_REQUIRED');
  });
});

import { describe, expect, it, vi } from 'vitest';

describe('DELETE /api/v1/organizations/[id]/members', () => {
  it('removes a non-admin member', async () => {
    vi.resetModules();

    const deleteWhere = vi.fn().mockResolvedValue(undefined);

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({
        id: '123e4567-e89b-42d3-a456-426614174000',
        email: 'admin@test.com',
      }),
      requireOrgRole: vi.fn().mockResolvedValue('org_admin'),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          orgMembers: {
            findFirst: vi.fn().mockResolvedValue({
              orgId: '123e4567-e89b-42d3-a456-426614174001',
              userId: '123e4567-e89b-42d3-a456-426614174111',
              role: 'viewer',
            }),
            findMany: vi.fn(),
          },
        },
        delete: vi.fn().mockReturnValue({ where: deleteWhere }),
      },
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

    const { DELETE } = await import('@/app/api/v1/organizations/[id]/members/route');
    const request = new Request('http://localhost:3000/api/v1/organizations/123e4567-e89b-42d3-a456-426614174001/members', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: '123e4567-e89b-42d3-a456-426614174111',
      }),
    });

    const res = await DELETE(request as any, {
      params: { id: '123e4567-e89b-42d3-a456-426614174001' },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(deleteWhere).toHaveBeenCalled();
    expect(body.data.removed).toBe(true);
  });

  it('rejects removing the last org admin', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({
        id: '123e4567-e89b-42d3-a456-426614174000',
        email: 'admin@test.com',
      }),
      requireOrgRole: vi.fn().mockResolvedValue('org_admin'),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          orgMembers: {
            findFirst: vi.fn().mockResolvedValue({
              orgId: '123e4567-e89b-42d3-a456-426614174001',
              userId: '123e4567-e89b-42d3-a456-426614174000',
              role: 'org_admin',
            }),
            findMany: vi.fn().mockResolvedValue([
              { userId: '123e4567-e89b-42d3-a456-426614174000' },
            ]),
          },
        },
        delete: vi.fn(),
      },
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

    const { DELETE } = await import('@/app/api/v1/organizations/[id]/members/route');
    const request = new Request('http://localhost:3000/api/v1/organizations/123e4567-e89b-42d3-a456-426614174001/members', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: '123e4567-e89b-42d3-a456-426614174000',
      }),
    });

    const res = await DELETE(request as any, {
      params: { id: '123e4567-e89b-42d3-a456-426614174001' },
    });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.details.reason).toBe('LAST_ORG_ADMIN');
  });
});

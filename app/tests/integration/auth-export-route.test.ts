import { describe, expect, it, vi } from 'vitest';

describe('GET /api/auth/export', () => {
  it('returns only authenticated user data and applies rate limiting', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: '123e4567-e89b-42d3-a456-426614174000', email: 'user@test.com' }),
    }));
    vi.doMock('@/lib/redis/client', () => ({
      isRedisAvailable: vi.fn().mockResolvedValue(true),
      checkRateLimit: vi.fn().mockResolvedValue({
        allowed: true,
        remaining: 0,
        resetTime: Date.now() + 3600000,
      }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          users: { findFirst: vi.fn().mockResolvedValue({ id: '123e4567-e89b-42d3-a456-426614174000', email: 'user@test.com', fullName: 'User', createdAt: new Date(), updatedAt: new Date() }) },
          orgMembers: { findMany: vi.fn().mockResolvedValue([{ orgId: 'org-1', role: 'viewer' }]) },
          projects: { findMany: vi.fn().mockResolvedValue([{ id: 'proj-1', title: 'P1' }]) },
          documents: { findMany: vi.fn().mockResolvedValue([{ id: 'doc-1', filename: 'f.pdf' }]) },
          consentRecords: { findMany: vi.fn().mockResolvedValue([{ id: 'consent-1', status: 'granted' }]) },
        },
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([{ id: 'audit-1', action: 'project.update' }]),
            }),
          }),
        }),
      },
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

    const { GET } = await import('@/app/api/auth/export/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.profile.email).toBe('user@test.com');
    expect(json.data.projects).toHaveLength(1);
    expect(json.data.documents).toHaveLength(1);
    expect(json.data.auditLog).toHaveLength(1);
  });
});

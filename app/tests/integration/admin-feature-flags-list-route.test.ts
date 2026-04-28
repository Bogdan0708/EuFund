import { describe, expect, it, vi } from 'vitest';

// Migrated from e2e/api-admin.spec.ts ("GET /api/v1/admin/feature-flags").
// Pins the platform-admin auth gate plus the success-path shape contract.

describe('GET /api/v1/admin/feature-flags', () => {
  it('returns 403 for non-admin users', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requirePlatformAdmin: vi.fn().mockImplementation(async () => {
        const { Errors } = await import('@/lib/errors');
        throw Errors.forbidden();
      }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: { select: vi.fn().mockReturnValue({ from: vi.fn().mockResolvedValue([]) }) },
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }));

    const { GET } = await import('@/app/api/v1/admin/feature-flags/route');
    const response = await GET();
    expect(response.status).toBe(403);
  });

  it('returns 200 with the list of flags for an admin', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requirePlatformAdmin: vi.fn().mockResolvedValue({ id: 'admin-1', isPlatformAdmin: true }),
    }));

    const fromMock = vi.fn().mockResolvedValue([
      { id: 'flag-1', key: 'managed_agent_enabled', enabled: true, targeting: {} },
      { id: 'flag-2', key: 'prompt_cache_enabled', enabled: false, targeting: {} },
    ]);
    vi.doMock('@/lib/db', () => ({
      db: { select: vi.fn().mockReturnValue({ from: fromMock }) },
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }));

    const { GET } = await import('@/app/api/v1/admin/feature-flags/route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].key).toBe('managed_agent_enabled');
  });
});

import { describe, expect, it, vi } from 'vitest';

describe('RLS context wiring', () => {
  it('requireOrgRole executes membership lookup within user RLS context', async () => {
    vi.resetModules();

    const findFirst = vi.fn().mockResolvedValue({
      role: 'org_admin',
    });
    const withUserRLS = vi.fn(async (_userId: string, fn: (tx: any) => Promise<unknown>) => {
      return fn({
        query: {
          orgMembers: { findFirst },
        },
      });
    });

    vi.doMock('@/lib/db', () => ({
      db: {},
      withUserRLS,
    }));
    vi.doMock('@/lib/auth', () => ({
      auth: vi.fn(),
    }));

    const { requireOrgRole } = await import('@/lib/auth/helpers');
    const role = await requireOrgRole(
      '123e4567-e89b-42d3-a456-426614174000',
      '123e4567-e89b-42d3-a456-426614174001',
      'viewer',
    );

    expect(role).toBe('org_admin');
    expect(withUserRLS).toHaveBeenCalledWith(
      '123e4567-e89b-42d3-a456-426614174000',
      expect.any(Function),
    );
    expect(findFirst).toHaveBeenCalledOnce();
  });

  it('requirePlatformAdmin verifies DB role even when session has admin flag', async () => {
    vi.resetModules();

    const findFirst = vi.fn().mockResolvedValue({
      id: '123e4567-e89b-42d3-a456-426614174000',
      isPlatformAdmin: false,
    });
    const withUserRLS = vi.fn(async (_userId: string, fn: (tx: any) => Promise<unknown>) => {
      return fn({
        query: {
          users: { findFirst },
        },
      });
    });

    vi.doMock('@/lib/db', () => ({
      db: {},
      withUserRLS,
    }));
    vi.doMock('@/lib/auth', () => ({
      auth: vi.fn().mockResolvedValue({
        user: {
          id: '123e4567-e89b-42d3-a456-426614174000',
          email: 'admin@test.com',
          isPlatformAdmin: true,
        },
      }),
    }));

    const { requirePlatformAdmin } = await import('@/lib/auth/helpers');
    await expect(requirePlatformAdmin()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
    expect(withUserRLS).toHaveBeenCalledWith(
      '123e4567-e89b-42d3-a456-426614174000',
      expect.any(Function),
    );
    expect(findFirst).toHaveBeenCalledOnce();
  });
});

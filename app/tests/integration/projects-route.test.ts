import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

function mockUserLockSelect() {
  return vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        for: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([{ id: 'user-1' }]),
        })),
      })),
    })),
  }));
}

describe('POST /api/v1/projects organization context', () => {
  it('uses the only membership org when orgId is omitted', async () => {
    vi.resetModules();

    const insertReturning = vi.fn().mockResolvedValue([
      { id: 'project-1', orgId: 'org-1', title: 'Project' },
    ]);
    const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
    const tx = {
      query: {
        orgMembers: {
          findMany: vi.fn().mockResolvedValue([{ orgId: 'org-1' }]),
        },
      },
      select: mockUserLockSelect(),
      insert: vi.fn().mockReturnValue({ values: insertValues }),
    };

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@test.com' }),
      getPaginationParams: vi.fn(),
    }));
    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (db: typeof tx) => Promise<unknown>) => fn(tx)),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

    const { POST } = await import('@/app/api/v1/projects/route');
    const response = await POST(new NextRequest('http://localhost:3000/api/v1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Project Alpha',
        callId: '11111111-1111-4111-8111-111111111111',
      }),
    }));
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.success).toBe(true);
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1' }));
  });

  it('rejects project creation when the user belongs to multiple orgs and orgId is omitted', async () => {
    vi.resetModules();

    const tx = {
      query: {
        orgMembers: {
          findMany: vi.fn().mockResolvedValue([{ orgId: 'org-1' }, { orgId: 'org-2' }]),
        },
      },
      select: mockUserLockSelect(),
      insert: vi.fn(),
    };

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@test.com' }),
      getPaginationParams: vi.fn(),
    }));
    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (db: typeof tx) => Promise<unknown>) => fn(tx)),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

    const { POST } = await import('@/app/api/v1/projects/route');
    const response = await POST(new NextRequest('http://localhost:3000/api/v1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Project Alpha',
        callId: '11111111-1111-4111-8111-111111111111',
      }),
    }));
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error.code).toBe('CONFLICT');
    expect(json.error.details.reason).toBe('PROJECT_ORG_REQUIRED');
  });

  it('auto-creates a personal org when user has no membership and orgId is omitted', async () => {
    vi.resetModules();

    const insertReturning = vi.fn()
      .mockResolvedValueOnce([{ id: 'auto-org-1' }])        // org insert .returning()
      .mockResolvedValueOnce([{ id: 'project-1', orgId: 'auto-org-1', title: 'Project Alpha' }]); // project insert .returning()
    const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
    const tx = {
      query: {
        orgMembers: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      },
      select: mockUserLockSelect(),
      insert: vi.fn().mockReturnValue({ values: insertValues }),
    };

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@test.com' }),
      getPaginationParams: vi.fn(),
    }));
    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (db: typeof tx) => Promise<unknown>) => fn(tx)),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

    const { POST } = await import('@/app/api/v1/projects/route');
    const response = await POST(new NextRequest('http://localhost:3000/api/v1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Project Alpha',
        callId: '11111111-1111-4111-8111-111111111111',
      }),
    }));

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.success).toBe(true);
  });
});

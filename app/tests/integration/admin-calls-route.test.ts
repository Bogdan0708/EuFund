import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('/api/v1/admin/calls', () => {
  it('denies non-admin users', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-viewer', email: 'viewer@test.com', isPlatformAdmin: false }),
      requirePlatformAdmin: vi.fn().mockImplementation(async () => {
        const { Errors } = await import('@/lib/errors');
        throw Errors.forbidden();
      }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          callsForProposals: {
            findMany: vi.fn(),
            findFirst: vi.fn(),
          },
        },
      },
    }));
    vi.doMock('@/lib/legal/audit', () => ({
      logAudit: vi.fn(),
      sanitizeForAudit: (value: Record<string, unknown>) => value,
    }));

    const { GET } = await import('@/app/api/v1/admin/calls/route');
    const req = new NextRequest('http://localhost:3000/api/v1/admin/calls');
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('denies org_admin users for platform-level call management', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-org-admin', email: 'orgadmin@test.com', isPlatformAdmin: false }),
      requirePlatformAdmin: vi.fn().mockImplementation(async () => {
        const { Errors } = await import('@/lib/errors');
        throw Errors.forbidden();
      }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          callsForProposals: {
            findMany: vi.fn(),
            findFirst: vi.fn(),
          },
        },
      },
    }));
    vi.doMock('@/lib/legal/audit', () => ({
      logAudit: vi.fn(),
      sanitizeForAudit: (value: Record<string, unknown>) => value,
    }));

    const { GET } = await import('@/app/api/v1/admin/calls/route');
    const req = new NextRequest('http://localhost:3000/api/v1/admin/calls');
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('allows admin to create and update call with audited diffs', async () => {
    vi.resetModules();

    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: '11111111-1111-4111-8111-111111111113', titleRo: 'Apel vechi', programId: '11111111-1111-4111-8111-111111111111' });

    const dbMock = {
      query: {
        callsForProposals: {
          findMany: vi.fn().mockResolvedValue([]),
          findFirst,
        },
      },
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([
            { id: '11111111-1111-4111-8111-111111111113', titleRo: 'Apel nou', programId: '11111111-1111-4111-8111-111111111111' },
          ]),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([
              { id: '11111111-1111-4111-8111-111111111113', titleRo: 'Apel actualizat', programId: '11111111-1111-4111-8111-111111111111' },
            ]),
          })),
        })),
      })),
    };

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-admin', email: 'admin@test.com', isPlatformAdmin: true }),
      requirePlatformAdmin: vi.fn().mockResolvedValue({ id: 'user-admin', email: 'admin@test.com', isPlatformAdmin: true }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: dbMock,
    }));

    const logAudit = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/legal/audit', () => ({
      logAudit,
      sanitizeForAudit: (value: Record<string, unknown>) => value,
    }));

    const { POST, PUT } = await import('@/app/api/v1/admin/calls/route');

    const createReq = new NextRequest('http://localhost:3000/api/v1/admin/calls', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        programId: '11111111-1111-4111-8111-111111111111',
        callCode: 'POR-2026-1',
        titleRo: 'Apel nou',
      }),
    });
    const createRes = await POST(createReq);
    expect(createRes.status).toBe(201);

    const updateReq = new NextRequest('http://localhost:3000/api/v1/admin/calls', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: '11111111-1111-4111-8111-111111111113',
        titleRo: 'Apel actualizat',
      }),
    });
    const updateRes = await PUT(updateReq);
    expect(updateRes.status).toBe(200);

    expect(logAudit).toHaveBeenCalledTimes(2);
    expect(logAudit).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: 'system.call_change',
      metadata: expect.objectContaining({ changeType: 'create' }),
      newValue: expect.objectContaining({ titleRo: 'Apel nou' }),
    }));
    expect(logAudit).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: 'system.call_change',
      metadata: expect.objectContaining({ changeType: 'update' }),
      oldValue: expect.objectContaining({ titleRo: 'Apel vechi' }),
      newValue: expect.objectContaining({ titleRo: 'Apel actualizat' }),
    }));
  });
});

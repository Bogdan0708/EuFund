import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('/api/v1/admin/programs', () => {
  it('allows admin to create and update program with audited diffs', async () => {
    vi.resetModules();

    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: 'program-1', code: 'POR', nameRo: 'Program vechi' });

    const dbMock = {
      query: {
        fundingPrograms: {
          findMany: vi.fn().mockResolvedValue([]),
          findFirst,
        },
      },
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([
            { id: 'program-1', code: 'POR', nameRo: 'Program nou', status: 'activ' },
          ]),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([
              { id: 'program-1', code: 'POR', nameRo: 'Program actualizat', status: 'activ' },
            ]),
          })),
        })),
      })),
    };

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-admin', email: 'admin@test.com' }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: dbMock,
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) => fn({
        query: {
          orgMembers: {
            findFirst: vi.fn().mockResolvedValue({ id: 'membership-1', role: 'admin' }),
          },
        },
      })),
    }));

    const logAudit = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/legal/audit', () => ({
      logAudit,
      sanitizeForAudit: (value: Record<string, unknown>) => value,
    }));

    const { POST, PUT } = await import('@/app/api/v1/admin/programs/route');

    const createReq = new NextRequest('http://localhost:3000/api/v1/admin/programs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: 'POR',
        nameRo: 'Program nou',
        status: 'activ',
      }),
    });
    const createRes = await POST(createReq);
    expect(createRes.status).toBe(201);

    const updateReq = new NextRequest('http://localhost:3000/api/v1/admin/programs', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'program-1',
        nameRo: 'Program actualizat',
      }),
    });
    const updateRes = await PUT(updateReq);
    expect(updateRes.status).toBe(200);

    expect(logAudit).toHaveBeenCalledTimes(2);
    expect(logAudit).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: 'system.program_change',
      metadata: expect.objectContaining({ changeType: 'create' }),
      newValue: expect.objectContaining({ nameRo: 'Program nou' }),
    }));
    expect(logAudit).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: 'system.program_change',
      metadata: expect.objectContaining({ changeType: 'update' }),
      oldValue: expect.objectContaining({ nameRo: 'Program vechi' }),
      newValue: expect.objectContaining({ nameRo: 'Program actualizat' }),
    }));
  });
});

import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('/api/auth/consent/bulk PATCH', () => {
  it('applies multiple consent updates in one transaction', async () => {
    vi.resetModules();

    const set = vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    }));
    const values = vi.fn(() => ({
      returning: vi.fn().mockResolvedValue([{ id: 'consent-1' }]),
    }));
    const tx = {
      query: {
        consentRecords: {
          findFirst: vi.fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'consent-2', status: 'granted' }),
        },
      },
      insert: vi.fn(() => ({
        values,
      })),
      update: vi.fn(() => ({
        set,
      })),
    };

    const dbMock = {
      transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<void>) => fn(tx)),
    };

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
    }));
    vi.doMock('@/lib/db', () => ({ db: dbMock }));

    const logAudit = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/legal/audit', () => ({ logAudit }));

    const { PATCH } = await import('@/app/api/auth/consent/bulk/route');
    const req = new NextRequest('http://localhost:3000/api/auth/consent/bulk', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'vitest-agent',
        'x-forwarded-for': '1.2.3.4',
      },
      body: JSON.stringify({
        consents: [
          { consentType: 'analytics', status: 'granted' },
          { consentType: 'marketing', status: 'withdrawn' },
        ],
      }),
    });

    const res = await PATCH(req);
    expect(res.status).toBe(200);
    expect(dbMock.transaction).toHaveBeenCalledOnce();
    expect(logAudit).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'withdrawn',
      withdrawnAt: expect.any(Date),
    }));
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'consent.grant',
      metadata: expect.objectContaining({ consentType: 'analytics', ipAddress: '1.2.3.4' }),
    }));
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'consent.withdraw',
      metadata: expect.objectContaining({ consentType: 'marketing', userAgent: 'vitest-agent' }),
    }));
  });

  it('returns 500 and does not emit audit logs when transaction fails', async () => {
    vi.resetModules();

    const tx = {
      query: {
        consentRecords: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockRejectedValue(new Error('db insert failure')),
        })),
      })),
      update: vi.fn(),
    };

    const dbMock = {
      transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<void>) => fn(tx)),
    };

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
    }));
    vi.doMock('@/lib/db', () => ({ db: dbMock }));

    const logAudit = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/legal/audit', () => ({ logAudit }));

    const { PATCH } = await import('@/app/api/auth/consent/bulk/route');
    const req = new NextRequest('http://localhost:3000/api/auth/consent/bulk', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        consents: [{ consentType: 'analytics', status: 'granted' }],
      }),
    });

    const res = await PATCH(req);
    expect(res.status).toBe(500);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('creates withdrawn records without grantedAt in bulk mode', async () => {
    vi.resetModules();

    const values = vi.fn(() => ({
      returning: vi.fn().mockResolvedValue([{ id: 'consent-4' }]),
    }));
    const tx = {
      query: {
        consentRecords: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
      insert: vi.fn(() => ({ values })),
      update: vi.fn(),
    };

    const dbMock = {
      transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<void>) => fn(tx)),
    };

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
    }));
    vi.doMock('@/lib/db', () => ({ db: dbMock }));

    const logAudit = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/legal/audit', () => ({ logAudit }));

    const { PATCH } = await import('@/app/api/auth/consent/bulk/route');
    const req = new NextRequest('http://localhost:3000/api/auth/consent/bulk', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        consents: [{ consentType: 'marketing', status: 'withdrawn' }],
      }),
    });

    const res = await PATCH(req);
    expect(res.status).toBe(200);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      status: 'withdrawn',
      withdrawnAt: expect.any(Date),
    }));
    expect(values).toHaveBeenCalledWith(expect.not.objectContaining({
      grantedAt: expect.anything(),
    }));
  });
});

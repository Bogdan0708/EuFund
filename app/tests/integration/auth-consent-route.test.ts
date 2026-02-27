import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('/api/auth/consent PATCH', () => {
  it('grants optional consent and logs consent.grant', async () => {
    vi.resetModules();

    const dbMock = {
      query: {
        consentRecords: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{ id: 'consent-1' }]),
        })),
      })),
      update: vi.fn(),
    };

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
    }));
    vi.doMock('@/lib/db', () => ({ db: dbMock }));

    const logAudit = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/legal/audit', () => ({ logAudit }));

    const { PATCH } = await import('@/app/api/auth/consent/route');
    const req = new NextRequest('http://localhost:3000/api/auth/consent', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ consentType: 'analytics', status: 'granted' }),
    });

    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.data.status).toBe('granted');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'consent.grant',
      metadata: { consentType: 'analytics' },
    }));
  });

  it('withdraws existing consent and logs consent.withdraw', async () => {
    vi.resetModules();

    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    const dbMock = {
      query: {
        consentRecords: {
          findFirst: vi.fn().mockResolvedValue({ id: 'consent-2', status: 'granted' }),
        },
      },
      insert: vi.fn(),
      update: vi.fn(() => ({ set })),
    };

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
    }));
    vi.doMock('@/lib/db', () => ({ db: dbMock }));

    const logAudit = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/legal/audit', () => ({ logAudit }));

    const { PATCH } = await import('@/app/api/auth/consent/route');
    const req = new NextRequest('http://localhost:3000/api/auth/consent', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ consentType: 'marketing', status: 'withdrawn' }),
    });

    const res = await PATCH(req);
    expect(res.status).toBe(200);
    expect(dbMock.update).toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'withdrawn',
      withdrawnAt: expect.any(Date),
    }));
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'consent.withdraw',
      metadata: { consentType: 'marketing' },
    }));
  });

  it('creates withdrawn consent without grantedAt when record does not exist', async () => {
    vi.resetModules();

    const values = vi.fn(() => ({
      returning: vi.fn().mockResolvedValue([{ id: 'consent-3' }]),
    }));
    const dbMock = {
      query: {
        consentRecords: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
      insert: vi.fn(() => ({ values })),
      update: vi.fn(),
    };

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
    }));
    vi.doMock('@/lib/db', () => ({ db: dbMock }));

    const logAudit = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/legal/audit', () => ({ logAudit }));

    const { PATCH } = await import('@/app/api/auth/consent/route');
    const req = new NextRequest('http://localhost:3000/api/auth/consent', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ consentType: 'analytics', status: 'withdrawn' }),
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
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'consent.withdraw',
    }));
  });
});

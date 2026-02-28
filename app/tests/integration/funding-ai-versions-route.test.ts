import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('/api/v1/admin/funding-ai/versions', () => {
  it('denies non-platform-admin users', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requirePlatformAdmin: vi.fn().mockImplementation(async () => {
        const { Errors } = await import('@/lib/errors');
        throw Errors.forbidden();
      }),
    }));
    vi.doMock('@/lib/db', () => ({ db: {} }));

    const { GET } = await import('@/app/api/v1/admin/funding-ai/versions/route');
    const req = new NextRequest('http://localhost:3000/api/v1/admin/funding-ai/versions?callExternalKey=test-call');
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('creates next version automatically and logs audit', async () => {
    vi.resetModules();

    const tx = {
      query: {
        fundingCallVersions: {
          findFirst: vi.fn().mockResolvedValue({ versionNo: 2 }),
        },
      },
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([
            {
              id: '11111111-1111-4111-8111-111111111111',
              callExternalKey: 'pnrr-c2-i1-001',
              versionNo: 3,
            },
          ]),
        })),
      })),
    };

    const dbMock = {
      transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    vi.doMock('@/lib/auth/helpers', () => ({
      requirePlatformAdmin: vi.fn().mockResolvedValue({ id: 'user-admin' }),
    }));
    vi.doMock('@/lib/db', () => ({ db: dbMock }));

    const logAudit = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/legal/audit', () => ({ logAudit }));

    const { POST } = await import('@/app/api/v1/admin/funding-ai/versions/route');
    const req = new NextRequest('http://localhost:3000/api/v1/admin/funding-ai/versions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        callExternalKey: 'pnrr-c2-i1-001',
        changedFields: { deadline_at: '2026-12-15T17:00:00Z' },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload.data.versionNo).toBe(3);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'funding_ai.version_create',
    }));
  });
});

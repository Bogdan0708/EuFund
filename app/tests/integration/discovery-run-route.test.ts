import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requirePlatformAdminMock, verifySchedulerOIDCMock, runDiscoveryMock } = vi.hoisted(() => ({
  requirePlatformAdminMock: vi.fn(),
  verifySchedulerOIDCMock: vi.fn(),
  runDiscoveryMock: vi.fn(),
}));

vi.mock('@/lib/auth/helpers', () => ({
  requirePlatformAdmin: requirePlatformAdminMock,
}));
vi.mock('@/lib/auth/scheduler', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/scheduler')>('@/lib/auth/scheduler');
  return { ...actual, verifySchedulerOIDC: verifySchedulerOIDCMock };
});
vi.mock('@/lib/discovery/pipeline', () => ({
  runDiscovery: runDiscoveryMock,
}));

import { POST } from '@/app/api/v1/admin/discovery/run/route';

const URL = 'https://test.run.app/api/v1/admin/discovery/run';
const makeReq = (headers: Record<string, string> = {}) =>
  new NextRequest(URL, { method: 'POST', headers });

beforeEach(() => {
  requirePlatformAdminMock.mockReset();
  verifySchedulerOIDCMock.mockReset();
  runDiscoveryMock.mockReset();
});

describe('POST /api/v1/admin/discovery/run', () => {
  it('runs discovery for an authenticated admin (no Bearer)', async () => {
    verifySchedulerOIDCMock.mockResolvedValue(null);
    requirePlatformAdminMock.mockResolvedValue({ id: 'admin' });
    runDiscoveryMock.mockResolvedValue({ newCalls: 3, duplicates: 1, errors: [] });

    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: { newCalls: 3, duplicates: 1, errors: [] } });
    expect(requirePlatformAdminMock).toHaveBeenCalledOnce();
  });

  it('runs discovery for Cloud Scheduler (skips admin check)', async () => {
    verifySchedulerOIDCMock.mockResolvedValue({ source: 'scheduler' });
    runDiscoveryMock.mockResolvedValue({ newCalls: 5, duplicates: 0, errors: [] });

    const res = await POST(makeReq({ authorization: 'Bearer fake.oidc.token' }));
    expect(res.status).toBe(200);
    expect(requirePlatformAdminMock).not.toHaveBeenCalled();
    expect(runDiscoveryMock).toHaveBeenCalledOnce();
  });

  it('returns 401 when Scheduler verification fails', async () => {
    const { Errors } = await import('@/lib/errors');
    verifySchedulerOIDCMock.mockRejectedValue(Errors.unauthorized());

    const res = await POST(makeReq({ authorization: 'Bearer bad' }));
    expect(res.status).toBe(401);
    expect(requirePlatformAdminMock).not.toHaveBeenCalled();
    expect(runDiscoveryMock).not.toHaveBeenCalled();
  });

  it('returns 401 when no auth at all', async () => {
    const { Errors } = await import('@/lib/errors');
    verifySchedulerOIDCMock.mockResolvedValue(null);
    requirePlatformAdminMock.mockRejectedValue(Errors.unauthorized());

    const res = await POST(makeReq());
    expect(res.status).toBe(401);
    expect(runDiscoveryMock).not.toHaveBeenCalled();
  });

  it('returns 503 when discovery has errors and 0 new calls', async () => {
    verifySchedulerOIDCMock.mockResolvedValue({ source: 'scheduler' });
    runDiscoveryMock.mockResolvedValue({ newCalls: 0, duplicates: 0, errors: ['perplexity timeout'] });

    const res = await POST(makeReq({ authorization: 'Bearer good' }));
    expect(res.status).toBe(503);
  });

  it('logs the auth path and the discovery result', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    verifySchedulerOIDCMock.mockResolvedValue({ source: 'scheduler' });
    runDiscoveryMock.mockResolvedValue({ newCalls: 2, duplicates: 0, errors: [] });

    await POST(makeReq({ authorization: 'Bearer good' }));
    const logs = logSpy.mock.calls.map((args) => String(args[0]));
    expect(logs.some((l) => l.includes('discovery.run.start'))).toBe(true);
    expect(logs.some((l) => l.includes('discovery.run.complete'))).toBe(true);
    logSpy.mockRestore();
  });

  it('returns 500 when discovery throws unexpectedly', async () => {
    verifySchedulerOIDCMock.mockResolvedValue({ source: 'scheduler' });
    runDiscoveryMock.mockRejectedValue(new Error('boom'));

    const res = await POST(makeReq({ authorization: 'Bearer good' }));
    expect(res.status).toBe(500);
  });
});

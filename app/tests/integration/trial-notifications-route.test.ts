import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('POST /api/v1/admin/billing/trial-notifications', () => {
  it('runs the lifecycle notification job for platform admins', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requirePlatformAdmin: vi.fn().mockResolvedValue({ id: 'admin-1', email: 'admin@test.com' }),
    }));
    vi.doMock('@/lib/billing/trial-notifications', () => ({
      runTrialLifecycleNotifications: vi.fn().mockResolvedValue({
        dryRun: true,
        processed: 10,
        matched: 3,
        emailed: 3,
        skippedExisting: 0,
        failed: 0,
      }),
    }));

    const { POST } = await import('@/app/api/v1/admin/billing/trial-notifications/route');
    const response = await POST(new NextRequest('http://localhost:3000/api/v1/admin/billing/trial-notifications?dryRun=true', { method: 'POST' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.matched).toBe(3);
  });

  it('runs the lifecycle notification job with a valid scheduler token', async () => {
    vi.resetModules();
    vi.stubEnv('TRIAL_NOTIFICATIONS_AUTH_TOKEN', 'secret-scheduler-token');

    vi.doMock('@/lib/auth/helpers', () => ({
      requirePlatformAdmin: vi.fn().mockRejectedValue(new Error('Should not be called')),
    }));
    vi.doMock('@/lib/billing/trial-notifications', () => ({
      runTrialLifecycleNotifications: vi.fn().mockResolvedValue({
        dryRun: false,
        processed: 5,
        matched: 1,
        emailed: 1,
        skippedExisting: 0,
        failed: 0,
      }),
    }));

    const { POST } = await import('@/app/api/v1/admin/billing/trial-notifications/route');
    const req = new NextRequest('http://localhost:3000/api/v1/admin/billing/trial-notifications?dryRun=false', {
      method: 'POST',
      headers: { 'x-trial-notifications-token': 'secret-scheduler-token' },
    });
    const response = await POST(req);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.matched).toBe(1);
    vi.unstubAllEnvs();
  });

  it('rejects the request when no session or valid token is provided', async () => {
    vi.resetModules();
    vi.stubEnv('TRIAL_NOTIFICATIONS_AUTH_TOKEN', 'secret-scheduler-token');

    // Import Errors after resetModules so instanceof matches the route's FondEUError
    const { Errors } = await import('@/lib/errors');

    vi.doMock('@/lib/auth/helpers', () => ({
      requirePlatformAdmin: vi.fn().mockRejectedValue(Errors.forbidden()),
    }));

    const { POST } = await import('@/app/api/v1/admin/billing/trial-notifications/route');
    const req = new NextRequest('http://localhost:3000/api/v1/admin/billing/trial-notifications', {
      method: 'POST',
      headers: { 'x-trial-notifications-token': 'wrong-token' },
    });
    const response = await POST(req);

    expect(response.status).toBe(403);
    vi.unstubAllEnvs();
  });
});

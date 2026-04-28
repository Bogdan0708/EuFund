import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Migrated from e2e/api-admin.spec.ts ("GET /api/v1/admin/funding-ai/review-queue").
// The list endpoint had no integration coverage; the [id] route is covered by
// funding-ai-review-queue-item-route.test.ts. Pins admin gate + list shape.

const url = 'http://localhost:3000/api/v1/admin/funding-ai/review-queue';

describe('GET /api/v1/admin/funding-ai/review-queue', () => {
  it('returns 403 for non-admin users', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requirePlatformAdmin: vi.fn().mockImplementation(async () => {
        const { Errors } = await import('@/lib/errors');
        throw Errors.forbidden();
      }),
      getPaginationParams: vi.fn().mockReturnValue({ page: 1, perPage: 20, offset: 0 }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: { query: { fundingReviewQueue: { findMany: vi.fn().mockResolvedValue([]) } } },
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }));

    const { GET } = await import('@/app/api/v1/admin/funding-ai/review-queue/route');
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(403);
  });

  it('returns 200 with paginated items for an admin', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requirePlatformAdmin: vi.fn().mockResolvedValue({ id: 'admin-1', isPlatformAdmin: true }),
      getPaginationParams: vi.fn().mockReturnValue({ page: 1, perPage: 20, offset: 0 }),
    }));

    const findMany = vi.fn().mockResolvedValue([
      { id: 'q-1', callExternalKey: 'CALL-1', severity: 'high', status: 'pending' },
    ]);
    vi.doMock('@/lib/db', () => ({
      db: { query: { fundingReviewQueue: { findMany } } },
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }));

    const { GET } = await import('@/app/api/v1/admin/funding-ai/review-queue/route');
    const response = await GET(new NextRequest(url));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.page).toBe(1);
    expect(body.data.perPage).toBe(20);
  });
});

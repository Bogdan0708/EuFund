import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Migrated from e2e/api-admin.spec.ts ("GET /api/v1/admin/funding-ai/documents").
// Pins the platform-admin auth gate plus the success-path shape contract.

const url = 'http://localhost:3000/api/v1/admin/funding-ai/documents';

describe('GET /api/v1/admin/funding-ai/documents', () => {
  it('returns 403 for non-admin users', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requirePlatformAdmin: vi.fn().mockImplementation(async () => {
        const { Errors } = await import('@/lib/errors');
        throw Errors.forbidden();
      }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: { query: { fundingDocumentsRaw: { findMany: vi.fn().mockResolvedValue([]) } } },
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }));

    const { GET } = await import('@/app/api/v1/admin/funding-ai/documents/route');
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(403);
  });

  it('returns 200 with the list of funding documents for an admin', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requirePlatformAdmin: vi.fn().mockResolvedValue({ id: 'admin-1', isPlatformAdmin: true }),
    }));

    const findMany = vi.fn().mockResolvedValue([
      { id: 'doc-1', externalKey: 'k1', sha256: 'a'.repeat(64), title: 'Doc 1' },
      { id: 'doc-2', externalKey: 'k2', sha256: 'b'.repeat(64), title: 'Doc 2' },
    ]);
    vi.doMock('@/lib/db', () => ({
      db: { query: { fundingDocumentsRaw: { findMany } } },
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }));

    const { GET } = await import('@/app/api/v1/admin/funding-ai/documents/route');
    const response = await GET(new NextRequest(url));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('/api/documents/[id] DELETE storage cleanup', () => {
  it('soft-deletes document and triggers storage deletion', async () => {
    vi.resetModules();

    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
    }));

    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) => fn({
        query: {
          documents: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'doc-1',
              orgId: 'org-1',
              projectId: null,
              uploadedBy: 'user-1',
              storagePath: 'gcs://bucket/path/doc-1.pdf',
            }),
          },
        },
        update: vi.fn(() => ({ set })),
      })),
    }));

    const deleteObject = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/storage/gcs', () => ({
      getSignedDownloadUrl: vi.fn(),
      getObjectBuffer: vi.fn(),
      computeSha256: vi.fn(() => 'abc'),
      deleteObject,
    }));

    const logAudit = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/legal/audit', () => ({ logAudit }));

    vi.doMock('@/lib/logger', () => ({
      logger: {
        child: () => ({ error: vi.fn(), warn: vi.fn() }),
      },
    }));

    const { DELETE } = await import('@/app/api/documents/[id]/route');
    const req = new NextRequest('http://localhost:3000/api/documents/doc-1', { method: 'DELETE' });

    const res = await DELETE(req, { params: { id: 'doc-1' } });

    expect(res.status).toBe(200);
    expect(deleteObject).toHaveBeenCalledWith('gcs://bucket/path/doc-1.pdf');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'document.delete',
      metadata: { storageDeleted: true },
    }));
  });
});

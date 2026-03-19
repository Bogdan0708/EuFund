import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('/api/documents/[id] signed URL download', () => {
  it('redirects to signed URL when object is stored in GCS', async () => {
    vi.resetModules();

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
              storagePath: 'gcs://bucket/2026-02-27/doc-1.pdf',
              filename: 'doc.pdf',
              mimeType: 'application/pdf',
              fileSize: 123,
              checksumSha256: null,
            }),
          },
        },
      })),
    }));

    vi.doMock('@/lib/storage/gcs', () => ({
      getSignedDownloadUrl: vi.fn().mockResolvedValue('https://storage.googleapis.com/signed-url'),
      getObjectBuffer: vi.fn(),
      computeSha256: vi.fn(() => 'abc'),
    }));

    vi.doMock('@/lib/legal/audit', () => ({
      logAudit: vi.fn().mockResolvedValue(undefined),
    }));

    const { GET } = await import('@/app/api/documents/[id]/route');
    const req = new NextRequest('http://localhost:3000/api/documents/doc-1?download=true');

    const res = await GET(req, { params: { id: 'doc-1' } });

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://storage.googleapis.com/signed-url');
  });
});

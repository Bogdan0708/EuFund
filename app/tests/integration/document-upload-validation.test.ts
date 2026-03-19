import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('/api/documents/upload validation hardening', () => {
  it('rejects MIME/signature mismatch (PDF bytes declared as DOCX)', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
    }));
    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) => fn({
        query: { projects: { findFirst: vi.fn().mockResolvedValue(null) } },
      })),
    }));

    const { POST } = await import('@/app/api/documents/upload/route');

    const form = new FormData();
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    form.set('file', new File([pdfBytes], 'fake.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }));

    const req = new NextRequest('http://localhost:3000/api/documents/upload', {
      method: 'POST',
      body: form,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects text/plain files containing null bytes', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
    }));
    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) => fn({
        query: { projects: { findFirst: vi.fn().mockResolvedValue(null) } },
      })),
    }));

    const { POST } = await import('@/app/api/documents/upload/route');

    const form = new FormData();
    form.set('file', new File([new Uint8Array([0x41, 0x00, 0x42])], 'binary.txt', { type: 'text/plain' }));

    const req = new NextRequest('http://localhost:3000/api/documents/upload', {
      method: 'POST',
      body: form,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

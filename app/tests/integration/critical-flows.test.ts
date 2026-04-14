import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

function createJsonRequest(path: string, body: unknown, method = 'POST') {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Critical Flows and Isolation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('authorization boundary: document access is controlled by RLS at the database level', async () => {
    // In the new model, cross-tenant isolation is enforced by PostgreSQL RLS policies.
    // withUserRLS sets app.current_user_id and the DB filters out unauthorised rows.
    // In this unit test the DB is mocked, so the mock drives the result.
    // A non-existent document (RLS filtered) would return null → 404, not 403.
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-a', email: 'a@test.com' }),
    }));
    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: any) => Promise<unknown>) => fn({
        query: {
          documents: {
            // RLS would return null for a document the user cannot access
            findFirst: vi.fn().mockResolvedValue(null),
          },
          projects: { findFirst: vi.fn() },
        },
        update: vi.fn(),
      })),
      db: {
        query: {
          documents: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
        },
      },
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }));

    const { GET } = await import('@/app/api/documents/[id]/route');
    const req = new NextRequest('http://localhost:3000/api/documents/doc-1');
    const res = await GET(req, { params: { id: 'doc-1' } });

    // RLS-filtered document → not found
    expect(res.status).toBe(404);
  });

  it('tenant isolation: upload rejects org/project mismatch', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@test.com', name: 'U' }),
    }));
    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: any) => Promise<unknown>) => fn({
        query: {
          projects: {
            findFirst: vi.fn().mockResolvedValue({ id: 'proj-2', orgId: 'org-2' }),
          },
        },
        insert: vi.fn(),
      })),
      db: {
        query: {
          projects: {
            findFirst: vi.fn().mockResolvedValue({ id: 'proj-2', orgId: 'org-2' }),
          },
        },
      },
    }));

    const { POST } = await import('@/app/api/documents/upload/route');
    const form = new FormData();
    form.set('orgId', 'org-1');
    form.set('projectId', 'proj-2');
    form.set('docType', 'altul');
    form.set('file', new File(['hello'], 'note.txt', { type: 'text/plain' }));
    const req = new NextRequest('http://localhost:3000/api/documents/upload', { method: 'POST', body: form });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

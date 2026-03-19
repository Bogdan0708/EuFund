import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('POST /api/v1/projects/[id]/comments', () => {
  it('creates a comment and writes an audit event', async () => {
    vi.resetModules();

    const logAudit = vi.fn().mockResolvedValue(undefined);

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@test.com' }),
    }));
    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: any) => Promise<unknown>) => fn({
        query: {
          projects: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'project-1',
              orgId: 'org-1',
            }),
          },
        },
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{
              id: 'comment-1',
              projectId: 'project-1',
              userId: 'user-1',
              section: 'summary',
              content: 'Needs more detail.',
            }]),
          }),
        }),
      })),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit }));

    const { POST } = await import('@/app/api/v1/projects/[id]/comments/route');
    const response = await POST(new NextRequest('http://localhost:3000/api/v1/projects/project-1/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        section: 'summary',
        content: 'Needs more detail.',
      }),
    }), { params: { id: 'project-1' } });
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.success).toBe(true);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'project.comment_add',
      resourceId: 'project-1',
      metadata: expect.objectContaining({
        commentId: 'comment-1',
        section: 'summary',
      }),
    }));
  });
});

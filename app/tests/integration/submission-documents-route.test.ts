import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('PATCH /api/v1/projects/[id]/submission-documents/[docId]', () => {
  it('updates a submission document status for an RLS-authorized project member', async () => {
    vi.resetModules();

    const projectId = '123e4567-e89b-42d3-a456-426614174000';
    const docId = 'doc-general-declaratie-gdpr';
    const existingDocs = [
      {
        id: docId,
        title: 'Declarație GDPR',
        userStatus: 'not_started',
        userStatusAt: null,
      },
      {
        id: 'doc-call-specific-minimis',
        title: 'Declarație minimis',
        userStatus: 'not_started',
        userStatusAt: null,
      },
    ];

    const projectDocumentsSelectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{
        id: 'project-doc-1',
        projectId,
        version: 3,
        metadata: { submissionDocuments: existingDocs },
      }]),
    };

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const updateMock = vi.fn().mockReturnValue({ set: updateSet });

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-2', email: 'member@test.com' }),
    }));
    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: any) => Promise<unknown>) => fn({
        query: {
          projects: {
            findFirst: vi.fn().mockResolvedValue({
              id: projectId,
              orgId: 'org-1',
              title: 'Project Alpha',
            }),
          },
        },
      })),
      db: {
        select: vi.fn().mockReturnValue(projectDocumentsSelectChain),
        update: updateMock,
      },
    }));

    const { PATCH } = await import('@/app/api/v1/projects/[id]/submission-documents/[docId]/route');
    const response = await PATCH(new NextRequest(
      `http://localhost:3000/api/v1/projects/${projectId}/submission-documents/${docId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userStatus: 'completed' }),
      },
    ), { params: { id: projectId, docId } });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.document.id).toBe(docId);
    expect(json.document.userStatus).toBe('completed');
    expect(typeof json.document.userStatusAt).toBe('string');

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        submissionDocuments: [
          expect.objectContaining({
            id: docId,
            userStatus: 'completed',
            userStatusAt: expect.any(String),
          }),
          expect.objectContaining({
            id: 'doc-call-specific-minimis',
            userStatus: 'not_started',
          }),
        ],
      }),
      updatedAt: expect.any(Date),
    }));
    expect(updateWhere).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when RLS denies access to the project', async () => {
    vi.resetModules();

    const projectId = '123e4567-e89b-42d3-a456-426614174000';

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-2', email: 'member@test.com' }),
    }));
    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: any) => Promise<unknown>) => fn({
        query: {
          projects: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
        },
      })),
      db: {
        select: vi.fn(),
        update: vi.fn(),
      },
    }));

    const { PATCH } = await import('@/app/api/v1/projects/[id]/submission-documents/[docId]/route');
    const response = await PATCH(new NextRequest(
      `http://localhost:3000/api/v1/projects/${projectId}/submission-documents/doc-missing`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userStatus: 'completed' }),
      },
    ), { params: { id: projectId, docId: 'doc-missing' } });

    expect(response.status).toBe(404);
  });
});

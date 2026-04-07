import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const PROJECT_ID = '123e4567-e89b-42d3-a456-426614174000';

describe('GET /api/v1/projects/[id]', () => {
  it('returns latest project_documents metadata alongside project data', async () => {
    vi.resetModules();

    const project = {
      id: PROJECT_ID,
      orgId: 'org-1',
      title: 'Project Alpha',
      status: 'ciorna',
    };
    const metadata = {
      qaResult: { passed: true },
      submissionDocuments: [{ id: 'doc-1', title: 'Declarație GDPR' }],
    };

    const latestDocChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ metadata }]),
    };

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@test.com' }),
    }));
    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: any) => Promise<unknown>) => fn({
        query: {
          projects: { findFirst: vi.fn().mockResolvedValue(project) },
          organizations: { findFirst: vi.fn().mockResolvedValue({ name: 'Org One' }) },
        },
      })),
      db: {
        select: vi.fn().mockReturnValue(latestDocChain),
      },
    }));

    const { GET } = await import('@/app/api/v1/projects/[id]/route');
    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v1/projects/${PROJECT_ID}`, { method: 'GET' }),
      { params: { id: PROJECT_ID } },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.id).toBe(PROJECT_ID);
    expect(json.data.organizationName).toBe('Org One');
    expect(json.data.metadata).toEqual(metadata);
  });
});

describe('PUT /api/v1/projects/[id] workflow guards', () => {
  it('rejects direct transition from review to draft', async () => {
    vi.resetModules();

    const project = {
      id: PROJECT_ID,
      orgId: 'org-1',
      title: 'Project Alpha',
      status: 'verificare',
    };

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@test.com' }),
    }));
    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: any) => Promise<unknown>) => fn({
        query: {
          projects: { findFirst: vi.fn().mockResolvedValue(project) },
          organizations: { findFirst: vi.fn() },
        },
        update: vi.fn(),
      })),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

    const { PUT } = await import('@/app/api/v1/projects/[id]/route');
    const response = await PUT(new NextRequest(`http://localhost:3000/api/v1/projects/${PROJECT_ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'ciorna' }),
    }), { params: { id: PROJECT_ID } });
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error.code).toBe('CONFLICT');
    expect(json.error.details.reason).toBe('PROJECT_UNDER_REVIEW');
  });

  it('rejects terminal approval states on the generic update route', async () => {
    vi.resetModules();

    const project = {
      id: PROJECT_ID,
      orgId: 'org-1',
      title: 'Project Alpha',
      status: 'ciorna',
    };

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@test.com' }),
    }));
    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: any) => Promise<unknown>) => fn({
        query: {
          projects: { findFirst: vi.fn().mockResolvedValue(project) },
          organizations: { findFirst: vi.fn() },
        },
        update: vi.fn(),
      })),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

    const { PUT } = await import('@/app/api/v1/projects/[id]/route');
    const response = await PUT(new NextRequest(`http://localhost:3000/api/v1/projects/${PROJECT_ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'finalizat' }),
    }), { params: { id: PROJECT_ID } });
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error.code).toBe('CONFLICT');
    expect(json.error.details.reason).toBe('PROJECT_STATUS_WORKFLOW_REQUIRED');
  });

  it('requires org admin for direct submission status', async () => {
    vi.resetModules();

    const project = {
      id: PROJECT_ID,
      orgId: 'org-1',
      title: 'Project Alpha',
      status: 'in_lucru',
    };

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@test.com' }),
    }));
    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: any) => Promise<unknown>) => fn({
        query: {
          projects: { findFirst: vi.fn().mockResolvedValue(project) },
          organizations: { findFirst: vi.fn() },
        },
        update: vi.fn(),
      })),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

    const { PUT } = await import('@/app/api/v1/projects/[id]/route');
    const response = await PUT(new NextRequest(`http://localhost:3000/api/v1/projects/${PROJECT_ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'depus' }),
    }), { params: { id: PROJECT_ID } });
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error.code).toBe('FORBIDDEN');
    expect(json.error.details.reason).toBe('PROJECT_SUBMISSION_REQUIRES_ADMIN');
  });
});

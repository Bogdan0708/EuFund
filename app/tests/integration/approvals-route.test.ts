import { describe, expect, it, vi } from 'vitest';

describe('POST /api/v1/approvals', () => {
  it('approves a project from verificare to finalizat', async () => {
    vi.resetModules();

    const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const logAudit = vi.fn().mockResolvedValue(undefined);

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({
        id: '123e4567-e89b-42d3-a456-426614174000',
        email: 'admin@test.com',
      }),
      getPaginationParams: vi.fn(),
    }));

    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: any) => Promise<unknown>) => fn({
        query: {
          projects: {
            findFirst: vi.fn().mockResolvedValue({
              id: '123e4567-e89b-42d3-a456-426614174999',
              orgId: '123e4567-e89b-42d3-a456-426614174001',
              status: 'verificare',
              metadata: {},
            }),
          },
          orgMembers: {
            findMany: vi.fn().mockResolvedValue([
              { orgId: '123e4567-e89b-42d3-a456-426614174001' },
            ]),
          },
        },
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn(),
          }),
        }),
        update: vi.fn().mockReturnValue({ set: updateSet }),
      })),
      db: {
        query: {
          projects: {
            findFirst: vi.fn().mockResolvedValue({
              id: '123e4567-e89b-42d3-a456-426614174999',
              orgId: '123e4567-e89b-42d3-a456-426614174001',
              status: 'verificare',
              metadata: {},
            }),
          },
          orgMembers: {
            findMany: vi.fn().mockResolvedValue([
              { orgId: '123e4567-e89b-42d3-a456-426614174001' },
            ]),
          },
        },
        update: vi.fn().mockReturnValue({ set: updateSet }),
      },
    }));

    vi.doMock('@/lib/legal/audit', () => ({ logAudit }));
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ error: vi.fn() }) },
    }));

    const { POST } = await import('@/app/api/v1/approvals/route');
    const request = new Request('http://localhost:3000/api/v1/approvals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgId: '123e4567-e89b-42d3-a456-426614174001',
        projectId: '123e4567-e89b-42d3-a456-426614174999',
        decision: 'approve',
      }),
    });

    const res = await POST(request as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'finalizat' }));
    expect(body.data.status).toBe('finalizat');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'project.status_change',
      newValue: { status: 'finalizat' },
    }));
  });

  it('rejects a project from verificare to ciorna and stores feedback', async () => {
    vi.resetModules();

    const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const logAudit = vi.fn().mockResolvedValue(undefined);

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({
        id: '123e4567-e89b-42d3-a456-426614174000',
        email: 'admin@test.com',
      }),
      getPaginationParams: vi.fn(),
    }));

    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: any) => Promise<unknown>) => fn({
        query: {
          projects: {
            findFirst: vi.fn().mockResolvedValue({
              id: '123e4567-e89b-42d3-a456-426614174999',
              orgId: '123e4567-e89b-42d3-a456-426614174001',
              status: 'verificare',
              metadata: {},
            }),
          },
          orgMembers: {
            findMany: vi.fn().mockResolvedValue([
              { orgId: '123e4567-e89b-42d3-a456-426614174001' },
            ]),
          },
        },
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn(),
          }),
        }),
        update: vi.fn().mockReturnValue({ set: updateSet }),
      })),
      db: {
        query: {
          projects: {
            findFirst: vi.fn().mockResolvedValue({
              id: '123e4567-e89b-42d3-a456-426614174999',
              orgId: '123e4567-e89b-42d3-a456-426614174001',
              status: 'verificare',
              metadata: {},
            }),
          },
          orgMembers: {
            findMany: vi.fn().mockResolvedValue([
              { orgId: '123e4567-e89b-42d3-a456-426614174001' },
            ]),
          },
        },
        update: vi.fn().mockReturnValue({ set: updateSet }),
      },
    }));

    vi.doMock('@/lib/legal/audit', () => ({ logAudit }));
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ error: vi.fn() }) },
    }));

    const { POST } = await import('@/app/api/v1/approvals/route');
    const request = new Request('http://localhost:3000/api/v1/approvals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgId: '123e4567-e89b-42d3-a456-426614174001',
        projectId: '123e4567-e89b-42d3-a456-426614174999',
        decision: 'reject',
        feedback: 'Lipsește justificarea indicatorilor de rezultat.',
      }),
    });

    const res = await POST(request as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'ciorna',
      metadata: expect.objectContaining({
        approvalFeedback: 'Lipsește justificarea indicatorilor de rezultat.',
      }),
    }));
    expect(body.data.status).toBe('ciorna');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        decision: 'reject',
      }),
    }));
  });

  it('rejects approval actions without orgId when the user administers multiple orgs', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({
        id: '123e4567-e89b-42d3-a456-426614174000',
        email: 'admin@test.com',
      }),
      getPaginationParams: vi.fn(),
    }));

    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: any) => Promise<unknown>) => fn({
        query: {
          projects: {
            findFirst: vi.fn(),
          },
          orgMembers: {
            findMany: vi.fn().mockResolvedValue([
              { orgId: '123e4567-e89b-42d3-a456-426614174001' },
              { orgId: '123e4567-e89b-42d3-a456-426614174002' },
            ]),
          },
        },
        update: vi.fn(),
      })),
      db: {},
    }));

    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ error: vi.fn() }) },
    }));

    const { POST } = await import('@/app/api/v1/approvals/route');
    const request = new Request('http://localhost:3000/api/v1/approvals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: '123e4567-e89b-42d3-a456-426614174999',
        decision: 'approve',
      }),
    });

    const res = await POST(request as any);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.details.reason).toBe('APPROVAL_ORG_REQUIRED');
  });
});

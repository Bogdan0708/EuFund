import { describe, expect, it, vi } from 'vitest';

describe('POST /api/v1/organizations/[id]/approvals', () => {
  it('maps approve decisions to finalizat', async () => {
    vi.resetModules();

    const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({
        id: '123e4567-e89b-42d3-a456-426614174000',
        email: 'admin@test.com',
      }),
      getPaginationParams: vi.fn(),
    }));
    vi.doMock('@/lib/db', () => ({
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
        },
        update: vi.fn().mockReturnValue({ set: updateSet }),
        select: vi.fn(),
      },
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ error: vi.fn() }) },
    }));

    const { POST } = await import('@/app/api/v1/organizations/[id]/approvals/route');
    const request = new Request('http://localhost:3000/api/v1/organizations/123e4567-e89b-42d3-a456-426614174001/approvals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: '123e4567-e89b-42d3-a456-426614174999',
        decision: 'approve',
      }),
    });

    const res = await POST(request as any, {
      params: { id: '123e4567-e89b-42d3-a456-426614174001' },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'finalizat' }));
    expect(body.data.status).toBe('finalizat');
  });

  it('maps reject decisions to ciorna and stores feedback', async () => {
    vi.resetModules();

    const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({
        id: '123e4567-e89b-42d3-a456-426614174000',
        email: 'admin@test.com',
      }),
      getPaginationParams: vi.fn(),
    }));
    vi.doMock('@/lib/db', () => ({
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
        },
        update: vi.fn().mockReturnValue({ set: updateSet }),
        select: vi.fn(),
      },
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ error: vi.fn() }) },
    }));

    const { POST } = await import('@/app/api/v1/organizations/[id]/approvals/route');
    const request = new Request('http://localhost:3000/api/v1/organizations/123e4567-e89b-42d3-a456-426614174001/approvals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: '123e4567-e89b-42d3-a456-426614174999',
        decision: 'respins',
        feedback: 'Lipsesc detalii esentiale.',
      }),
    });

    const res = await POST(request as any, {
      params: { id: '123e4567-e89b-42d3-a456-426614174001' },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'ciorna',
      metadata: expect.objectContaining({ approvalFeedback: 'Lipsesc detalii esentiale.' }),
    }));
    expect(body.data.status).toBe('ciorna');
  });
});

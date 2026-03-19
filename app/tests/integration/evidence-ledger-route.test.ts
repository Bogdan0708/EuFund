import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('/api/v1/projects/[id]/evidence-ledger', () => {
  it('appends evidence event for authorized project manager', async () => {
    vi.resetModules();
    const logAudit = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@test.com' }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          projects: {
            findFirst: vi.fn().mockResolvedValue({
              id: '123e4567-e89b-42d3-a456-426614174000',
              orgId: 'org-1',
            }),
          },
        },
      },
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit }));

    const { POST } = await import('@/app/api/v1/projects/[id]/evidence-ledger/route');
    const req = new NextRequest('http://localhost:3000/api/v1/projects/123e4567-e89b-42d3-a456-426614174000/evidence-ledger', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        obligationId: 'GHID-1-10',
        title: 'Declaratie eligibilitate semnata',
        evidenceType: 'declaration',
        storageRef: '/docs/evidence/declaratie-eligibilitate.pdf',
        checksumSha256: 'a'.repeat(64),
      }),
    });

    const res = await POST(req, { params: { id: '123e4567-e89b-42d3-a456-426614174000' } });
    expect(res.status).toBe(201);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'project.evidence_append',
      resourceId: '123e4567-e89b-42d3-a456-426614174000',
    }));
  });
});


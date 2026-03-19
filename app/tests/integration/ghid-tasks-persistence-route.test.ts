import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('/api/v1/projects/[id]/compliance/ghid-tasks', () => {
  it('persists generated ghid tasks for authorized project manager', async () => {
    vi.resetModules();
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'user@test.com' }),
    }));
    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) => fn({
        query: {
          projects: {
            findFirst: vi.fn().mockResolvedValue({ id: '123e4567-e89b-42d3-a456-426614174000', orgId: 'org-1' }),
          },
        },
      })),
      db: {
        query: {
          projects: {
            findFirst: vi.fn().mockResolvedValue({ id: '123e4567-e89b-42d3-a456-426614174000', orgId: 'org-1' }),
          },
        },
      },
    }));
    vi.doMock('@/lib/services/compliance', () => ({
      saveGhidComplianceTasks: vi.fn().mockResolvedValue([{ id: 'persisted-1' }]),
      listGhidComplianceTasks: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }));

    const { POST } = await import('@/app/api/v1/projects/[id]/compliance/ghid-tasks/route');
    const req = new NextRequest('http://localhost:3000/api/v1/projects/123e4567-e89b-42d3-a456-426614174000/compliance/ghid-tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ghidText: `
          Solicitantul trebuie să depună documente obligatorii de eligibilitate.
          Bugetul trebuie să respecte regulile de cofinanțare.
          Beneficiarul se va asigura că raportările sunt transmise la termen.
        `.repeat(5),
      }),
    });

    const res = await POST(req, { params: { id: '123e4567-e89b-42d3-a456-426614174000' } });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.inserted).toBe(1);
    expect(json.data.generated).toBeGreaterThan(0);
  });
});

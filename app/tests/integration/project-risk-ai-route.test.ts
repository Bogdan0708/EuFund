import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('POST /api/v1/projects/[id]/risks/ai-assessment', () => {
  it('rejects free-tier users before AI risk assessment runs', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@test.com' }),
      requireOrgRole: vi.fn().mockResolvedValue('project_manager'),
    }));
    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: any) => Promise<unknown>) => fn({
        query: {
          projects: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'project-1',
              orgId: 'org-1',
              title: 'Project Alpha',
              totalBudget: '1000',
              durationMonths: 12,
            }),
          },
        },
      })),
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ tier: 'free' }]),
            }),
          }),
        }),
      },
    }));
    vi.doMock('@/lib/services/risks', () => ({
      listRisks: vi.fn(),
    }));
    vi.doMock('@/lib/services/work-packages', () => ({
      listWorkPackages: vi.fn(),
    }));
    vi.doMock('@/lib/ai/risk-assessment', () => ({
      assessRisk: vi.fn(),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

    const { POST } = await import('@/app/api/v1/projects/[id]/risks/ai-assessment/route');
    const response = await POST(new NextRequest('http://localhost:3000/api/v1/projects/project-1/risks/ai-assessment', {
      method: 'POST',
    }), { params: { id: 'project-1' } });
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error.code).toBe('FORBIDDEN');
  });
});

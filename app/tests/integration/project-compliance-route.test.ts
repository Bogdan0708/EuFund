import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('POST /api/v1/projects/[id]/compliance', () => {
  it('rejects free-tier users before running compliance analysis', async () => {
    vi.resetModules();
    vi.stubEnv('BILLING_ENABLED', 'true');

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
              title: 'Project Alpha',
              status: 'in_lucru',
              sectionSummary: 'Summary',
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
    vi.doMock('@/lib/ai/compliance-validator', () => ({
      validateCompliance: vi.fn(),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

    const { POST } = await import('@/app/api/v1/projects/[id]/compliance/route');
    const response = await POST(new NextRequest('http://localhost:3000/api/v1/projects/project-1/compliance', {
      method: 'POST',
    }), { params: { id: 'project-1' } });
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error.code).toBe('FORBIDDEN');
    vi.unstubAllEnvs();
  });
});

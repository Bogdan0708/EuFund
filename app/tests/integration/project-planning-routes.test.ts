import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('Project planning routes audit coverage', () => {
  it('audits timeline item creation', async () => {
    vi.resetModules();

    const logAudit = vi.fn().mockResolvedValue(undefined);

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@test.com' }),
      requireOrgRole: vi.fn().mockResolvedValue('project_manager'),
    }));
    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: any) => Promise<unknown>) => fn({
        query: {
          projects: {
            findFirst: vi.fn().mockResolvedValue({ id: 'project-1', orgId: 'org-1' }),
          },
          orgMembers: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
        },
      })),
    }));
    vi.doMock('@/lib/services/timeline', () => ({
      getProjectTimeline: vi.fn(),
      createTimelineItem: vi.fn().mockResolvedValue({ id: 'timeline-1' }),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit }));

    const { POST } = await import('@/app/api/v1/projects/[id]/timeline/route');
    const response = await POST(new NextRequest('http://localhost:3000/api/v1/projects/project-1/timeline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        taskName: 'Kickoff',
        startDate: '2026-01-01',
        endDate: '2026-01-05',
      }),
    }), { params: { id: 'project-1' } });

    expect(response.status).toBe(201);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'project.timeline_create',
      resourceId: 'project-1',
      metadata: expect.objectContaining({ timelineItemId: 'timeline-1' }),
    }));
  });

  it('audits risk creation', async () => {
    vi.resetModules();

    const logAudit = vi.fn().mockResolvedValue(undefined);

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@test.com' }),
      requireOrgRole: vi.fn().mockResolvedValue('project_manager'),
    }));
    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: any) => Promise<unknown>) => fn({
        query: {
          projects: {
            findFirst: vi.fn().mockResolvedValue({ id: 'project-1', orgId: 'org-1' }),
          },
        },
      })),
    }));
    vi.doMock('@/lib/services/risks', () => ({
      listRisks: vi.fn(),
      getRiskOverview: vi.fn(),
      createRisk: vi.fn().mockResolvedValue({ id: 'risk-1' }),
      updateRisk: vi.fn(),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit }));

    const { POST } = await import('@/app/api/v1/projects/[id]/risks/route');
    const response = await POST(new NextRequest('http://localhost:3000/api/v1/projects/project-1/risks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        riskType: 'delivery',
        probability: 3,
        impact: 4,
      }),
    }), { params: { id: 'project-1' } });

    expect(response.status).toBe(201);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'project.risk_create',
      resourceId: 'project-1',
      metadata: expect.objectContaining({ riskId: 'risk-1', riskType: 'delivery' }),
    }));
  });
});

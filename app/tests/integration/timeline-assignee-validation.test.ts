import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('Timeline assignee org validation', () => {
  it('rejects POST when assignedTo is outside project organization', async () => {
    vi.resetModules();

    const createTimelineItem = vi.fn();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'u1', email: 'u1@test.com' }),
      requireOrgRole: vi.fn().mockResolvedValue('project_manager'),
    }));
    vi.doMock('@/lib/services/timeline', () => ({
      getProjectTimeline: vi.fn(),
      createTimelineItem,
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          projects: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'p1',
              orgId: 'org-1',
              deletedAt: null,
            }),
          },
          orgMembers: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
        },
      },
    }));
    vi.doMock('@/lib/logger', () => ({
      logger: { error: vi.fn() },
    }));

    const { POST } = await import('@/app/api/v1/projects/[id]/timeline/route');
    const request = new NextRequest('http://localhost:3000/api/v1/projects/p1/timeline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        taskName: 'Task 1',
        startDate: '2026-01-01',
        endDate: '2026-02-01',
        assignedTo: 'u-external',
      }),
    });

    const response = await POST(request, { params: { id: 'p1' } });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error.message).toContain('assignedTo');
    expect(createTimelineItem).not.toHaveBeenCalled();
  });

  it('rejects PUT when assignedTo is outside project organization', async () => {
    vi.resetModules();

    const updateTimelineItem = vi.fn();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'u1', email: 'u1@test.com' }),
      requireOrgRole: vi.fn().mockResolvedValue('project_manager'),
    }));
    vi.doMock('@/lib/services/timeline', () => ({
      updateTimelineItem,
      deleteTimelineItem: vi.fn(),
      updateTimelineProgress: vi.fn(),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          projects: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'p1',
              orgId: 'org-1',
              deletedAt: null,
            }),
          },
          orgMembers: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
        },
      },
    }));
    vi.doMock('@/lib/logger', () => ({
      logger: { error: vi.fn() },
    }));

    const { PUT } = await import('@/app/api/v1/projects/[id]/timeline/[itemId]/route');
    const request = new NextRequest('http://localhost:3000/api/v1/projects/p1/timeline/i1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        assignedTo: 'u-external',
      }),
    });

    const response = await PUT(request, { params: { id: 'p1', itemId: 'i1' } });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error.message).toContain('assignedTo');
    expect(updateTimelineItem).not.toHaveBeenCalled();
  });
});

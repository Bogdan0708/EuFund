import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';

describe('GET /api/v1/projects/:id/sections', () => {
  beforeEach(() => { vi.resetModules(); });

  it('returns sections with session mode when session exists', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID }),
    }));
    vi.doMock('@/lib/ai/orchestrator/workspace', () => ({
      resolveProjectWorkspace: vi.fn().mockResolvedValue({
        project: { id: PROJECT_ID },
        session: { id: SESSION_ID },
        snapshotDoc: null,
        mode: 'session',
        sections: [
          { id: 'sec-1', title: 'Context', content: 'Hello', order: 1, state: 'draft', currentVersion: 1, versionCount: 1, contentHash: 'abc', lastStateChangeAt: '2026-01-01T00:00:00Z', lastStateChangeBy: null, source: 'generated', metadata: {} },
        ],
      }),
    }));

    const { GET } = await import('@/app/api/v1/projects/[id]/sections/route');
    const req = new Request('http://localhost/api/v1/projects/' + PROJECT_ID + '/sections') as unknown as NextRequest;
    const res = await GET(req, { params: { id: PROJECT_ID } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe('session');
    expect(body.readOnly).toBe(false);
    expect(body.sessionId).toBe(SESSION_ID);
    expect(body.sections).toHaveLength(1);
  });

  it('returns readOnly true when no session', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID }),
    }));
    vi.doMock('@/lib/ai/orchestrator/workspace', () => ({
      resolveProjectWorkspace: vi.fn().mockResolvedValue({
        project: { id: PROJECT_ID },
        session: null,
        snapshotDoc: { id: 'doc-1', version: 1 },
        mode: 'snapshot',
        sections: [],
      }),
    }));

    const { GET } = await import('@/app/api/v1/projects/[id]/sections/route');
    const req = new Request('http://localhost/api/v1/projects/' + PROJECT_ID + '/sections') as unknown as NextRequest;
    const res = await GET(req, { params: { id: PROJECT_ID } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe('snapshot');
    expect(body.readOnly).toBe(true);
    expect(body.sessionId).toBeNull();
  });

  it('returns 404 when project not found', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID }),
    }));
    vi.doMock('@/lib/ai/orchestrator/workspace', () => ({
      resolveProjectWorkspace: vi.fn().mockResolvedValue(null),
    }));

    const { GET } = await import('@/app/api/v1/projects/[id]/sections/route');
    const req = new Request('http://localhost/api/v1/projects/' + PROJECT_ID + '/sections') as unknown as NextRequest;
    const res = await GET(req, { params: { id: PROJECT_ID } });

    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/v1/projects/:id/sections/:sectionId', () => {
  beforeEach(() => { vi.resetModules(); });

  it('returns 400 when workspace is read-only (snapshot mode)', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID }),
    }));
    vi.doMock('@/lib/ai/orchestrator/workspace', () => ({
      resolveProjectWorkspace: vi.fn().mockResolvedValue({
        project: { id: PROJECT_ID },
        session: null,
        mode: 'snapshot',
        sections: [],
      }),
      editProjectSection: vi.fn(),
    }));

    const { PATCH } = await import('@/app/api/v1/projects/[id]/sections/[sectionId]/route');
    const req = new Request('http://localhost/test', {
      method: 'PATCH',
      body: JSON.stringify({ content: 'New', expectedCurrentVersion: 1 }),
      headers: { 'Content-Type': 'application/json' },
    }) as unknown as NextRequest;
    const res = await PATCH(req, { params: { id: PROJECT_ID, sectionId: 'sec-1' } });

    expect(res.status).toBe(400);
  });
});

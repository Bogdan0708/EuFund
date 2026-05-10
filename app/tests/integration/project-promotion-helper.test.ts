// app/tests/integration/project-promotion-helper.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// IMPORTANT: drizzle .select({ id: agentSessions.id, userId: agentSessions.userId, ... })
// returns rows with the alias keys (camelCase here, since the helper aliases
// every column to camelCase). The mock row must match those keys, NOT the
// snake_case column names — otherwise session.projectId reads undefined and
// the helper routes into the wrong branch.
const sessionRow = {
  id: 'sess-1',
  userId: 'user-1',
  projectId: null as string | null,
  selectedCallId: 'CODE-123',
  locale: 'ro',
  messageSummary: null,
  planningArtifact: { preselect: { description: 'A '.repeat(60) + 'long enough description' } },
};

const txState: any = {};
const projectInsertRows: Array<any> = [];
const sessionUpdates: Array<any> = [];

function buildTx() {
  return {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn(() => ({
      from: vi.fn((_table: any) => ({
        where: vi.fn(() => ({
          limit: vi.fn(async (_n: number) => {
            const phase = txState.selectPhase ?? 'session';
            if (phase === 'session') {
              txState.selectPhase = sessionRow.projectId ? 'project_lock' : 'user';
              return [sessionRow];
            }
            if (phase === 'project_lock') {
              txState.selectPhase = 'call';
              return [txState.projectRow];
            }
            if (phase === 'user') {
              txState.selectPhase = 'call';
              return [{ id: 'user-1' }];
            }
            return [];
          }),
          for: vi.fn(() => ({
            limit: vi.fn(async () => {
              const phase = txState.selectPhase ?? 'session';
              if (phase === 'session') {
                txState.selectPhase = sessionRow.projectId ? 'project_lock' : 'user';
                return [sessionRow];
              }
              if (phase === 'project_lock') {
                txState.selectPhase = 'call';
                return [txState.projectRow];
              }
              return [];
            }),
          })),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((row: any) => {
        projectInsertRows.push(row);
        return { returning: vi.fn(async () => [{ id: 'new-proj-1' }]) };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((row: any) => {
        sessionUpdates.push(row);
        return { where: vi.fn(async () => undefined) };
      }),
    })),
    query: { orgMembers: { findMany: vi.fn(async () => [{ orgId: 'org-1' }]) } },
  } as any;
}

vi.mock('@/lib/db', () => {
  const tx = buildTx();
  return {
    withUserRLS: vi.fn(async (_uid: string, fn: (t: any) => Promise<any>) => fn(tx)),
  };
});
vi.mock('@/lib/db/schema', () => ({
  agentSessions: { id: 'sess.id', userId: 'sess.user_id', projectId: 'sess.project_id', selectedCallId: 'sess.selected_call_id', locale: 'sess.locale', messageSummary: 'sess.message_summary', planningArtifact: 'sess.planning_artifact', updatedAt: 'sess.updated_at' },
  projects: { id: 'projects.id', metadata: 'projects.metadata', callId: 'projects.call_id', updatedAt: 'projects.updated_at' },
  users: { id: 'users.id' },
  callsForProposals: { id: 'calls.id', callCode: 'calls.call_code', externalId: 'calls.external_id', titleRo: 'calls.title_ro' },
  organizations: { id: 'org.id' },
  orgMembers: { userId: 'om.user_id', orgId: 'om.org_id' },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c: any, v: any) => ({ kind: 'eq', c, v })),
  and: vi.fn((...preds: any[]) => ({ kind: 'and', preds })),
  sql: vi.fn(),
}));
vi.mock('@/lib/legal/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/monitoring/metrics', () => ({
  trackProjectPromotion: vi.fn(),
}));
vi.mock('@/lib/validators/patterns', () => ({ UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i }));

import { ensureProjectForSession } from '@/lib/projects/promotion';
import { logAudit } from '@/lib/legal/audit';
import { trackProjectPromotion } from '@/lib/monitoring/metrics';

const ctx = {
  userId: 'user-1',
  sessionId: 'sess-1',
  requestId: 'req-1',
  now: new Date('2026-05-02T00:00:00Z'),
} as any;

describe('ensureProjectForSession — fresh promotion', () => {
  beforeEach(() => {
    txState.selectPhase = 'session';
    sessionRow.projectId = null;
    projectInsertRows.length = 0;
    sessionUpdates.length = 0;
    vi.clearAllMocks();
  });

  it('promotes a session with selectedCallId and null projectId', async () => {
    const out = await ensureProjectForSession(ctx, 'sess-1');
    expect(out).toMatchObject({
      promoted: true,
      created: true,
      projectId: 'new-proj-1',
      selectedCallResolution: expect.any(String),
      titleSource: expect.any(String),
    });
    expect(projectInsertRows).toHaveLength(1);
    expect(sessionUpdates).toHaveLength(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'project.promoted_from_session',
      resourceType: 'project',
      resourceId: 'new-proj-1',
    }));
    expect(trackProjectPromotion).toHaveBeenCalledWith('promoted');
  });
});

describe('ensureProjectForSession — already linked', () => {
  beforeEach(() => {
    txState.selectPhase = 'session';
    vi.clearAllMocks();
  });

  it('returns synced=false when callId matches project metadata.rawSelectedCallId', async () => {
    sessionRow.projectId = 'existing-proj';
    sessionRow.selectedCallId = 'CODE-123';
    // Project lock SELECT is also drizzle-aliased: { id, metadata, callId }
    txState.projectRow = {
      id: 'existing-proj',
      metadata: { rawSelectedCallId: 'CODE-123', resolvedCallTitle: 'Call X' },
      callId: 'old-call-uuid',
    };
    const out = await ensureProjectForSession(ctx, 'sess-1');
    expect(out).toMatchObject({ promoted: true, created: false, synced: false, projectId: 'existing-proj' });
    expect(logAudit).not.toHaveBeenCalled();
    expect(trackProjectPromotion).toHaveBeenCalledWith('already_linked');
    sessionRow.projectId = null;
  });

  it('syncs project.callId + metadata when session.selectedCallId differs', async () => {
    sessionRow.projectId = 'existing-proj';
    sessionRow.selectedCallId = 'NEW-CODE-999';
    txState.projectRow = {
      id: 'existing-proj',
      metadata: { rawSelectedCallId: 'CODE-123', resolvedCallTitle: 'Call X', existingExtra: 'keep-me' },
      callId: 'old-call-uuid',
    };
    const out = await ensureProjectForSession(ctx, 'sess-1');
    expect(out).toMatchObject({ promoted: true, created: false, synced: true, projectId: 'existing-proj' });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'project.promoted_from_session',
      metadata: expect.objectContaining({ kind: 'call_resynced' }),
    }));
    expect(trackProjectPromotion).toHaveBeenCalledWith('synced');
    sessionRow.projectId = null;
  });
});

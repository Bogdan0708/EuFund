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
  selectedCallId: 'CODE-123' as string | null,
  locale: 'ro',
  messageSummary: null,
  planningArtifact: { preselect: { description: 'A '.repeat(60) + 'long enough description' } },
};

// Per-test tx factory (Option B). Each test's beforeEach rebuilds a fresh tx
// and stores it in `currentTx`. The vi.mock factory delegates to `currentTx`
// so each test gets full isolation without a shared phase machine.
interface TxConfig {
  projectRow?: {
    id: string;
    metadata: Record<string, unknown>;
    callId: string;
  };
}

let currentTxConfig: TxConfig = {};
const projectInsertRows: Array<any> = [];
const sessionUpdates: Array<any> = [];

function buildTx(config: TxConfig = {}) {
  // Track how many times select().from().where() has been called so we can
  // route session vs user vs call queries correctly.
  let selectCallCount = 0;

  return {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async (_n: number) => {
            const call = selectCallCount++;
            if (call === 0) {
              // First SELECT: session lock (no .for('update') in user/call path)
              return [sessionRow];
            }
            if (call === 1) {
              // Second SELECT: user lookup (Branch B) or call lookup
              // For Branch B: user lookup
              return [{ id: 'user-1' }];
            }
            // Subsequent SELECTs: call resolution probes
            return [];
          }),
          for: vi.fn(() => ({
            limit: vi.fn(async () => {
              // .for('update').limit(1) — used for:
              //   - session lock (Branch A+B initial)
              //   - project lock (Branch A only)
              const call = selectCallCount++;
              if (call === 0) {
                // Session lock
                return [sessionRow];
              }
              if (call === 1 && config.projectRow) {
                // Project lock (Branch A)
                return [config.projectRow];
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

// Module-level variable that vi.mock delegates to.
let currentTx: ReturnType<typeof buildTx>;

vi.mock('@/lib/db', () => ({
  withUserRLS: vi.fn(async (_uid: string, fn: (t: any) => Promise<any>) => fn(currentTx)),
}));
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
    sessionRow.projectId = null;
    sessionRow.selectedCallId = 'CODE-123';
    currentTxConfig = {};
    currentTx = buildTx(currentTxConfig);
    projectInsertRows.length = 0;
    sessionUpdates.length = 0;
    vi.clearAllMocks();
    // Re-bind the mock to the new currentTx after clearAllMocks
    currentTx = buildTx(currentTxConfig);
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
    sessionRow.projectId = null;
    sessionRow.selectedCallId = 'CODE-123';
    currentTxConfig = {};
    projectInsertRows.length = 0;
    sessionUpdates.length = 0;
    vi.clearAllMocks();
    // tx is rebuilt per-test below (each test sets its own config)
  });

  it('returns synced=false when callId matches project metadata.rawSelectedCallId', async () => {
    sessionRow.projectId = 'existing-proj';
    sessionRow.selectedCallId = 'CODE-123';
    currentTx = buildTx({
      projectRow: {
        id: 'existing-proj',
        metadata: { rawSelectedCallId: 'CODE-123', resolvedCallTitle: 'Call X' },
        callId: 'old-call-uuid',
      },
    });
    const out = await ensureProjectForSession(ctx, 'sess-1');
    expect(out).toMatchObject({ promoted: true, created: false, synced: false, projectId: 'existing-proj' });
    expect(logAudit).not.toHaveBeenCalled();
    expect(trackProjectPromotion).toHaveBeenCalledWith('already_linked');
    sessionRow.projectId = null;
  });

  it('syncs project.callId + metadata when session.selectedCallId differs', async () => {
    sessionRow.projectId = 'existing-proj';
    sessionRow.selectedCallId = 'NEW-CODE-999';
    currentTx = buildTx({
      projectRow: {
        id: 'existing-proj',
        metadata: { rawSelectedCallId: 'CODE-123', resolvedCallTitle: 'Call X', existingExtra: 'keep-me' },
        callId: 'old-call-uuid',
      },
    });
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

describe('ensureProjectForSession — dry run', () => {
  beforeEach(() => {
    sessionRow.projectId = null;
    sessionRow.selectedCallId = 'CODE-123';
    currentTxConfig = {};
    projectInsertRows.length = 0;
    sessionUpdates.length = 0;
    vi.clearAllMocks();
    currentTx = buildTx(currentTxConfig);
  });

  it('returns the would-be result without committing audit or metric', async () => {
    const out = await ensureProjectForSession(ctx, 'sess-1', { dryRun: true });
    expect(out).toMatchObject({ promoted: true, created: true, projectId: 'new-proj-1' });
    expect(logAudit).not.toHaveBeenCalled();
    expect(trackProjectPromotion).not.toHaveBeenCalled();
  });

  it('does not fire metrics on the not-promotable dry-run path', async () => {
    // Force the NO_SELECTED_CALL branch — it returns normally, doesn't throw.
    // Without the !opts.dryRun guard on the telemetry seam, this would
    // still increment trackProjectPromotion('no_selected_call').
    sessionRow.selectedCallId = null as any;
    const out = await ensureProjectForSession(ctx, 'sess-1', { dryRun: true });
    expect(out).toMatchObject({ promoted: false, reason: 'NO_SELECTED_CALL' });
    expect(trackProjectPromotion).not.toHaveBeenCalled();
    sessionRow.selectedCallId = 'CODE-123';
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('normalizeSections', () => {
  it('fills missing versioning fields with defaults', async () => {
    const { normalizeSections } = await import('@/lib/ai/orchestrator/workspace');

    const raw = [
      { id: 'sec-1', title: 'Context', content: 'Hello', order: 1, source: 'generated', metadata: {} },
    ];

    const result = normalizeSections(raw as any, '2026-01-01T00:00:00Z');
    expect(result).toHaveLength(1);
    expect(result[0].state).toBe('draft');
    expect(result[0].currentVersion).toBe(1);
    expect(result[0].versionCount).toBe(1);
    expect(result[0].contentHash).toHaveLength(64); // SHA-256 hex
    expect(result[0].lastStateChangeAt).toBe('2026-01-01T00:00:00Z');
    expect(result[0].lastStateChangeBy).toBeNull();
  });

  it('preserves already-complete sections unchanged', async () => {
    const { normalizeSections } = await import('@/lib/ai/orchestrator/workspace');

    const complete = [{
      id: 'sec-1', title: 'Context', content: 'Hello', order: 1,
      source: 'generated' as const,
      state: 'approved' as const, currentVersion: 3, versionCount: 3,
      contentHash: 'abc123', lastStateChangeAt: '2026-03-01T00:00:00Z',
      lastStateChangeBy: '22222222-2222-4222-8222-222222222222',
      metadata: { model: 'gpt-4', provider: 'openai', tokensIn: 100, tokensOut: 200, latencyMs: 500, retryCount: 0, fallbackUsed: false, generatedAt: '2026-03-01T00:00:00Z', checksum: 'abc' },
    }];

    const result = normalizeSections(complete, '2026-01-01T00:00:00Z');
    expect(result[0].state).toBe('approved');
    expect(result[0].currentVersion).toBe(3);
    expect(result[0].contentHash).toBe('abc123');
  });
});

// ─── resolveProjectWorkspace Tests ───────────────────────────────

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';

// Helper to create a chainable query builder mock
function createChainMock(resolvedValue: unknown = []) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const self = {
    select: vi.fn(() => self),
    from: vi.fn(() => self),
    where: vi.fn(() => self),
    orderBy: vi.fn(() => self),
    limit: vi.fn(() => self),
    groupBy: vi.fn(() => self),
    update: vi.fn(() => self),
    set: vi.fn(() => self),
    then: vi.fn((resolve: (v: unknown) => void) => resolve(resolvedValue)),
    [Symbol.iterator]: function* () { yield* (resolvedValue as Iterable<unknown>); },
  };
  return self;
}

describe('resolveProjectWorkspace', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns null when project does not exist', async () => {
    vi.doMock('@/lib/db', () => ({
      db: createChainMock([]),
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) => {
        // Simulate tx.query.projects.findFirst returning undefined (project not found)
        const tx = {
          query: {
            projects: {
              findFirst: vi.fn().mockResolvedValue(undefined),
            },
          },
        };
        return fn(tx);
      }),
    }));

    vi.doMock('@/lib/db/schema', () => ({
      projects: { id: 'id', deletedAt: 'deleted_at' },
      workflowSessions: { projectId: 'project_id', userId: 'user_id', status: 'status', updatedAt: 'updated_at', id: 'id', context: 'context' },
      projectDocuments: { projectId: 'project_id', version: 'version' },
      sectionVersions: { sessionId: 'session_id', sectionId: 'section_id', version: 'version' },
    }));

    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }) },
    }));

    const { resolveProjectWorkspace } = await import('@/lib/ai/orchestrator/workspace');
    const result = await resolveProjectWorkspace(PROJECT_ID, USER_ID);
    expect(result).toBeNull();
  });

  it('returns snapshot mode when no qualifying session exists', async () => {
    const now = new Date('2026-04-01T12:00:00Z');
    const mockProject = {
      id: PROJECT_ID,
      title: 'Test Project',
      orgId: '33333333-3333-4333-8333-333333333333',
      createdBy: USER_ID,
      deletedAt: null,
    };
    const mockSnapshotDoc = {
      id: '44444444-4444-4444-8444-444444444444',
      projectId: PROJECT_ID,
      version: 1,
      sections: [
        { id: 'sec-1', title: 'Context', content: 'Snapshot content', order: 1 },
      ],
      actionPlan: null,
      metadata: null,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };

    // Track which table is queried via .from()
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn(function (this: typeof mockDb, table: unknown) {
        (this as Record<string, unknown>).__lastTable = table;
        return this;
      }),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn(function (this: typeof mockDb) {
        // Return empty sessions or the snapshot doc based on which table was queried
        const tbl = (this as Record<string, unknown>).__lastTable as Record<string, string> | undefined;
        if (tbl && tbl === mockSchema.workflowSessions) {
          return Promise.resolve([]);
        }
        if (tbl && tbl === mockSchema.projectDocuments) {
          return Promise.resolve([mockSnapshotDoc]);
        }
        return Promise.resolve([]);
      }),
      // For the sessions query (no .limit() call), make the chain thenable
      then: vi.fn((resolve: (v: unknown) => void) => resolve([])),
    };

    // Override .where to resolve sessions query (which has no .limit())
    // The sessions query chain: db.select().from(workflowSessions).where(...).orderBy(...)
    // It resolves as a thenable without .limit()
    let callCount = 0;
    const originalOrderBy = mockDb.orderBy;
    mockDb.orderBy = vi.fn(function (this: typeof mockDb) {
      callCount++;
      const tbl = (this as Record<string, unknown>).__lastTable as Record<string, string> | undefined;
      if (tbl === mockSchema.workflowSessions) {
        // Sessions query: return thenable array (no .limit())
        const result = Object.assign([], {
          then: (resolve: (v: unknown) => void) => resolve([]),
          limit: vi.fn(() => Promise.resolve([])),
        });
        return result;
      }
      return this;
    }) as typeof originalOrderBy;

    const mockSchema = {
      projects: { id: 'id', deletedAt: 'deleted_at' },
      workflowSessions: { projectId: 'project_id', userId: 'user_id', status: 'status', updatedAt: 'updated_at', id: 'id', context: 'context' },
      projectDocuments: { projectId: 'project_id', version: 'version' },
      sectionVersions: { sessionId: 'session_id', sectionId: 'section_id', version: 'version' },
    };

    vi.doMock('@/lib/db', () => ({
      db: mockDb,
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          query: {
            projects: {
              findFirst: vi.fn().mockResolvedValue(mockProject),
            },
          },
        };
        return fn(tx);
      }),
    }));

    vi.doMock('@/lib/db/schema', () => mockSchema);

    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }) },
    }));

    const { resolveProjectWorkspace } = await import('@/lib/ai/orchestrator/workspace');
    const result = await resolveProjectWorkspace(PROJECT_ID, USER_ID);

    expect(result).not.toBeNull();
    expect(result!.mode).toBe('snapshot');
    expect(result!.session).toBeNull();
    expect(result!.project.id).toBe(PROJECT_ID);
    expect(result!.snapshotDoc).not.toBeNull();
    expect(result!.sections).toHaveLength(1);
    expect(result!.sections[0].title).toBe('Context');
    expect(result!.sections[0].content).toBe('Snapshot content');
    expect(result!.sections[0].state).toBe('draft');
    expect(result!.sections[0].currentVersion).toBe(1);
  });
});

// ─── editProjectSection Tests ───────────────────────────────────

describe('editProjectSection', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws when expectedCurrentVersion is stale', async () => {
    const section = {
      id: 'sec-1', title: 'Context', content: 'Old text', order: 1,
      source: 'generated' as const,
      state: 'draft' as const, currentVersion: 3, versionCount: 3,
      contentHash: 'oldhash',
      lastStateChangeAt: '2026-04-05T00:00:00Z', lastStateChangeBy: USER_ID,
      metadata: { model: 'gpt-4', provider: 'openai', tokensIn: 100, tokensOut: 200, latencyMs: 500, retryCount: 0, fallbackUsed: false, generatedAt: '2026-04-05T00:00:00Z', checksum: 'abc' },
    };

    vi.doMock('@/lib/db', () => ({
      db: {
        transaction: vi.fn().mockImplementation(async (fn: Function) => {
          const tx = {
            select: () => ({
              from: () => ({
                where: () => ({
                  for: () => [{ id: SESSION_ID, projectId: PROJECT_ID, context: { projectSections: [section] } }],
                }),
              }),
            }),
            insert: () => ({ values: vi.fn() }),
            update: () => ({ set: () => ({ where: vi.fn() }) }),
          };
          return fn(tx);
        }),
      },
    }));
    vi.doMock('@/lib/db/schema', () => ({
      workflowSessions: {}, sectionVersions: {}, projectDocuments: {},
    }));
    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn(), and: vi.fn(), desc: vi.fn(),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }));
    vi.doMock('@/lib/ai/orchestrator/pubsub', () => ({ persistAndPublishSectionUpdatedEvent: vi.fn() }));
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => new Proxy({}, { get: () => vi.fn() }) },
    }));

    const { editProjectSection } = await import('@/lib/ai/orchestrator/workspace');

    await expect(editProjectSection({
      sessionId: SESSION_ID,
      sectionId: 'sec-1',
      content: 'New text',
      expectedCurrentVersion: 2, // stale! section is at version 3
      userId: USER_ID,
    })).rejects.toThrow();
  });
});

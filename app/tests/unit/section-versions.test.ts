import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function mockInsertChain(inserted: unknown[]) {
  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((row: unknown) => {
        inserted.push(row);
        return { returning: vi.fn().mockResolvedValue([row]) };
      }),
    }),
  };
}

describe('persistSectionChanges', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('writes v1 for every section on initial generation', async () => {
    const insertedVersions: unknown[] = [];

    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn().mockImplementation(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) => {
          const tx = mockInsertChain(insertedVersions);
          return fn(tx);
        }),
    }));

    vi.doMock('@/lib/legal/audit', () => ({
      logAudit: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
    }));

    const { persistSectionChanges } = await import('@/lib/section-versions');

    const newSections = [
      {
        id: 'context', title: 'Context', content: 'Text A', order: 1,
        source: 'generated' as const,
        state: 'draft' as const, currentVersion: 0, versionCount: 0,
        contentHash: '', lastStateChangeAt: '', lastStateChangeBy: null,
        metadata: { model: 'gpt-5.4', provider: 'openai', tokensIn: 100, tokensOut: 50, latencyMs: 200, retryCount: 0, fallbackUsed: false, generatedAt: '2026-04-05T00:00:00Z', checksum: 'abc' },
      },
      {
        id: 'obiective', title: 'Obiective', content: 'Text B', order: 2,
        source: 'generated' as const,
        state: 'draft' as const, currentVersion: 0, versionCount: 0,
        contentHash: '', lastStateChangeAt: '', lastStateChangeBy: null,
        metadata: { model: 'gpt-5.4', provider: 'openai', tokensIn: 80, tokensOut: 40, latencyMs: 180, retryCount: 0, fallbackUsed: false, generatedAt: '2026-04-05T00:00:00Z', checksum: 'def' },
      },
    ];

    const enriched = await persistSectionChanges({
      sessionId: SESSION_ID,
      userId: USER_ID,
      previousSections: null,
      newSections,
      reason: 'initial_generation',
    });

    expect(insertedVersions).toHaveLength(2);
    expect(enriched[0].currentVersion).toBe(1);
    expect(enriched[0].versionCount).toBe(1);
    expect(enriched[0].state).toBe('draft');
    expect(enriched[0].contentHash).toBe(hash('Text A'));
    expect(enriched[0].lastStateChangeBy).toBe(USER_ID);
    expect(enriched[1].currentVersion).toBe(1);
    expect(enriched[1].contentHash).toBe(hash('Text B'));
    expect(enriched[1].versionCount).toBe(1);
    expect(enriched[1].state).toBe('draft');
    expect(enriched[1].lastStateChangeBy).toBe(USER_ID);
  });

  it('writes a new version only for sections whose content hash changed', async () => {
    const insertedVersions: unknown[] = [];

    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn().mockImplementation(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            ...mockInsertChain(insertedVersions),
            // Existing (non-legacy) sessions already have baseline version rows,
            // so the legacy-backfill check returns a row and skips the baseline insert.
            select: vi.fn().mockReturnValue({
              from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue([{ version: 2, content: 'Text B' }]),
                }),
              }),
            }),
          };
          return fn(tx);
        }),
    }));

    const logAuditSpy = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/legal/audit', () => ({
      logAudit: logAuditSpy,
    }));
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
    }));

    const { persistSectionChanges } = await import('@/lib/section-versions');

    const previous = [
      {
        id: 'context', title: 'Context', content: 'Text A', order: 1,
        source: 'generated' as const,
        state: 'approved' as const, currentVersion: 3, versionCount: 3,
        contentHash: hash('Text A'),
        lastStateChangeAt: '2026-04-05T00:00:00Z', lastStateChangeBy: USER_ID,
        metadata: { model: 'gpt-5.4', provider: 'openai', tokensIn: 100, tokensOut: 50, latencyMs: 200, retryCount: 0, fallbackUsed: false, generatedAt: '2026-04-05T00:00:00Z', checksum: 'abc' },
      },
      {
        id: 'obiective', title: 'Obiective', content: 'Text B', order: 2,
        source: 'generated' as const,
        state: 'reviewed' as const, currentVersion: 2, versionCount: 2,
        contentHash: hash('Text B'),
        lastStateChangeAt: '2026-04-05T00:00:00Z', lastStateChangeBy: USER_ID,
        metadata: { model: 'gpt-5.4', provider: 'openai', tokensIn: 80, tokensOut: 40, latencyMs: 180, retryCount: 0, fallbackUsed: false, generatedAt: '2026-04-05T00:00:00Z', checksum: 'def' },
      },
    ];

    // New: obiective content changes, context unchanged
    const newSections = [
      { ...previous[0] }, // unchanged
      { ...previous[1], content: 'Text B modified' },
    ];

    const enriched = await persistSectionChanges({
      sessionId: SESSION_ID,
      userId: USER_ID,
      previousSections: previous,
      newSections,
      reason: 'user refined objectives',
    });

    // Only one insert (for obiective)
    expect(insertedVersions).toHaveLength(1);
    // Context unchanged — all fields preserved
    expect(enriched[0].state).toBe('approved');
    expect(enriched[0].currentVersion).toBe(3);
    expect(enriched[0].versionCount).toBe(3);
    // Obiective changed — state reset, version bumped
    expect(enriched[1].state).toBe('draft');
    expect(enriched[1].currentVersion).toBe(3);
    expect(enriched[1].versionCount).toBe(3);
    expect(enriched[1].contentHash).toBe(hash('Text B modified'));

    // Only the changed section should trigger an audit entry
    expect(logAuditSpy).toHaveBeenCalledTimes(1);
    const auditCall = logAuditSpy.mock.calls[0][0];
    expect(auditCall.action).toBe('section.regenerated');
    expect(auditCall.metadata).toMatchObject({
      sectionId: 'obiective',
      toVersion: 3,
    });
  });

  it('writes a new version when title changes even if content is unchanged', async () => {
    const insertedVersions: unknown[] = [];

    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn().mockImplementation(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            ...mockInsertChain(insertedVersions),
            select: vi.fn().mockReturnValue({
              from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue([{ version: 1, content: 'Same text' }]),
                }),
              }),
            }),
          };
          return fn(tx);
        }),
    }));

    vi.doMock('@/lib/legal/audit', () => ({
      logAudit: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
    }));

    const { persistSectionChanges } = await import('@/lib/section-versions');

    const previous = [{
      id: 'context', title: 'Old title', content: 'Same text', order: 1,
      source: 'generated' as const,
      state: 'approved' as const, currentVersion: 1, versionCount: 1,
      contentHash: hash('Same text'),
      lastStateChangeAt: '2026-04-05T00:00:00Z', lastStateChangeBy: USER_ID,
      metadata: { model: 'gpt-5.4', provider: 'openai', tokensIn: 100, tokensOut: 50, latencyMs: 200, retryCount: 0, fallbackUsed: false, generatedAt: '2026-04-05T00:00:00Z', checksum: 'abc' },
    }];

    const newSections = [{ ...previous[0], title: 'New title' }];

    const enriched = await persistSectionChanges({
      sessionId: SESSION_ID,
      userId: USER_ID,
      previousSections: previous,
      newSections,
      reason: 'rename section',
    });

    expect(insertedVersions).toHaveLength(1);
    expect((insertedVersions[0] as { title: string }).title).toBe('New title');
    expect(enriched[0].currentVersion).toBe(2);
    expect(enriched[0].versionCount).toBe(2);
    expect(enriched[0].state).toBe('draft');
  });

  it('preserves prior metadata when only metadata changes', async () => {
    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn().mockImplementation(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) => {
          const tx = mockInsertChain([]);
          return fn(tx);
        }),
    }));

    vi.doMock('@/lib/legal/audit', () => ({
      logAudit: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
    }));

    const { persistSectionChanges } = await import('@/lib/section-versions');

    const previous = [{
      id: 'context', title: 'Context', content: 'Same text', order: 1,
      source: 'generated' as const,
      state: 'approved' as const, currentVersion: 2, versionCount: 2,
      contentHash: hash('Same text'),
      lastStateChangeAt: '2026-04-05T00:00:00Z', lastStateChangeBy: USER_ID,
      metadata: { model: 'old-model', provider: 'openai', tokensIn: 100, tokensOut: 50, latencyMs: 200, retryCount: 0, fallbackUsed: false, generatedAt: '2026-04-05T00:00:00Z', checksum: 'abc' },
    }];

    const newSections = [{
      ...previous[0],
      metadata: { ...previous[0].metadata, generatedAt: '2026-04-06T00:00:00Z', latencyMs: 999 },
    }];

    const enriched = await persistSectionChanges({
      sessionId: SESSION_ID,
      userId: USER_ID,
      previousSections: previous,
      newSections,
      reason: 'metadata drift only',
    });

    expect(enriched[0].currentVersion).toBe(2);
    expect(enriched[0].versionCount).toBe(2);
    expect(enriched[0].metadata).toEqual(previous[0].metadata);
  });
});

describe('transitionSectionState', () => {
  const SECTION = {
    id: 'context', title: 'Context', content: 'Text', order: 1,
    source: 'generated' as const,
    state: 'draft' as const, currentVersion: 2, versionCount: 2,
    contentHash: hash('Text'),
    lastStateChangeAt: '2026-04-05T00:00:00Z', lastStateChangeBy: USER_ID,
    metadata: { model: 'gpt-5.4', provider: 'openai', tokensIn: 100, tokensOut: 50, latencyMs: 200, retryCount: 0, fallbackUsed: false, generatedAt: '2026-04-05T00:00:00Z', checksum: 'abc' },
  };

  function mockSessionWithSection(section: Omit<typeof SECTION, 'state' | 'source'> & { state: 'draft' | 'reviewed' | 'approved'; source: 'generated' | 'edited' | 'failed' }) {
    return {
      id: SESSION_ID,
      userId: USER_ID,
      context: { projectSections: [section] },
    };
  }

  beforeEach(() => {
    vi.resetModules();
  });

  it('allows draft → reviewed', async () => {
    const session = mockSessionWithSection(SECTION);
    const updates: unknown[] = [];

    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn().mockImplementation(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) => fn({
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([session]), for: vi.fn().mockResolvedValue([session]) }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockImplementation((row: unknown) => {
              updates.push(row);
              return { where: vi.fn().mockResolvedValue(undefined) };
            }),
          }),
        })),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }));

    const { transitionSectionState } = await import('@/lib/section-versions');

    const result = await transitionSectionState({
      sessionId: SESSION_ID,
      sectionId: 'context',
      toState: 'reviewed',
      expectedCurrentVersion: 2,
      userId: USER_ID,
    });

    expect(result.state).toBe('reviewed');
    expect(updates).toHaveLength(1);
  });

  it('allows draft → approved (shortcut) and tags audit with reviewSkipped', async () => {
    const session = mockSessionWithSection(SECTION);
    const auditCalls: unknown[] = [];

    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn().mockImplementation(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) => fn({
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([session]), for: vi.fn().mockResolvedValue([session]) }),
            }),
          }),
          update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
        })),
    }));
    vi.doMock('@/lib/legal/audit', () => ({
      logAudit: vi.fn().mockImplementation(async (entry: unknown) => { auditCalls.push(entry); }),
    }));
    vi.doMock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }));

    const { transitionSectionState } = await import('@/lib/section-versions');

    await transitionSectionState({
      sessionId: SESSION_ID,
      sectionId: 'context',
      toState: 'approved',
      expectedCurrentVersion: 2,
      userId: USER_ID,
    });

    expect(auditCalls).toHaveLength(1);
    const metadata = (auditCalls[0] as { metadata: { reviewSkipped?: boolean } }).metadata;
    expect(metadata.reviewSkipped).toBe(true);
  });

  it('rejects approved → reviewed as InvalidStateTransition', async () => {
    const section = { ...SECTION, state: 'approved' as const };
    const session = mockSessionWithSection(section);

    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn().mockImplementation(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) => fn({
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([session]), for: vi.fn().mockResolvedValue([session]) }),
            }),
          }),
          update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
        })),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }));

    const { transitionSectionState, SectionVersionError } = await import('@/lib/section-versions');

    await expect(transitionSectionState({
      sessionId: SESSION_ID,
      sectionId: 'context',
      toState: 'reviewed',
      expectedCurrentVersion: 2,
      userId: USER_ID,
    })).rejects.toSatisfy((err) => err instanceof SectionVersionError && err.code === 'InvalidStateTransition');
  });

  it('rejects state transition on failed-source sections', async () => {
    const section = { ...SECTION, source: 'failed' as const };
    const session = mockSessionWithSection(section);

    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn().mockImplementation(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) => fn({
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([session]), for: vi.fn().mockResolvedValue([session]) }),
            }),
          }),
          update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
        })),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }));

    const { transitionSectionState, SectionVersionError } = await import('@/lib/section-versions');

    await expect(transitionSectionState({
      sessionId: SESSION_ID,
      sectionId: 'context',
      toState: 'approved',
      expectedCurrentVersion: 2,
      userId: USER_ID,
    })).rejects.toSatisfy((err) => err instanceof SectionVersionError && err.code === 'FailedSectionCannotBeApproved');
  });

  it('rejects stale expectedCurrentVersion with ConcurrentModification', async () => {
    const session = mockSessionWithSection(SECTION);

    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn().mockImplementation(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) => fn({
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([session]), for: vi.fn().mockResolvedValue([session]) }),
            }),
          }),
          update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
        })),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }));

    const { transitionSectionState, SectionVersionError } = await import('@/lib/section-versions');

    await expect(transitionSectionState({
      sessionId: SESSION_ID,
      sectionId: 'context',
      toState: 'reviewed',
      expectedCurrentVersion: 1, // stale — actual is 2
      userId: USER_ID,
    })).rejects.toSatisfy((err) => err instanceof SectionVersionError && err.code === 'ConcurrentModification');
  });
});

describe('rollbackSection', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('copies target version content into new version N+1 and resets state to draft', async () => {
    const SECTION = {
      id: 'context', title: 'Context', content: 'v3 content', order: 1,
      source: 'generated' as const,
      state: 'approved' as const, currentVersion: 3, versionCount: 3,
      contentHash: hash('v3 content'),
      lastStateChangeAt: '2026-04-05T00:00:00Z', lastStateChangeBy: USER_ID,
      metadata: { model: 'gpt-5.4', provider: 'openai', tokensIn: 100, tokensOut: 50, latencyMs: 200, retryCount: 0, fallbackUsed: false, generatedAt: '2026-04-05T00:00:00Z', checksum: 'abc' },
    };
    const session = { id: SESSION_ID, userId: USER_ID, context: { projectSections: [SECTION] } };
    const targetVersionRow = { version: 1, content: 'v1 content', title: 'Context', metadata: SECTION.metadata };
    const insertedVersions: unknown[] = [];

    const drizzleNameSym = Symbol.for('drizzle:Name');
    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn().mockImplementation(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) => fn({
          select: vi.fn().mockImplementation(() => ({
            from: vi.fn().mockImplementation((table: unknown) => ({
              where: vi.fn().mockImplementation(() => ({
                limit: vi.fn().mockResolvedValue(
                  (table as Record<symbol, string>)[drizzleNameSym] === 'section_versions' ? [targetVersionRow] : [session],
                ),
                for: vi.fn().mockResolvedValue([session]),
              })),
            })),
          })),
          insert: vi.fn().mockImplementation(() => ({
            values: vi.fn().mockImplementation((row: unknown) => {
              insertedVersions.push(row);
              return { returning: vi.fn().mockResolvedValue([row]) };
            }),
          })),
          update: vi.fn().mockImplementation(() => ({
            set: vi.fn().mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
          })),
        })),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }));

    const { rollbackSection } = await import('@/lib/section-versions');

    const result = await rollbackSection({
      sessionId: SESSION_ID,
      sectionId: 'context',
      targetVersion: 1,
      expectedCurrentVersion: 3,
      userId: USER_ID,
      reason: 'test rollback',
    });

    expect(result.content).toBe('v1 content');
    expect(result.currentVersion).toBe(4);
    expect(result.state).toBe('draft');
    expect(insertedVersions).toHaveLength(1);
  });

  it('returns section unchanged when rolling back to current version (idempotent no-op)', async () => {
    const SECTION = {
      id: 'context', title: 'Context', content: 'v3 content', order: 1,
      source: 'generated' as const,
      state: 'approved' as const, currentVersion: 3, versionCount: 3,
      contentHash: hash('v3 content'),
      lastStateChangeAt: '2026-04-05T00:00:00Z', lastStateChangeBy: USER_ID,
      metadata: { model: 'gpt-5.4', provider: 'openai', tokensIn: 100, tokensOut: 50, latencyMs: 200, retryCount: 0, fallbackUsed: false, generatedAt: '2026-04-05T00:00:00Z', checksum: 'abc' },
    };
    const session = { id: SESSION_ID, userId: USER_ID, context: { projectSections: [SECTION] } };
    const insertedVersions: unknown[] = [];
    const auditLogSpy = vi.fn().mockResolvedValue(undefined);

    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn().mockImplementation(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) => fn({
          select: vi.fn().mockImplementation(() => ({
            from: vi.fn().mockImplementation(() => ({
              where: vi.fn().mockImplementation(() => ({
                limit: vi.fn().mockResolvedValue([session]),
                for: vi.fn().mockResolvedValue([session]),
              })),
            })),
          })),
          insert: vi.fn().mockImplementation(() => ({
            values: vi.fn().mockImplementation((row: unknown) => {
              insertedVersions.push(row);
              return { returning: vi.fn().mockResolvedValue([row]) };
            }),
          })),
          update: vi.fn().mockImplementation(() => ({
            set: vi.fn().mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
          })),
        })),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: auditLogSpy }));
    vi.doMock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }));

    const { rollbackSection } = await import('@/lib/section-versions');

    const result = await rollbackSection({
      sessionId: SESSION_ID,
      sectionId: 'context',
      targetVersion: 3, // same as current
      expectedCurrentVersion: 3,
      userId: USER_ID,
      reason: 'misclick',
    });

    // State preserved — approved remains approved
    expect(result.state).toBe('approved');
    expect(result.currentVersion).toBe(3);
    expect(result.versionCount).toBe(3);
    // No DB writes: no version inserted, no audit entry
    expect(insertedVersions).toHaveLength(0);
    expect(auditLogSpy).not.toHaveBeenCalled();
  });
});

describe('getVersionHistory', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns version rows with createdBy and reason', async () => {
    const fullMetadata = {
      model: 'gpt-5.4', provider: 'openai', tokensIn: 100, tokensOut: 50,
      latencyMs: 200, retryCount: 2, fallbackUsed: false,
      generatedAt: '2026-04-05T00:00:00Z', checksum: 'deadbeef',
    };
    const versionRows = [
      { id: 'v1-id', version: 1, content: 'v1', contentHash: hash('v1'), title: 'T', metadata: fullMetadata, reason: 'initial_generation', createdAt: new Date('2026-04-05T00:00:00Z'), createdBy: USER_ID },
      { id: 'v2-id', version: 2, content: 'v2', contentHash: hash('v2'), title: 'T', metadata: fullMetadata, reason: 'user refined', createdAt: new Date('2026-04-05T01:00:00Z'), createdBy: USER_ID },
    ];
    const auditRows = [
      { id: 'a1', action: 'section.state_change', resourceId: SESSION_ID, userId: USER_ID, createdAt: new Date('2026-04-05T00:30:00Z'), newValue: null, oldValue: null, metadata: { sectionId: 'context', fromState: 'draft', toState: 'reviewed', currentVersion: 1 } },
    ];

    // Use reference equality on imported table objects to discriminate (see T7 review m3).
    // Drizzle table objects are module-level singletons, so `from(sectionVersions)` passes the
    // same reference that tests can import. This is cleaner than Symbol.for('drizzle:Name').
    const { sectionVersions: sectionVersionsTable, auditLog: auditLogTable } = await import('@/lib/db/schema');

    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: Function) => {
        const tx = {
          select: vi.fn().mockImplementation(() => ({
            from: vi.fn().mockImplementation((table: unknown) => ({
              where: vi.fn().mockImplementation(() => ({
                orderBy: vi.fn().mockResolvedValue(
                  table === sectionVersionsTable ? versionRows : auditRows,
                ),
              })),
            })),
          })),
        };
        return fn(tx);
      }),
    }));
    vi.doMock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }));

    const { getVersionHistory } = await import('@/lib/section-versions');

    const result = await getVersionHistory(SESSION_ID, 'context', USER_ID);

    expect(result.versions).toHaveLength(2);
    expect(result.versions[0].version).toBe(1);
    expect(result.versions[1].version).toBe(2);
    expect(result.stateTransitions).toHaveLength(1);
    expect(result.stateTransitions[0].fromState).toBe('draft');
    expect(result.stateTransitions[0].toState).toBe('reviewed');

    // Verify the projection strips internal metadata fields
    expect(result.versions[0].metadata).not.toHaveProperty('retryCount');
    expect(result.versions[0].metadata).not.toHaveProperty('checksum');
    expect(result.versions[0].metadata.model).toBe('gpt-5.4');
    expect(result.versions[0].metadata.provider).toBe('openai');
    expect(result.versions[0].metadata.fallbackUsed).toBe(false);
  });
});

describe('persistSectionChanges legacy backfill', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('writes baseline v1 + new vN+1 when previous section has currentVersion=1 but no section_versions row exists', async () => {
    const insertedVersions: unknown[] = [];

    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn().mockImplementation(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            insert: vi.fn().mockReturnValue({
              values: vi.fn().mockImplementation((row: unknown) => {
                insertedVersions.push(row);
                return { returning: vi.fn().mockResolvedValue([row]) };
              }),
            }),
            select: vi.fn().mockReturnValue({
              from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue([]), // no existing version rows
                }),
              }),
            }),
          };
          return fn(tx);
        }),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }));

    const { persistSectionChanges } = await import('@/lib/section-versions');

    // Legacy section: has defaults from in-memory backfill but no version row in DB
    const legacySection = {
      id: 'context', title: 'Context', content: 'legacy content', order: 1,
      source: 'generated' as const,
      state: 'draft' as const, currentVersion: 1, versionCount: 1,
      contentHash: '',  // simulate pre-T2-I1 corrupt hash
      lastStateChangeAt: '2026-04-05T00:00:00Z', lastStateChangeBy: USER_ID,
      metadata: { model: 'gpt-5.4', provider: 'openai', tokensIn: 100, tokensOut: 50, latencyMs: 200, retryCount: 0, fallbackUsed: false, generatedAt: '2026-04-05T00:00:00Z', checksum: 'abc' },
    };

    // Regenerate with new content
    const newSection = { ...legacySection, content: 'new content' };

    const enriched = await persistSectionChanges({
      sessionId: SESSION_ID,
      userId: USER_ID,
      previousSections: [legacySection],
      newSections: [newSection],
      reason: 'user regenerated',
    });

    // Two inserts: baseline v1 (legacy content) + v2 (new content)
    expect(insertedVersions).toHaveLength(2);
    expect((insertedVersions[0] as { version: number }).version).toBe(1);
    expect((insertedVersions[0] as { content: string }).content).toBe('legacy content');
    expect((insertedVersions[1] as { version: number }).version).toBe(2);
    expect((insertedVersions[1] as { content: string }).content).toBe('new content');

    // Baseline row must have a real hash, not the empty placeholder from
    // the legacy session's corrupt contentHash
    expect((insertedVersions[0] as { contentHash: string }).contentHash).toBe(hash('legacy content'));
    expect((insertedVersions[0] as { contentHash: string }).contentHash).not.toBe('');

    expect(enriched[0].currentVersion).toBe(2);
    expect(enriched[0].versionCount).toBe(2);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

describe('verifySectionIntegrity', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('detects JSONB contentHash mismatch vs latest version row', async () => {
    const driftedSection = {
      id: 'context', title: 'Context', content: 'REAL content', order: 1,
      source: 'generated' as const,
      state: 'approved' as const, currentVersion: 2, versionCount: 2,
      contentHash: hash('DRIFTED content'), // intentionally wrong (mismatches the version row)
      lastStateChangeAt: '2026-04-05T00:00:00Z', lastStateChangeBy: USER_ID,
      metadata: {},
    };

    vi.doMock('@/lib/db', () => ({
      db: {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockResolvedValue([
                { version: 2, contentHash: hash('REAL content'), content: 'REAL content' },
              ]),
            })),
          })),
        })),
      },
    }));
    vi.doMock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }) } }));

    const { verifySectionIntegrity, SectionVersionError } = await import('@/lib/ai/orchestrator/section-versions');

    await expect(verifySectionIntegrity(SESSION_ID, driftedSection as any))
      .rejects.toSatisfy((err: unknown) => err instanceof SectionVersionError && (err as InstanceType<typeof SectionVersionError>).code === 'VersionIntegrityMismatch');
  });

  it('passes when JSONB contentHash matches the latest version row', async () => {
    const okSection = {
      id: 'context', title: 'Context', content: 'REAL content', order: 1,
      source: 'generated' as const,
      state: 'approved' as const, currentVersion: 2, versionCount: 2,
      contentHash: hash('REAL content'),
      lastStateChangeAt: '2026-04-05T00:00:00Z', lastStateChangeBy: USER_ID,
      metadata: {},
    };

    vi.doMock('@/lib/db', () => ({
      db: {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockResolvedValue([
                { version: 2, contentHash: hash('REAL content'), content: 'REAL content' },
              ]),
            })),
          })),
        })),
      },
    }));
    vi.doMock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }) } }));

    const { verifySectionIntegrity } = await import('@/lib/ai/orchestrator/section-versions');

    await expect(verifySectionIntegrity(SESSION_ID, okSection as any)).resolves.toBeUndefined();
  });

  it('passes when no version row exists yet (legacy session, backfill handles it)', async () => {
    // A legacy section with in-memory defaults but no DB rows should not trip
    // the integrity check. The backfill path in persistSectionChanges will
    // insert the baseline row on the next mutation.
    const legacySection = {
      id: 'context', title: 'Context', content: 'legacy content', order: 1,
      source: 'generated' as const,
      state: 'draft' as const, currentVersion: 1, versionCount: 1,
      contentHash: hash('legacy content'),
      lastStateChangeAt: '2026-04-05T00:00:00Z', lastStateChangeBy: USER_ID,
      metadata: {},
    };

    vi.doMock('@/lib/db', () => ({
      db: {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockResolvedValue([]), // no rows
            })),
          })),
        })),
      },
    }));
    vi.doMock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }) } }));

    const { verifySectionIntegrity } = await import('@/lib/ai/orchestrator/section-versions');

    await expect(verifySectionIntegrity(SESSION_ID, legacySection as any)).resolves.toBeUndefined();
  });
});

import { createHash } from 'crypto';
import { db } from '@/lib/db';
import { sectionVersions } from '@/lib/db/schema';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';
import type { SectionResult } from './types';

const log = logger.child({ component: 'section-versions' });

export interface PersistOptions {
  sessionId: string;
  userId: string;
  previousSections: SectionResult[] | null;
  newSections: SectionResult[];
  reason: string;
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Detects content changes by comparing SHA-256 hashes, inserts version rows
 * only for changed sections, and returns the new sections enriched with
 * state/version/hash fields.
 *
 * Audit entries are collected inside the transaction and emitted after it
 * commits. This matches the codebase idiom (see consent/bulk/route.ts and
 * organizations/route.ts) and avoids three concrete bugs that occur when
 * logAudit is called from inside db.transaction():
 *   1. Orphan audit entries (audit commits on its own connection, outer tx
 *      rollback leaves the audit entry behind)
 *   2. Pool exhaustion (each logAudit checks out a second connection)
 *   3. Hash chain forks (two concurrent transactions read the same "latest"
 *      entry and link to it)
 *
 * Tradeoff: an audit write failure after a successful version row insert no
 * longer rolls back the version row. The audit module's DLQ fallback and
 * verifyAuditChainIntegrity post-hoc check cover this residual risk.
 */
export async function persistSectionChanges(opts: PersistOptions): Promise<SectionResult[]> {
  const { sessionId, userId, previousSections, newSections, reason } = opts;
  // Single timestamp per batch: all sections persisted together share a state-change moment.
  const now = new Date().toISOString();
  const previousById = new Map<string, SectionResult>(
    (previousSections ?? []).map((s) => [s.id, s]),
  );

  // Collected inside the transaction, emitted after commit.
  const pendingAudits: Array<Parameters<typeof logAudit>[0]> = [];

  const enriched = await db.transaction(async (tx) => {
    const result: SectionResult[] = [];

    for (const next of newSections) {
      const prev = previousById.get(next.id);
      const newHash = hashContent(next.content);

      if (!prev) {
        // Initial generation — v1
        await tx.insert(sectionVersions).values({
          sessionId,
          sectionId: next.id,
          version: 1,
          content: next.content,
          contentHash: newHash,
          title: next.title,
          metadata: next.metadata,
          reason,
          createdBy: userId,
        });

        pendingAudits.push({
          userId,
          action: 'section.generated',
          resourceType: 'workflow_session',
          resourceId: sessionId,
          metadata: { sectionId: next.id, version: 1, contentHash: newHash, model: next.metadata.model, provider: next.metadata.provider },
        });

        result.push({
          ...next,
          state: 'draft',
          currentVersion: 1,
          versionCount: 1,
          contentHash: newHash,
          lastStateChangeAt: now,
          lastStateChangeBy: userId,
        });
        continue;
      }

      if (prev.contentHash === newHash) {
        // No change — preserve everything
        result.push({
          ...next,
          state: prev.state,
          currentVersion: prev.currentVersion,
          versionCount: prev.versionCount,
          contentHash: prev.contentHash,
          lastStateChangeAt: prev.lastStateChangeAt,
          lastStateChangeBy: prev.lastStateChangeBy,
        });
        continue;
      }

      // Content changed — new version, reset state to draft
      const newVersion = prev.currentVersion + 1;
      await tx.insert(sectionVersions).values({
        sessionId,
        sectionId: next.id,
        version: newVersion,
        content: next.content,
        contentHash: newHash,
        title: next.title,
        metadata: next.metadata,
        reason,
        createdBy: userId,
      });

      pendingAudits.push({
        userId,
        action: 'section.regenerated',
        resourceType: 'workflow_session',
        resourceId: sessionId,
        metadata: {
          sectionId: next.id,
          fromVersion: prev.currentVersion,
          toVersion: newVersion,
          contentHash: newHash,
          reason,
          previousState: prev.state,
        },
      });

      result.push({
        ...next,
        state: 'draft',
        currentVersion: newVersion,
        versionCount: prev.versionCount + 1,
        contentHash: newHash,
        lastStateChangeAt: now,
        lastStateChangeBy: userId,
      });
    }

    return result;
  });

  // Post-commit audit emission. The outer transaction is closed; audit writes
  // happen on their own connections with their own hash-chain transactions.
  for (const entry of pendingAudits) {
    await logAudit(entry);
  }

  log.info({ sessionId, sectionsProcessed: enriched.length, auditsEmitted: pendingAudits.length }, 'persistSectionChanges done');
  return enriched;
}

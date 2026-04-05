import { createHash } from 'crypto';
import { db } from '@/lib/db';
import { sectionVersions, workflowSessions } from '@/lib/db/schema';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';
import { and, eq } from 'drizzle-orm';
import type { SectionResult, SectionVersion } from './types';

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
 * state/version/hash fields. Runs inside a DB transaction.
 */
export async function persistSectionChanges(opts: PersistOptions): Promise<SectionResult[]> {
  const { sessionId, userId, previousSections, newSections, reason } = opts;
  const now = new Date().toISOString();
  const previousById = new Map<string, SectionResult>(
    (previousSections ?? []).map((s) => [s.id, s]),
  );

  return db.transaction(async (tx) => {
    const enriched: SectionResult[] = [];

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

        await logAudit({
          userId,
          action: 'section.generated',
          resourceType: 'workflow_session',
          resourceId: sessionId,
          metadata: { sectionId: next.id, version: 1, contentHash: newHash, model: next.metadata.model, provider: next.metadata.provider },
        });

        enriched.push({
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
        enriched.push({
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

      await logAudit({
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

      enriched.push({
        ...next,
        state: 'draft',
        currentVersion: newVersion,
        versionCount: prev.versionCount + 1,
        contentHash: newHash,
        lastStateChangeAt: now,
        lastStateChangeBy: userId,
      });
    }

    log.info({ sessionId, sections: enriched.length }, 'persistSectionChanges done');
    return enriched;
  });
}

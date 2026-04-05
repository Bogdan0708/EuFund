import { createHash } from 'crypto';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { sectionVersions, workflowSessions, auditLog } from '@/lib/db/schema';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';
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

      // Content changed — check if this is a legacy section without any version rows yet
      const [existingRow] = await tx
        .select()
        .from(sectionVersions)
        .where(and(
          eq(sectionVersions.sessionId, sessionId),
          eq(sectionVersions.sectionId, next.id),
          eq(sectionVersions.version, prev.currentVersion),
        ))
        .limit(1);

      if (!existingRow) {
        // Recompute from content — pre-T2-I1 sessions may have contentHash=''
        // and Task 14's integrity check compares hashes without recomputing,
        // so a corrupt baseline with empty hash would never be caught.
        const baselineHash = hashContent(prev.content);

        // Legacy backfill: insert baseline v{prev.currentVersion} with the OLD content
        await tx.insert(sectionVersions).values({
          sessionId,
          sectionId: next.id,
          version: prev.currentVersion,
          content: prev.content,
          contentHash: baselineHash,
          title: prev.title,
          metadata: prev.metadata,
          reason: 'legacy_backfill',
          createdBy: userId,
        });

        pendingAudits.push({
          userId,
          action: 'section.generated',
          resourceType: 'workflow_session',
          resourceId: sessionId,
          metadata: {
            sectionId: next.id,
            version: prev.currentVersion,
            contentHash: baselineHash,
            legacyBackfill: true,
          },
        });
      }

      // New version, reset state to draft
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

export type SectionVersionErrorCode =
  | 'SectionNotFound'
  | 'VersionNotFound'
  | 'InvalidStateTransition'
  | 'FailedSectionCannotBeApproved'
  | 'ConcurrentModification'
  | 'VersionIntegrityMismatch';

export class SectionVersionError extends Error {
  constructor(public code: SectionVersionErrorCode, message: string, public details?: Record<string, unknown>) {
    super(message);
    this.name = 'SectionVersionError';
  }
}

type State = 'draft' | 'reviewed' | 'approved';

const ALLOWED_TRANSITIONS: Record<State, State[]> = {
  draft: ['reviewed', 'approved'],
  reviewed: ['approved', 'draft'],
  approved: ['draft'],
};

export async function transitionSectionState(opts: {
  sessionId: string;
  sectionId: string;
  toState: State;
  expectedCurrentVersion: number;
  userId: string;
  reason?: string;
}): Promise<SectionResult> {
  const { sessionId, sectionId, toState, expectedCurrentVersion, userId, reason } = opts;

  // Collected inside the transaction, emitted post-commit (same pattern as persistSectionChanges)
  let pendingAudit: Parameters<typeof logAudit>[0] | null = null;

  const updatedSection = await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(workflowSessions)
      .where(eq(workflowSessions.id, sessionId))
      .for('update');

    if (!session) {
      throw new SectionVersionError('SectionNotFound', `Session ${sessionId} not found`);
    }

    const ctx = session.context as { projectSections?: SectionResult[] };
    const sections = ctx.projectSections ?? [];
    const idx = sections.findIndex((s) => s.id === sectionId);
    if (idx < 0) {
      throw new SectionVersionError('SectionNotFound', `Section ${sectionId} not found in session ${sessionId}`);
    }

    const section = sections[idx];

    // Optimistic lock
    if (section.currentVersion !== expectedCurrentVersion) {
      throw new SectionVersionError(
        'ConcurrentModification',
        `Section ${sectionId} has been modified since the client read`,
        { currentVersion: section.currentVersion },
      );
    }

    // Failed section guard
    if (section.source === 'failed' && (toState === 'reviewed' || toState === 'approved')) {
      throw new SectionVersionError(
        'FailedSectionCannotBeApproved',
        `Section ${sectionId} current version is in 'failed' state and cannot be approved`,
      );
    }

    // Idempotent no-op
    if (section.state === toState) {
      return section;
    }

    // Validate transition
    const allowed = ALLOWED_TRANSITIONS[section.state];
    if (!allowed.includes(toState)) {
      throw new SectionVersionError(
        'InvalidStateTransition',
        `Cannot transition section ${sectionId} from ${section.state} to ${toState}`,
      );
    }

    const reviewSkipped = section.state === 'draft' && toState === 'approved';
    const now = new Date().toISOString();
    const updated: SectionResult = {
      ...section,
      state: toState,
      lastStateChangeAt: now,
      lastStateChangeBy: userId,
    };

    const updatedSections = [...sections];
    updatedSections[idx] = updated;

    await tx
      .update(workflowSessions)
      .set({
        context: { ...ctx, projectSections: updatedSections },
        updatedAt: new Date(),
      })
      .where(eq(workflowSessions.id, sessionId));

    pendingAudit = {
      userId,
      action: 'section.state_change',
      resourceType: 'workflow_session',
      resourceId: sessionId,
      metadata: {
        sectionId,
        currentVersion: section.currentVersion,
        fromState: section.state,
        toState,
        reason: reason ?? null,
        ...(reviewSkipped ? { reviewSkipped: true } : {}),
      },
    };

    return updated;
  });

  // Post-commit audit emission
  if (pendingAudit) {
    await logAudit(pendingAudit);
  }

  return updatedSection;
}

export async function rollbackSection(opts: {
  sessionId: string;
  sectionId: string;
  targetVersion: number;
  expectedCurrentVersion: number;
  userId: string;
  reason: string;
}): Promise<SectionResult> {
  const { sessionId, sectionId, targetVersion, expectedCurrentVersion, userId, reason } = opts;
  const now = new Date().toISOString();

  // Collected inside the transaction, emitted post-commit (same pattern as persistSectionChanges + transitionSectionState)
  let pendingAudit: Parameters<typeof logAudit>[0] | null = null;

  const updatedSection = await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(workflowSessions)
      .where(eq(workflowSessions.id, sessionId))
      .for('update');

    if (!session) {
      throw new SectionVersionError('SectionNotFound', `Session ${sessionId} not found`);
    }

    const ctx = session.context as { projectSections?: SectionResult[] };
    const sections = ctx.projectSections ?? [];
    const idx = sections.findIndex((s) => s.id === sectionId);
    if (idx < 0) {
      throw new SectionVersionError('SectionNotFound', `Section ${sectionId} not found in session ${sessionId}`);
    }

    const section = sections[idx];

    if (section.currentVersion !== expectedCurrentVersion) {
      throw new SectionVersionError(
        'ConcurrentModification',
        `Section ${sectionId} has been modified since the client read`,
        { currentVersion: section.currentVersion },
      );
    }

    // Idempotent no-op: rolling back to the current version is a UX misclick.
    // Returning the section unchanged preserves state (e.g., avoids demoting
    // an already-approved section to draft). Matches the same-state no-op
    // pattern in transitionSectionState.
    if (targetVersion === section.currentVersion) {
      return section;
    }

    // Fetch target version row
    const [target] = await tx
      .select()
      .from(sectionVersions)
      .where(and(
        eq(sectionVersions.sessionId, sessionId),
        eq(sectionVersions.sectionId, sectionId),
        eq(sectionVersions.version, targetVersion),
      ))
      .limit(1);

    if (!target) {
      throw new SectionVersionError('VersionNotFound', `Section ${sectionId} has no version ${targetVersion}`);
    }

    // Insert new version with target's content
    const newVersion = section.currentVersion + 1;
    const newContentHash = hashContent(target.content);

    await tx.insert(sectionVersions).values({
      sessionId,
      sectionId,
      version: newVersion,
      content: target.content,
      contentHash: newContentHash,
      title: target.title,
      metadata: target.metadata,
      reason,
      createdBy: userId,
    });

    const updated: SectionResult = {
      ...section,
      content: target.content,
      contentHash: newContentHash,
      currentVersion: newVersion,
      versionCount: section.versionCount + 1,
      state: 'draft',
      lastStateChangeAt: now,
      lastStateChangeBy: userId,
      title: target.title,
    };

    const updatedSections = [...sections];
    updatedSections[idx] = updated;

    await tx
      .update(workflowSessions)
      .set({
        context: { ...ctx, projectSections: updatedSections },
        updatedAt: new Date(),
      })
      .where(eq(workflowSessions.id, sessionId));

    pendingAudit = {
      userId,
      action: 'section.rollback',
      resourceType: 'workflow_session',
      resourceId: sessionId,
      metadata: {
        sectionId,
        rolledBackFromVersion: section.currentVersion,
        rolledBackToVersion: targetVersion,
        newVersion,
        reason,
      },
    };

    return updated;
  });

  // Post-commit audit emission
  if (pendingAudit) {
    await logAudit(pendingAudit);
  }

  return updatedSection;
}

export interface StateTransitionEntry {
  timestamp: string;
  userId: string;
  currentVersion: number;
  fromState: State;
  toState: State;
  reason: string | null;
  reviewSkipped: boolean;
}

export interface VersionHistoryResult {
  versions: SectionVersion[];
  stateTransitions: StateTransitionEntry[];
}

export async function getVersionHistory(
  sessionId: string,
  sectionId: string,
): Promise<VersionHistoryResult> {
  const versionRows = await db
    .select()
    .from(sectionVersions)
    .where(and(
      eq(sectionVersions.sessionId, sessionId),
      eq(sectionVersions.sectionId, sectionId),
    ))
    .orderBy(asc(sectionVersions.version));

  const versions: SectionVersion[] = versionRows.map((row) => {
    const dbMeta = row.metadata as SectionResult['metadata'];
    return {
      id: row.id,
      version: row.version,
      content: row.content,
      contentHash: row.contentHash,
      title: row.title,
      metadata: {
        model: dbMeta.model,
        provider: dbMeta.provider,
        tokensIn: dbMeta.tokensIn,
        tokensOut: dbMeta.tokensOut,
        latencyMs: dbMeta.latencyMs,
        fallbackUsed: dbMeta.fallbackUsed,
        generatedAt: dbMeta.generatedAt,
      },
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy,
    };
  });

  // Fetch audit entries for this section's state changes
  const auditRows = await db
    .select()
    .from(auditLog)
    .where(and(
      eq(auditLog.action, 'section.state_change'),
      eq(auditLog.resourceId, sessionId),
    ))
    .orderBy(asc(auditLog.createdAt));

  const stateTransitions: StateTransitionEntry[] = auditRows
    .filter((row) => {
      const metadata = row.metadata as { sectionId?: string } | null;
      return metadata?.sectionId === sectionId;
    })
    .map((row) => {
      const metadata = row.metadata as {
        sectionId: string;
        currentVersion: number;
        fromState: State;
        toState: State;
        reason: string | null;
        reviewSkipped?: boolean;
      };
      return {
        // auditLog.createdAt is nullable in schema (defaultNow only) but in
        // practice every row has a server-side timestamp — empty string fallback
        // is defensive and type-safe.
        timestamp: row.createdAt?.toISOString() ?? '',
        userId: row.userId ?? '',
        currentVersion: metadata.currentVersion,
        fromState: metadata.fromState,
        toState: metadata.toState,
        reason: metadata.reason,
        reviewSkipped: metadata.reviewSkipped === true,
      };
    });

  return { versions, stateTransitions };
}

/**
 * Verifies that the JSONB read cache (`SectionResult.contentHash`) matches
 * the `content_hash` of the latest `section_versions` row for this section.
 *
 * Called by the state-change and rollback REST endpoints before delegating
 * to `transitionSectionState` / `rollbackSection`. If drift is detected,
 * throws `VersionIntegrityMismatch` — the endpoint then returns 500 and
 * refuses to mutate, per the spec §7.2 recovery procedure ("fail loud,
 * admin reconciliation required").
 *
 * Legacy sessions with no version rows yet are NOT treated as a mismatch.
 * The `persistSectionChanges` lazy backfill path handles those on the next
 * content change (Task 10).
 */
export async function verifySectionIntegrity(
  sessionId: string,
  section: SectionResult,
): Promise<void> {
  const [latest] = await db
    .select()
    .from(sectionVersions)
    .where(and(
      eq(sectionVersions.sessionId, sessionId),
      eq(sectionVersions.sectionId, section.id),
      eq(sectionVersions.version, section.currentVersion),
    ))
    .limit(1);

  if (!latest) {
    // Legacy section, no row yet — not a mismatch, backfill will handle it
    return;
  }

  if (latest.contentHash !== section.contentHash) {
    log.error({
      sessionId,
      sectionId: section.id,
      jsonbHash: section.contentHash,
      versionRowHash: latest.contentHash,
      currentVersion: section.currentVersion,
    }, 'SECTION_VERSION_INTEGRITY_MISMATCH');

    throw new SectionVersionError(
      'VersionIntegrityMismatch',
      `Section ${section.id} contentHash mismatch between JSONB and version row`,
      {
        jsonbHash: section.contentHash,
        versionRowHash: latest.contentHash,
      },
    );
  }
}

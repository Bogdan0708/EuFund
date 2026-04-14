import { and, desc, eq, inArray, isNull, max } from 'drizzle-orm';

import { withUserRLS } from '@/lib/db';
import type { Database } from '@/lib/db';
import { projects, workflowSessions, projectDocuments, sectionVersions } from '@/lib/db/schema';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';

import { persistAndPublishSectionUpdatedEvent } from './pubsub';
import { hashContent, SectionVersionError } from '@/lib/section-versions';
import type { SectionResult } from './types';

type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const log = logger.child({ component: 'workspace' });

/**
 * Fills in missing versioning fields for legacy/incomplete section data.
 * Used when reading from projectDocuments snapshots that predate the versioning system.
 */
export function normalizeSections(
  sections: unknown[],
  fallbackCreatedAt: string,
): SectionResult[] {
  return sections.map((raw) => {
    const s = raw as Record<string, unknown>;
    const content = typeof s.content === 'string' ? s.content : '';
    return {
      id: String(s.id ?? ''),
      title: String(s.title ?? ''),
      content,
      order: typeof s.order === 'number' ? s.order : 0,
      source: (s.source as SectionResult['source']) ?? 'generated',
      state: (s.state as SectionResult['state']) ?? 'draft',
      currentVersion: typeof s.currentVersion === 'number' ? s.currentVersion : 1,
      versionCount: typeof s.versionCount === 'number' ? s.versionCount : 1,
      contentHash: typeof s.contentHash === 'string' && s.contentHash.length > 0
        ? s.contentHash
        : hashContent(content),
      lastStateChangeAt: typeof s.lastStateChangeAt === 'string'
        ? s.lastStateChangeAt
        : fallbackCreatedAt,
      lastStateChangeBy: typeof s.lastStateChangeBy === 'string'
        ? s.lastStateChangeBy
        : null,
      metadata: {
        model: '', provider: '', tokensIn: 0, tokensOut: 0,
        latencyMs: 0, retryCount: 0, fallbackUsed: false,
        generatedAt: fallbackCreatedAt, checksum: '',
        ...(typeof s.metadata === 'object' && s.metadata !== null ? s.metadata as Record<string, unknown> : {}),
      } as SectionResult['metadata'],
    };
  });
}

// ─── Project Workspace Resolution ────────────────────────────────

export interface ProjectWorkspace {
  project: typeof projects.$inferSelect;
  session: typeof workflowSessions.$inferSelect | null;
  snapshotDoc: typeof projectDocuments.$inferSelect | null;
  mode: 'session' | 'snapshot';
  sections: SectionResult[];
}

const QUALIFYING_STATUSES = ['active', 'paused', 'completed'] as const;
const PREFERRED_STATUSES = ['active', 'paused'] as const;

/**
 * Resolves the current workspace for a project: finds the best session (active/paused preferred),
 * falls back to the latest snapshot document, reconciles version drift if needed.
 */
export async function resolveProjectWorkspace(
  projectId: string,
  userId: string,
): Promise<ProjectWorkspace | null> {
  return withUserRLS(userId, async (tx) => {
    const project = await tx.query.projects.findFirst({
      where: and(eq(projects.id, projectId), isNull(projects.deletedAt)),
    });
    if (!project) return null;

    const qualifyingSessions = await tx
      .select()
      .from(workflowSessions)
      .where(and(
        eq(workflowSessions.projectId, projectId),
        eq(workflowSessions.userId, userId),
        inArray(workflowSessions.status, [...QUALIFYING_STATUSES]),
      ))
      .orderBy(desc(workflowSessions.updatedAt));

    const session = qualifyingSessions.find(
      (s) => PREFERRED_STATUSES.includes(s.status as typeof PREFERRED_STATUSES[number]),
    ) ?? qualifyingSessions[0] ?? null;

    const [snapshotDoc] = await tx
      .select()
      .from(projectDocuments)
      .where(eq(projectDocuments.projectId, projectId))
      .orderBy(desc(projectDocuments.version))
      .limit(1);

    if (session) {
      const ctx = session.context as { projectSections?: unknown[] } | null;
      let sections = normalizeSections(ctx?.projectSections ?? [], session.createdAt.toISOString());
      if (sections.length > 0) {
        sections = await reconcileDrift(tx, session.id, sections);
      }
      return { project, session, snapshotDoc: snapshotDoc ?? null, mode: 'session', sections };
    }

    if (snapshotDoc) {
      const rawSections = (snapshotDoc.sections ?? []) as unknown[];
      const sections = normalizeSections(rawSections, snapshotDoc.createdAt.toISOString());
      return { project, session: null, snapshotDoc, mode: 'snapshot', sections };
    }

    return { project, session: null, snapshotDoc: null, mode: 'snapshot', sections: [] };
  });
}

// ─── Drift Reconciliation ────────────────────────────────────────

/**
 * Read-only drift detection: patches in-memory sections with the latest
 * version row data if the session context is stale. Does NOT write back
 * to the session — concurrent reads can no longer corrupt session state.
 * The session context is updated on the next write (editProjectSection).
 *
 * Uses a single batched query instead of N+1 per-section fetches.
 */
async function reconcileDrift(tx: DbTransaction, sessionId: string, sections: SectionResult[]): Promise<SectionResult[]> {
  try {
    const maxVersionRows = await tx
      .select({
        sectionId: sectionVersions.sectionId,
        maxVersion: max(sectionVersions.version).as('max_version'),
      })
      .from(sectionVersions)
      .where(eq(sectionVersions.sessionId, sessionId))
      .groupBy(sectionVersions.sectionId);

    const maxVersionMap = new Map(maxVersionRows.map((r) => [r.sectionId, Number(r.maxVersion)]));
    const drifted = sections.filter((s) => (maxVersionMap.get(s.id) ?? 0) > s.currentVersion);
    if (drifted.length === 0) return sections;

    log.warn(
      { sessionId, driftedSectionIds: drifted.map((s) => s.id) },
      'Section version drift detected (read-only reconciliation)',
    );

    // Batched fetch: all version rows for drifted sections in one query
    const driftedIds = drifted.map((s) => s.id);
    const allRows = await tx
      .select()
      .from(sectionVersions)
      .where(and(
        eq(sectionVersions.sessionId, sessionId),
        inArray(sectionVersions.sectionId, driftedIds),
      ))
      .orderBy(desc(sectionVersions.version));

    // Pick the latest row per sectionId
    const latestBySection = new Map<string, typeof sectionVersions.$inferSelect>();
    for (const row of allRows) {
      if (!latestBySection.has(row.sectionId)) {
        latestBySection.set(row.sectionId, row);
      }
    }

    return sections.map((s) => {
      const patch = latestBySection.get(s.id);
      if (!patch) return s;
      return {
        ...s,
        content: patch.content,
        contentHash: patch.contentHash,
        title: patch.title,
        currentVersion: patch.version,
        versionCount: patch.version,
        state: 'draft' as const,
        source: 'edited' as const,
        lastStateChangeAt: patch.createdAt.toISOString(),
        lastStateChangeBy: patch.createdBy,
      };
    });
  } catch (err) {
    log.error(
      { error: err instanceof Error ? err.message : String(err), sessionId },
      'Drift reconciliation failed, returning original sections',
    );
    return sections;
  }
}

// ─── Edit Project Section ───────────────────────────────────────

export interface EditSectionOpts {
  sessionId: string;
  sectionId: string;
  content: string;
  title?: string;
  expectedCurrentVersion: number;
  userId: string;
}

export async function editProjectSection(opts: EditSectionOpts): Promise<SectionResult> {
  const { sessionId, sectionId, content, title, expectedCurrentVersion, userId } = opts;
  const now = new Date().toISOString();
  const pendingAudits: Array<Parameters<typeof logAudit>[0]> = [];
  let projectId: string | null = null;

  const updatedSection = await withUserRLS(userId, async (tx) => {
    // Lock session row — concurrent edits block here
    const [session] = await tx
      .select()
      .from(workflowSessions)
      .where(eq(workflowSessions.id, sessionId))
      .for('update');

    if (!session) {
      throw new SectionVersionError('SectionNotFound', `Session ${sessionId} not found`);
    }

    projectId = session.projectId;
    const ctx = session.context as { projectSections?: SectionResult[] };
    const sections = ctx.projectSections ?? [];
    const idx = sections.findIndex((s) => s.id === sectionId);

    if (idx < 0) {
      throw new SectionVersionError('SectionNotFound', `Section ${sectionId} not found in session ${sessionId}`);
    }

    const section = sections[idx];

    // Optimistic lock check
    if (section.currentVersion !== expectedCurrentVersion) {
      throw new SectionVersionError(
        'ConcurrentModification',
        `Section ${sectionId} has been modified since the client read`,
        { currentVersion: section.currentVersion },
      );
    }

    const newContentHash = hashContent(content);
    const effectiveTitle = title ?? section.title;

    // No-op: skip if content and title are unchanged
    if (newContentHash === section.contentHash && effectiveTitle === section.title) {
      return section;
    }

    const newVersion = section.currentVersion + 1;

    // Legacy backfill: if no version row exists for the current version,
    // insert a baseline row with the old content first
    const [existingRow] = await tx
      .select()
      .from(sectionVersions)
      .where(and(
        eq(sectionVersions.sessionId, sessionId),
        eq(sectionVersions.sectionId, sectionId),
        eq(sectionVersions.version, section.currentVersion),
      ))
      .limit(1);

    if (!existingRow) {
      const baselineHash = hashContent(section.content);
      await tx.insert(sectionVersions).values({
        sessionId,
        sectionId,
        version: section.currentVersion,
        content: section.content,
        contentHash: baselineHash,
        title: section.title,
        metadata: section.metadata,
        reason: 'legacy_backfill',
        createdBy: userId,
      });
      pendingAudits.push({
        userId,
        action: 'section.generated',
        resourceType: 'workflow_session',
        resourceId: sessionId,
        metadata: { sectionId, version: section.currentVersion, contentHash: baselineHash, legacyBackfill: true },
      });
    }

    // Insert new version row
    await tx.insert(sectionVersions).values({
      sessionId,
      sectionId,
      version: newVersion,
      content,
      contentHash: newContentHash,
      title: effectiveTitle,
      metadata: section.metadata,
      reason: 'user_edit',
      createdBy: userId,
    });

    // Build updated section
    const updated: SectionResult = {
      ...section,
      content,
      title: effectiveTitle,
      contentHash: newContentHash,
      source: 'edited',
      state: 'draft',
      currentVersion: newVersion,
      versionCount: section.versionCount + 1,
      lastStateChangeAt: now,
      lastStateChangeBy: userId,
    };

    // Update session context atomically
    const updatedSections = [...sections];
    updatedSections[idx] = updated;

    await tx
      .update(workflowSessions)
      .set({
        context: { ...ctx, projectSections: updatedSections },
        updatedAt: new Date(),
      })
      .where(eq(workflowSessions.id, sessionId));

    pendingAudits.push({
      userId,
      action: 'project.section_update',
      resourceType: 'workflow_session',
      resourceId: sessionId,
      metadata: { sectionId, fromVersion: section.currentVersion, toVersion: newVersion, contentHash: newContentHash, previousState: section.state },
    });

    return updated;
  });

  // Post-commit: audit, snapshot sync, event publish
  for (const entry of pendingAudits) {
    await logAudit(entry);
  }

  if (projectId) {
    await syncProjectDocumentSnapshot(projectId, userId, sessionId);
  }

  try {
    await persistAndPublishSectionUpdatedEvent(sessionId, sectionId, updatedSection);
  } catch (err) {
    log.warn({ error: err instanceof Error ? err.message : String(err), sessionId, sectionId }, 'Section updated event publish failed');
  }

  return updatedSection;
}

// ─── Snapshot Sync ──────────────────────────────────────────────

export async function syncProjectDocumentSnapshot(
  projectId: string,
  userId: string,
  sessionId: string,
): Promise<void> {
  try {
    await withUserRLS(userId, async (tx) => {
      // Re-read the latest session context to get fresh sections
      const [freshSession] = await tx
        .select({ context: workflowSessions.context })
        .from(workflowSessions)
        .where(eq(workflowSessions.id, sessionId))
        .limit(1);
      const allSections = (freshSession?.context as { projectSections?: SectionResult[] })?.projectSections ?? [];

      const [existing] = await tx
        .select()
        .from(projectDocuments)
        .where(eq(projectDocuments.projectId, projectId))
        .orderBy(desc(projectDocuments.version))
        .limit(1);

      if (existing) {
        await tx
          .update(projectDocuments)
          .set({
            sections: allSections as unknown as Record<string, unknown>[],
            updatedAt: new Date(),
          })
          .where(eq(projectDocuments.id, existing.id));
      } else {
        await tx.insert(projectDocuments).values({
          projectId,
          version: 1,
          sections: allSections as unknown as Record<string, unknown>[],
        });
      }
    });
  } catch (err) {
    log.warn({ error: err instanceof Error ? err.message : String(err), projectId }, 'Snapshot sync failed');
  }
}

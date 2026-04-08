import { and, desc, eq, inArray, isNull, max } from 'drizzle-orm';

import { db, withUserRLS } from '@/lib/db';
import { projects, workflowSessions, projectDocuments, sectionVersions } from '@/lib/db/schema';
import { logger } from '@/lib/logger';

import { hashContent } from './section-versions';
import type { SectionResult } from './types';

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
  const project = await withUserRLS(userId, async (tx) => {
    return tx.query.projects.findFirst({
      where: and(eq(projects.id, projectId), isNull(projects.deletedAt)),
    });
  });
  if (!project) return null;

  const qualifyingSessions = await db
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

  const [snapshotDoc] = await db
    .select()
    .from(projectDocuments)
    .where(eq(projectDocuments.projectId, projectId))
    .orderBy(desc(projectDocuments.version))
    .limit(1);

  if (session) {
    const ctx = session.context as { projectSections?: unknown[] } | null;
    let sections = normalizeSections(ctx?.projectSections ?? [], session.createdAt.toISOString());
    if (sections.length > 0) {
      sections = await reconcileDrift(session.id, sections);
    }
    return { project, session, snapshotDoc: snapshotDoc ?? null, mode: 'session', sections };
  }

  if (snapshotDoc) {
    const rawSections = (snapshotDoc.sections ?? []) as unknown[];
    const sections = normalizeSections(rawSections, snapshotDoc.createdAt.toISOString());
    return { project, session: null, snapshotDoc, mode: 'snapshot', sections };
  }

  return { project, session: null, snapshotDoc: null, mode: 'snapshot', sections: [] };
}

// ─── Drift Reconciliation ────────────────────────────────────────

async function reconcileDrift(sessionId: string, sections: SectionResult[]): Promise<SectionResult[]> {
  try {
    const maxVersionRows = await db
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
      'Section version drift detected, reconciling',
    );

    const latestRows: Array<typeof sectionVersions.$inferSelect> = [];
    for (const section of drifted) {
      const targetVersion = maxVersionMap.get(section.id)!;
      const [row] = await db
        .select()
        .from(sectionVersions)
        .where(and(
          eq(sectionVersions.sessionId, sessionId),
          eq(sectionVersions.sectionId, section.id),
          eq(sectionVersions.version, targetVersion),
        ))
        .limit(1);
      if (row) latestRows.push(row);
    }

    const patchMap = new Map(latestRows.map((row) => [row.sectionId, row]));
    const reconciled = sections.map((s) => {
      const patch = patchMap.get(s.id);
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

    // Write reconciled sections back to session context
    const [freshSession] = await db
      .select({ context: workflowSessions.context })
      .from(workflowSessions)
      .where(eq(workflowSessions.id, sessionId))
      .limit(1);
    const existingCtx = (freshSession?.context ?? {}) as Record<string, unknown>;
    await db
      .update(workflowSessions)
      .set({ context: { ...existingCtx, projectSections: reconciled }, updatedAt: new Date() })
      .where(eq(workflowSessions.id, sessionId));

    return reconciled;
  } catch (err) {
    log.error(
      { error: err instanceof Error ? err.message : String(err), sessionId },
      'Drift reconciliation failed, returning original sections',
    );
    return sections;
  }
}

import { and, desc, eq, inArray, isNull, max } from 'drizzle-orm';

import { withUserRLS } from '@/lib/db';
import type { Database } from '@/lib/db';
import { projects, workflowSessions, projectDocuments, sectionVersions, agentSessions, agentSections, agentTurns } from '@/lib/db/schema';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';

import { persistAndPublishSectionUpdatedEvent } from '@/lib/pubsub';
import { hashContent, SectionVersionError } from '@/lib/section-versions';
import type { SectionResult } from '@/lib/ai/agent/types';

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
  // 'agent' mode is read-only; sections come from agent_sections and the legacy
  // edit/version paths (which assume workflowSessions.context) don't apply.
  mode: 'session' | 'snapshot' | 'agent';
  sections: SectionResult[];
}

// Map V3 agent section status to the SectionResult.state tri-state expected by
// the workspace UI. Accepted → approved, needs_review → reviewed, everything
// else (draft, pending, generating, stale, invalidated, failed, rejected) → draft.
function mapAgentStatusToState(status: string): SectionResult['state'] {
  if (status === 'accepted') return 'approved';
  if (status === 'needs_review') return 'reviewed';
  return 'draft';
}

export function agentSectionToSectionResult(row: typeof agentSections.$inferSelect): SectionResult {
  const content = row.acceptedContent ?? row.content ?? '';
  const tokens = (row.tokenUsage ?? {}) as { input?: number; output?: number; in?: number; out?: number };
  // Surface the slug-shaped sectionKey, not the row UUID, so /proiecte routes
  // that validate the section identifier with SLUG_RE (sections/[sectionId])
  // don't 400. The legacy workflow_sessions store uses slug-style ids too
  // ('sec-1', 'rezumat', etc.) — agent mode mirrors that contract.
  return {
    id: row.sectionKey,
    title: row.title,
    content,
    order: row.documentOrder,
    source: 'generated',
    state: mapAgentStatusToState(row.status),
    currentVersion: 1,
    versionCount: 1,
    contentHash: hashContent(content),
    lastStateChangeAt: row.updatedAt.toISOString(),
    lastStateChangeBy: null,
    metadata: {
      model: row.modelUsed ?? '',
      provider: '',
      tokensIn: tokens.input ?? tokens.in ?? 0,
      tokensOut: tokens.output ?? tokens.out ?? 0,
      latencyMs: row.latencyMs ?? 0,
      retryCount: row.retryCount,
      fallbackUsed: false,
      generatedAt: row.updatedAt.toISOString(),
      checksum: '',
    },
  };
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

    // V3 fallback. Projects promoted from V3 agent sessions don't have a
    // workflow_sessions row — ensureProjectForSession only creates the
    // projects row and sets agentSessions.projectId. Without this branch,
    // /proiecte/[id] would show "no sections" even when V3 has drafted
    // and persisted them to agent_sections. See investigate report 2026-05-12.
    //
    // CRITICAL: classify the session as V3 vs managed by its most recent
    // turn. agent_sessions has no runtime_mode column (that lives on
    // agent_turns and agent_messages), and agent_sections is shared between
    // both runtimes. Without this gate, a managed-runtime session whose
    // project lacks a workflow_sessions row would surface here in V3-mode
    // UI — leaking managed state through a read path the managed runtime
    // doesn't own. See round-4 audit 2026-05-12.
    const linkedAgentSessions = await tx
      .select({ id: agentSessions.id })
      .from(agentSessions)
      .where(and(
        eq(agentSessions.projectId, projectId),
        eq(agentSessions.userId, userId),
      ))
      .orderBy(desc(agentSessions.updatedAt))
      .limit(1);

    if (linkedAgentSessions.length > 0) {
      const agentSessionId = linkedAgentSessions[0].id;
      // Look up the most recent turn's runtime mode. A session with no turns
      // is effectively brand-new (no sections yet either), so fall through
      // unguarded — the agent_sections check below short-circuits the empty
      // case. If the latest turn is managed, refuse the fallback so the
      // managed runtime's own UI is the only render path.
      const [latestTurn] = await tx
        .select({ runtimeMode: agentTurns.runtimeMode })
        .from(agentTurns)
        .where(eq(agentTurns.sessionId, agentSessionId))
        .orderBy(desc(agentTurns.startedAt))
        .limit(1);
      if (!latestTurn || latestTurn.runtimeMode === 'v3') {
        const sectionRows = await tx
          .select()
          .from(agentSections)
          .where(eq(agentSections.sessionId, agentSessionId))
          .orderBy(agentSections.documentOrder);
        if (sectionRows.length > 0) {
          const sections = sectionRows.map(agentSectionToSectionResult);
          return { project, session: null, snapshotDoc: snapshotDoc ?? null, mode: 'agent', sections };
        }
      }
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

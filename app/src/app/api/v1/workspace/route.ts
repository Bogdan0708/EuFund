import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { withUserRLS } from '@/lib/db';
import { projects, workflowSessions, projectDocuments, projectFiles, agentSessions, agentSections, agentTurns } from '@/lib/db/schema';
import { eq, and, inArray, isNull, desc, count } from 'drizzle-orm';
import { Errors, FondEUError } from '@/lib/errors';
import { normalizeSections, agentSectionToSectionResult } from '@/lib/workspace';
import type { SectionResult } from '@/lib/ai/agent/types';

export async function GET() {
  try {
    const user = await requireAuth();

    const { userProjects, sessionByProject, docByProject, fileCountMap, agentSessionByProject, agentSectionsBySession } = await withUserRLS(user.id, async (tx) => {
      const userProjects = await tx
        .select()
        .from(projects)
        .where(and(eq(projects.userId, user.id), isNull(projects.deletedAt)))
        .orderBy(desc(projects.updatedAt))
        .limit(50);

      if (userProjects.length === 0) {
        return {
          userProjects: [] as typeof userProjects,
          sessionByProject: new Map<string, typeof workflowSessions.$inferSelect>(),
          docByProject: new Map<string, typeof projectDocuments.$inferSelect>(),
          fileCountMap: new Map<string, number>(),
          agentSessionByProject: new Map<string, typeof agentSessions.$inferSelect>(),
          agentSectionsBySession: new Map<string, (typeof agentSections.$inferSelect)[]>(),
        };
      }

      const projectIds = userProjects.map((p) => p.id);

      // Load best session per project
      const allSessions = await tx
        .select()
        .from(workflowSessions)
        .where(and(
          inArray(workflowSessions.projectId, projectIds),
          eq(workflowSessions.userId, user.id),
          inArray(workflowSessions.status, ['active', 'paused', 'completed']),
        ))
        .orderBy(desc(workflowSessions.updatedAt));

      const sessionByProject = new Map<string, typeof workflowSessions.$inferSelect>();
      for (const s of allSessions) {
        if (!s.projectId) continue;
        const existing = sessionByProject.get(s.projectId);
        if (!existing) {
          sessionByProject.set(s.projectId, s);
        } else if (
          ['active', 'paused'].includes(s.status) &&
          !['active', 'paused'].includes(existing.status)
        ) {
          sessionByProject.set(s.projectId, s);
        }
      }

      // Load snapshot docs
      const allDocs = await tx
        .select()
        .from(projectDocuments)
        .where(inArray(projectDocuments.projectId, projectIds))
        .orderBy(desc(projectDocuments.version));

      const docByProject = new Map<string, typeof projectDocuments.$inferSelect>();
      for (const d of allDocs) {
        if (!docByProject.has(d.projectId)) {
          docByProject.set(d.projectId, d);
        }
      }

      // Count uploaded files per project
      const fileCounts = await tx
        .select({
          projectId: projectFiles.projectId,
          fileCount: count().as('file_count'),
        })
        .from(projectFiles)
        .where(and(
          inArray(projectFiles.projectId, projectIds),
          eq(projectFiles.category, 'uploaded'),
        ))
        .groupBy(projectFiles.projectId);

      const fileCountMap = new Map(fileCounts.map((f) => [f.projectId, Number(f.fileCount)]));

      // V3 fallback. Projects promoted from V3 agent sessions don't have a
      // workflow_sessions row, only agent_sessions linked via projectId. Mirror
      // the resolveProjectWorkspace fall-through so the /documente index
      // surfaces those projects too. One batched pair of queries for all 50
      // projects, no N+1.
      //
      // CRITICAL: classify by most-recent agent_turns.runtimeMode. agent_sessions
      // has no runtime_mode column; managed runtime also writes to agent_sections.
      // Without this gate, managed-promoted projects (which lack workflow_sessions
      // by design) would render in V3-mode UI in /documente. See round-4 audit.
      const projectsWithoutWorkflow = projectIds.filter((id) => !sessionByProject.has(id));
      const agentSessionByProject = new Map<string, typeof agentSessions.$inferSelect>();
      const agentSectionsBySession = new Map<string, (typeof agentSections.$inferSelect)[]>();
      if (projectsWithoutWorkflow.length > 0) {
        const linkedAgentSessions = await tx
          .select()
          .from(agentSessions)
          .where(and(
            inArray(agentSessions.projectId, projectsWithoutWorkflow),
            eq(agentSessions.userId, user.id),
          ))
          .orderBy(desc(agentSessions.updatedAt));

        // Most-recent agent_session per project (orderBy desc above) — candidate
        // for runtime classification.
        const candidatesByProject = new Map<string, typeof agentSessions.$inferSelect>();
        for (const s of linkedAgentSessions) {
          if (!s.projectId) continue;
          if (!candidatesByProject.has(s.projectId)) {
            candidatesByProject.set(s.projectId, s);
          }
        }

        // Batched classification: latest agent_turn per candidate session. A
        // session with no turns is treated as V3 (new sessions enter the V3
        // runtime by default; managed turns always produce a turn row).
        const candidateSessionIds = Array.from(candidatesByProject.values()).map((s) => s.id);
        const v3SessionIds = new Set<string>(candidateSessionIds);
        if (candidateSessionIds.length > 0) {
          const allTurns = await tx
            .select({ sessionId: agentTurns.sessionId, runtimeMode: agentTurns.runtimeMode })
            .from(agentTurns)
            .where(inArray(agentTurns.sessionId, candidateSessionIds))
            .orderBy(desc(agentTurns.startedAt));
          const latestRuntimeBySession = new Map<string, string>();
          for (const t of allTurns) {
            if (!latestRuntimeBySession.has(t.sessionId)) {
              latestRuntimeBySession.set(t.sessionId, t.runtimeMode);
            }
          }
          for (const id of candidateSessionIds) {
            const mode = latestRuntimeBySession.get(id);
            if (mode === 'managed') v3SessionIds.delete(id);
          }
        }

        for (const [projectId, session] of candidatesByProject) {
          if (v3SessionIds.has(session.id)) {
            agentSessionByProject.set(projectId, session);
          }
        }

        const linkedSessionIds = Array.from(agentSessionByProject.values()).map((s) => s.id);
        if (linkedSessionIds.length > 0) {
          const allAgentSections = await tx
            .select()
            .from(agentSections)
            .where(inArray(agentSections.sessionId, linkedSessionIds))
            .orderBy(agentSections.documentOrder);

          for (const row of allAgentSections) {
            const bucket = agentSectionsBySession.get(row.sessionId) ?? [];
            bucket.push(row);
            agentSectionsBySession.set(row.sessionId, bucket);
          }
        }
      }

      return { userProjects, sessionByProject, docByProject, fileCountMap, agentSessionByProject, agentSectionsBySession };
    });

    if (userProjects.length === 0) {
      return NextResponse.json({ projects: [] });
    }

    const result = userProjects.map((p) => {
      const session = sessionByProject.get(p.id);
      const doc = docByProject.get(p.id);
      const agentSession = agentSessionByProject.get(p.id);
      const agentRows = agentSession ? agentSectionsBySession.get(agentSession.id) ?? [] : [];

      let sections: SectionResult[] = [];
      let mode: 'session' | 'snapshot' | 'agent' = 'snapshot';
      let lastEditedAt: Date | null = null;

      if (session) {
        const ctx = session.context as { projectSections?: unknown[] } | null;
        // Note: skips reconcileDrift() for performance (avoids N+1 queries for up to 50 projects).
        // Drift is a defense-in-depth edge case that should never occur in normal operation.
        // The per-project sections view (GET /api/v1/projects/:id/sections) does reconcile.
        sections = normalizeSections(ctx?.projectSections ?? [], session.createdAt.toISOString());
        mode = 'session';
        lastEditedAt = session.updatedAt;
      } else if (agentRows.length > 0) {
        // V3 agent fallback — mirrors resolveProjectWorkspace in lib/workspace.ts.
        // /documente was rendering 0 sections for V3-promoted projects because
        // the legacy workflow_sessions path never matched.
        sections = agentRows.map(agentSectionToSectionResult);
        mode = 'agent';
        lastEditedAt = agentSession?.updatedAt ?? null;
      } else if (doc) {
        sections = normalizeSections((doc.sections ?? []) as unknown[], doc.createdAt.toISOString());
        lastEditedAt = doc.updatedAt;
      }

      const stateBreakdown = { draft: 0, reviewed: 0, approved: 0 };
      for (const s of sections) {
        if (s.state in stateBreakdown) stateBreakdown[s.state as keyof typeof stateBreakdown]++;
      }

      return {
        id: p.id,
        title: p.title,
        sectionCount: sections.length,
        stateBreakdown,
        lastEditedAt: (lastEditedAt ?? p.updatedAt ?? new Date()).toISOString(),
        mode,
        hasUploadedFiles: (fileCountMap.get(p.id) ?? 0) > 0,
      };
    });

    return NextResponse.json({ projects: result });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

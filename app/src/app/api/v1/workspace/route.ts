import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { db } from '@/lib/db';
import { projects, workflowSessions, projectDocuments, projectFiles } from '@/lib/db/schema';
import { eq, and, inArray, isNull, desc, count } from 'drizzle-orm';
import { Errors, FondEUError } from '@/lib/errors';
import { normalizeSections } from '@/lib/ai/orchestrator/workspace';
import type { SectionResult } from '@/lib/ai/orchestrator/types';

export async function GET(_req: NextRequest) {
  try {
    const user = await requireAuth();

    const userProjects = await db
      .select()
      .from(projects)
      .where(and(eq(projects.userId, user.id), isNull(projects.deletedAt)))
      .orderBy(desc(projects.updatedAt))
      .limit(50);

    if (userProjects.length === 0) {
      return NextResponse.json({ projects: [] });
    }

    const projectIds = userProjects.map((p) => p.id);

    // Load best session per project
    const allSessions = await db
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
    const allDocs = await db
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
    const fileCounts = await db
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

    const result = userProjects.map((p) => {
      const session = sessionByProject.get(p.id);
      const doc = docByProject.get(p.id);

      let sections: SectionResult[] = [];
      let mode: 'session' | 'snapshot' = 'snapshot';

      if (session) {
        const ctx = session.context as { projectSections?: unknown[] } | null;
        sections = normalizeSections(ctx?.projectSections ?? [], session.createdAt.toISOString());
        mode = 'session';
      } else if (doc) {
        sections = normalizeSections((doc.sections ?? []) as unknown[], doc.createdAt.toISOString());
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
        lastEditedAt: (session?.updatedAt ?? doc?.updatedAt ?? p.updatedAt ?? new Date()).toISOString(),
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

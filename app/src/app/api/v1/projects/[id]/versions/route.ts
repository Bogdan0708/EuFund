// ─── Project Versions API ────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { withUserRLS } from '@/lib/db';
import { projectVersions, projects } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth, requireOrgRole } from '@/lib/auth/helpers';
import { logAudit } from '@/lib/legal/audit';
import { eq, and, isNull, desc } from 'drizzle-orm';

type Params = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = params;

    const project = await withUserRLS(user.id, async (tx) => {
      return tx.query.projects.findFirst({
        where: and(eq(projects.id, id), isNull(projects.deletedAt)),
      });
    });
    if (!project) throw Errors.notFound('project', id);

    await requireOrgRole(user.id, project.orgId, 'viewer');

    const versions = await withUserRLS(user.id, async (tx) => {
      return tx
        .select()
        .from(projectVersions)
        .where(eq(projectVersions.projectId, id))
        .orderBy(desc(projectVersions.versionNumber));
    });

    return NextResponse.json({ success: true, data: versions });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = params;

    const project = await withUserRLS(user.id, async (tx) => {
      return tx.query.projects.findFirst({
        where: and(eq(projects.id, id), isNull(projects.deletedAt)),
      });
    });
    if (!project) throw Errors.notFound('project', id);

    await requireOrgRole(user.id, project.orgId, 'project_manager');

    const nextVersion = (project.currentVersion || 1) + 1;

    // Snapshot current state
    const version = await withUserRLS(user.id, async (tx) => {
      const [createdVersion] = await tx.insert(projectVersions).values({
        projectId: id,
        versionNumber: nextVersion,
        changedBy: user.id,
        snapshot: {
          title: project.title,
          acronym: project.acronym,
          sectionSummary: project.sectionSummary,
          sectionContext: project.sectionContext,
          sectionObjectives: project.sectionObjectives,
          sectionMethodology: project.sectionMethodology,
          sectionBudget: project.sectionBudget,
          sectionIndicators: project.sectionIndicators,
          sectionSustainability: project.sectionSustainability,
          sectionPartnership: project.sectionPartnership,
          sectionRisks: project.sectionRisks,
          totalBudget: project.totalBudget,
        },
        changeSummary: `Versiunea ${nextVersion} salvată de utilizator`,
      }).returning();

      await tx
        .update(projects)
        .set({ currentVersion: nextVersion, updatedAt: new Date() })
        .where(eq(projects.id, id));

      return createdVersion;
    });

    await logAudit({
      userId: user.id,
      action: 'project.version_save',
      resourceType: 'project',
      resourceId: id,
      metadata: { versionNumber: nextVersion },
    });

    return NextResponse.json({ success: true, data: version }, { status: 201 });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

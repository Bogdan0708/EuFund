// ─── Project Detail API ──────────────────────────────────────────
// GET    /api/v1/projects/[id] - Get project details
// PUT    /api/v1/projects/[id] - Update project
// DELETE /api/v1/projects/[id] - Soft delete project

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { updateProjectSectionSchema } from '@/lib/validators';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth, requireOrgRole } from '@/lib/auth/helpers';
import { logAudit, sanitizeForAudit } from '@/lib/legal/audit';
import { eq, and, isNull } from 'drizzle-orm';
import { logger } from '@/lib/logger';

type Params = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = params;

    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, id), isNull(projects.deletedAt)),
    });

    if (!project) {
      throw Errors.notFound('project', id);
    }

    await requireOrgRole(user.id, project.orgId, 'viewer');

    return NextResponse.json({ success: true, data: project });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    logger.error({ error: error }, '[projects:get]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = params;

    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, id), isNull(projects.deletedAt)),
    });

    if (!project) {
      throw Errors.notFound('project', id);
    }

    await requireOrgRole(user.id, project.orgId, 'project_manager');

    const body = await req.json();

    // Support both section updates and general field updates
    if (body.section) {
      const parsed = updateProjectSectionSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          Errors.validation('body', 'Date invalide', 'Invalid input').toResponse('ro'),
          { status: 400 },
        );
      }

      const sectionKey = `section${parsed.data.section.charAt(0).toUpperCase() + parsed.data.section.slice(1)}` as keyof typeof projects;

      const [updated] = await db
        .update(projects)
        .set({
          [sectionKey]: parsed.data.content,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, id))
        .returning();

      await logAudit({
        userId: user.id,
        action: 'project.section_update',
        resourceType: 'project',
        resourceId: id,
        metadata: { section: parsed.data.section },
      });

      return NextResponse.json({ success: true, data: updated });
    }

    // General update (title, status, budget, dates, etc.)
    const allowedFields = [
      'title', 'acronym', 'status', 'startDate', 'endDate', 'durationMonths',
      'totalBudget', 'euContribution', 'nationalContrib', 'ownContrib', 'callId',
    ] as const;

    const updateData: Record<string, any> = { updatedAt: new Date() };
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    const [updated] = await db
      .update(projects)
      .set(updateData)
      .where(eq(projects.id, id))
      .returning();

    await logAudit({
      userId: user.id,
      action: 'project.update',
      resourceType: 'project',
      resourceId: id,
      oldValue: { title: project.title, status: project.status },
      newValue: updateData,
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    logger.error({ error: error }, '[projects:update]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = params;

    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, id), isNull(projects.deletedAt)),
    });

    if (!project) {
      throw Errors.notFound('project', id);
    }

    await requireOrgRole(user.id, project.orgId, 'org_admin');

    await db
      .update(projects)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(projects.id, id));

    await logAudit({
      userId: user.id,
      action: 'project.delete',
      resourceType: 'project',
      resourceId: id,
    });

    return NextResponse.json({ success: true, message: 'Proiectul a fost șters.' });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    logger.error({ error: error }, '[projects:delete]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

// ─── Project Detail API ──────────────────────────────────────────
// GET    /api/v1/projects/[id] - Get project details
// PUT    /api/v1/projects/[id] - Update project
// DELETE /api/v1/projects/[id] - Soft delete project

import { NextRequest, NextResponse } from 'next/server';
import { withUserRLS } from '@/lib/db';
import { organizations, projects } from '@/lib/db/schema';
import { updateProjectSectionSchema } from '@/lib/validators';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth } from '@/lib/auth/helpers';
import { logAudit } from '@/lib/legal/audit';
import { eq, and, isNull } from 'drizzle-orm';
import { logger } from '@/lib/logger';

type Params = { params: { id: string } };
const DIRECT_MUTABLE_PROJECT_STATUSES = ['ciorna', 'in_lucru', 'verificare', 'depus'] as const;
const TERMINAL_PROJECT_STATUSES = ['aprobat', 'respins', 'finalizat', 'arhivat'] as const;

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = params;

    const project = await withUserRLS(user.id, async (tx) => {
      return tx.query.projects.findFirst({
        where: and(eq(projects.id, id), isNull(projects.deletedAt)),
      });
    });

    if (!project) {
      throw Errors.notFound('project', id);
    }

    const organization = await withUserRLS(user.id, async (tx) => {
      return tx.query.organizations.findFirst({
        where: eq(organizations.id, project.orgId),
        columns: { name: true },
      });
    });

    return NextResponse.json({
      success: true,
      data: { ...project, organizationName: organization?.name || null },
    });
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

    const project = await withUserRLS(user.id, async (tx) => {
      return tx.query.projects.findFirst({
        where: and(eq(projects.id, id), isNull(projects.deletedAt)),
      });
    });

    if (!project) {
      throw Errors.notFound('project', id);
    }

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

      const updated = await withUserRLS(user.id, async (tx) => {
        const [projectUpdated] = await tx
          .update(projects)
          .set({
            [sectionKey]: parsed.data.content,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, id))
          .returning();
        return projectUpdated;
      });

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

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    if (body.status !== undefined) {
      const nextStatus = String(body.status);
      const currentStatus = String(project.status);

      if (TERMINAL_PROJECT_STATUSES.includes(currentStatus as typeof TERMINAL_PROJECT_STATUSES[number]) && nextStatus !== currentStatus) {
        throw new FondEUError({
          code: 'CONFLICT',
          statusCode: 409,
          messageEn: 'Terminal project states cannot be changed from the generic update route.',
          messageRo: 'Stările finale ale proiectului nu pot fi modificate din ruta generică de actualizare.',
          details: { reason: 'TERMINAL_PROJECT_STATE_LOCKED', currentStatus, nextStatus },
          retryable: false,
        });
      }

      if (!DIRECT_MUTABLE_PROJECT_STATUSES.includes(nextStatus as typeof DIRECT_MUTABLE_PROJECT_STATUSES[number])) {
        throw new FondEUError({
          code: 'CONFLICT',
          statusCode: 409,
          messageEn: 'This status transition must use the dedicated workflow route.',
          messageRo: 'Această tranziție de status trebuie făcută prin fluxul dedicat.',
          details: { reason: 'PROJECT_STATUS_WORKFLOW_REQUIRED', currentStatus, nextStatus },
          retryable: false,
        });
      }

      if (currentStatus === 'verificare' && nextStatus !== 'verificare') {
        throw new FondEUError({
          code: 'CONFLICT',
          statusCode: 409,
          messageEn: 'Projects under review must be updated through the approval workflow.',
          messageRo: 'Proiectele aflate în verificare trebuie actualizate prin fluxul de aprobare.',
          details: { reason: 'PROJECT_UNDER_REVIEW', currentStatus, nextStatus },
          retryable: false,
        });
      }

      if (!user.isPlatformAdmin && nextStatus === 'depus') {
        throw new FondEUError({
          code: 'FORBIDDEN',
          statusCode: 403,
          messageEn: 'Only platform administrators can mark a project as submitted.',
          messageRo: 'Doar administratorii platformei pot marca un proiect ca depus.',
          details: { reason: 'PROJECT_SUBMISSION_REQUIRES_ADMIN' },
          retryable: false,
        });
      }
    }

    const updated = await withUserRLS(user.id, async (tx) => {
      const [projectUpdated] = await tx
        .update(projects)
        .set(updateData)
        .where(eq(projects.id, id))
        .returning();
      return projectUpdated;
    });

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

    const project = await withUserRLS(user.id, async (tx) => {
      return tx.query.projects.findFirst({
        where: and(eq(projects.id, id), isNull(projects.deletedAt)),
      });
    });

    if (!project) {
      throw Errors.notFound('project', id);
    }

    await withUserRLS(user.id, async (tx) => {
      await tx
        .update(projects)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(projects.id, id));
    });

    await logAudit({
      userId: user.id,
      action: 'project.delete',
      resourceType: 'project',
      resourceId: id,
    });

    return NextResponse.json({ success: true, data: { message: 'Proiectul a fost șters.' } });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    logger.error({ error: error }, '[projects:delete]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

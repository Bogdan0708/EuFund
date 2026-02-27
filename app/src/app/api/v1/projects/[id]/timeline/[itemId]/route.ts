import { NextRequest, NextResponse } from 'next/server';
import { withUserRLS } from '@/lib/db';
import { orgMembers, projects } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth, requireOrgRole } from '@/lib/auth/helpers';
import { updateTimelineItem, deleteTimelineItem, updateTimelineProgress } from '@/lib/services/timeline';
import { eq, and, isNull } from 'drizzle-orm';
import { logger } from '@/lib/logger';

type Params = { params: { id: string; itemId: string } };

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id, itemId } = params;

    const project = await withUserRLS(user.id, async (tx) => {
      return tx.query.projects.findFirst({
        where: and(eq(projects.id, id), isNull(projects.deletedAt)),
      });
    });
    if (!project) throw Errors.notFound('project', id);
    await requireOrgRole(user.id, project.orgId, 'project_manager');

    const body = await req.json();

    // If only progress_percentage is provided, use the dedicated function
    if (body.progress_percentage !== undefined && Object.keys(body).length === 1) {
      const item = await updateTimelineProgress(id, itemId, body.progress_percentage, user.id);
      if (!item) throw Errors.notFound('timeline_item', itemId);
      return NextResponse.json({ success: true, data: item });
    }

    // Map snake_case to camelCase if needed
    const updates = {
      taskName: body.taskName || body.task_name,
      startDate: body.startDate || body.start_date,
      endDate: body.endDate || body.end_date,
      dependencies: body.dependencies,
      progressPercentage: body.progressPercentage ?? body.progress_percentage,
      assignedTo: body.assignedTo || body.assigned_to,
      riskLevel: body.riskLevel || body.risk_level,
      workPackageId: body.workPackageId || body.work_package_id,
    };

    // Remove undefined values
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );

    if (cleanUpdates.assignedTo) {
      const membership = await withUserRLS(user.id, async (tx) => {
        return tx.query.orgMembers.findFirst({
          where: and(
            eq(orgMembers.orgId, project.orgId),
            eq(orgMembers.userId, cleanUpdates.assignedTo as string),
          ),
        });
      });

      if (!membership) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'assignedTo must be a member of the project organization',
            },
          },
          { status: 400 },
        );
      }
    }

    const item = await updateTimelineItem(id, itemId, cleanUpdates, user.id);
    if (!item) throw Errors.notFound('timeline_item', itemId);
    return NextResponse.json({ success: true, data: item });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    logger.error({ error: error }, '[timeline:update]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id, itemId } = params;

    const project = await withUserRLS(user.id, async (tx) => {
      return tx.query.projects.findFirst({
        where: and(eq(projects.id, id), isNull(projects.deletedAt)),
      });
    });
    if (!project) throw Errors.notFound('project', id);
    await requireOrgRole(user.id, project.orgId, 'project_manager');

    await deleteTimelineItem(id, itemId, user.id);
    return NextResponse.json({ success: true, data: { message: 'Timeline item deleted' } });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    logger.error({ error: error }, '[timeline:delete]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth, requireOrgRole } from '@/lib/auth/helpers';
import { getWorkPackage, updateWorkPackage, deleteWorkPackage } from '@/lib/services/work-packages';
import { eq, and, isNull } from 'drizzle-orm';

type Params = { params: { id: string; wpId: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id, wpId } = params;

    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, id), isNull(projects.deletedAt)),
    });
    if (!project) throw Errors.notFound('project', id);
    await requireOrgRole(user.id, project.orgId, 'viewer');

    const wp = await getWorkPackage(id, wpId);
    if (!wp) throw Errors.notFound('work_package', wpId);

    return NextResponse.json({ success: true, data: wp });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    console.error('[work-packages:get]', error);
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id, wpId } = params;

    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, id), isNull(projects.deletedAt)),
    });
    if (!project) throw Errors.notFound('project', id);
    await requireOrgRole(user.id, project.orgId, 'project_manager');

    const body = await req.json();
    const wp = await updateWorkPackage(id, wpId, body);
    if (!wp) throw Errors.notFound('work_package', wpId);

    return NextResponse.json({ success: true, data: wp });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    console.error('[work-packages:update]', error);
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id, wpId } = params;

    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, id), isNull(projects.deletedAt)),
    });
    if (!project) throw Errors.notFound('project', id);
    await requireOrgRole(user.id, project.orgId, 'project_manager');

    const wp = await deleteWorkPackage(id, wpId);
    if (!wp) throw Errors.notFound('work_package', wpId);

    return NextResponse.json({ success: true, data: { deleted: true } });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    console.error('[work-packages:delete]', error);
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth, requireOrgRole } from '@/lib/auth/helpers';
import { listWorkPackages, createWorkPackage } from '@/lib/services/work-packages';
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
    if (!project) throw Errors.notFound('project', id);
    await requireOrgRole(user.id, project.orgId, 'viewer');

    const wps = await listWorkPackages(id);
    return NextResponse.json({ success: true, data: wps });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    logger.error({ error: error }, '[work-packages:list]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = params;

    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, id), isNull(projects.deletedAt)),
    });
    if (!project) throw Errors.notFound('project', id);
    await requireOrgRole(user.id, project.orgId, 'project_manager');

    const body = await req.json();
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Name is required' } },
        { status: 400 },
      );
    }

    const wp = await createWorkPackage(id, body);
    return NextResponse.json({ success: true, data: wp }, { status: 201 });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    logger.error({ error: error }, '[work-packages:create]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth, requireOrgRole } from '@/lib/auth/helpers';
import { getProjectTimeline, createTimelineItem } from '@/lib/services/timeline';
import { eq, and, isNull } from 'drizzle-orm';

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

    const timeline = await getProjectTimeline(id);
    return NextResponse.json({ success: true, data: timeline });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    console.error('[timeline:get]', error);
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
    if (!body.taskName || !body.startDate || !body.endDate) {
      return NextResponse.json({ success: false, error: 'taskName, startDate, and endDate are required' }, { status: 400 });
    }

    const item = await createTimelineItem(id, body);
    return NextResponse.json({ success: true, data: item }, { status: 201 });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    console.error('[timeline:create]', error);
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

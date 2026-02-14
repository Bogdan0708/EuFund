import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth, requireOrgRole } from '@/lib/auth/helpers';
import { listRisks, createRisk, updateRisk, getRiskOverview } from '@/lib/services/risks';
import { eq, and, isNull } from 'drizzle-orm';

type Params = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = params;

    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, id), isNull(projects.deletedAt)),
    });
    if (!project) throw Errors.notFound('project', id);
    await requireOrgRole(user.id, project.orgId, 'viewer');

    const includeOverview = req.nextUrl.searchParams.get('overview') === 'true';
    const risks = await listRisks(id);

    const response: Record<string, unknown> = { success: true, data: risks };
    if (includeOverview) {
      response.overview = await getRiskOverview(id);
    }

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    console.error('[risks:list]', error);
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
    if (!body.riskType) {
      return NextResponse.json({ success: false, error: 'riskType is required' }, { status: 400 });
    }
    if (body.probability != null && (body.probability < 1 || body.probability > 5)) {
      return NextResponse.json({ success: false, error: 'probability must be 1-5' }, { status: 400 });
    }
    if (body.impact != null && (body.impact < 1 || body.impact > 5)) {
      return NextResponse.json({ success: false, error: 'impact must be 1-5' }, { status: 400 });
    }

    const risk = await createRisk(id, body);
    return NextResponse.json({ success: true, data: risk }, { status: 201 });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    console.error('[risks:create]', error);
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
    if (!project) throw Errors.notFound('project', id);
    await requireOrgRole(user.id, project.orgId, 'project_manager');

    const body = await req.json();
    if (!body.riskId) {
      return NextResponse.json({ success: false, error: 'riskId is required' }, { status: 400 });
    }

    const risk = await updateRisk(id, body.riskId, body);
    if (!risk) throw Errors.notFound('risk_assessment', body.riskId);

    return NextResponse.json({ success: true, data: risk });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    console.error('[risks:update]', error);
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

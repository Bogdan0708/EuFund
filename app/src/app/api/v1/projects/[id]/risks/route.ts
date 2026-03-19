import { NextRequest, NextResponse } from 'next/server';
import { withUserRLS } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth } from '@/lib/auth/helpers';
import { listRisks, createRisk, updateRisk, getRiskOverview } from '@/lib/services/risks';
import { logAudit } from '@/lib/legal/audit';
import { eq, and, isNull } from 'drizzle-orm';
import { logger } from '@/lib/logger';

type Params = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = params;

    const project = await withUserRLS(user.id, async (tx) => {
      return tx.query.projects.findFirst({
        where: and(eq(projects.id, id), isNull(projects.deletedAt)),
      });
    });
    if (!project) throw Errors.notFound('project', id);

    const includeOverview = req.nextUrl.searchParams.get('overview') === 'true';
    const risks = await listRisks(id, user.id);

    if (includeOverview) {
      return NextResponse.json({
        success: true,
        data: {
          risks,
          overview: await getRiskOverview(id, user.id),
        },
      });
    }
    return NextResponse.json({ success: true, data: risks });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    logger.error({ error: error }, '[risks:list]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = params;

    const project = await withUserRLS(user.id, async (tx) => {
      return tx.query.projects.findFirst({
        where: and(eq(projects.id, id), isNull(projects.deletedAt)),
      });
    });
    if (!project) throw Errors.notFound('project', id);

    const body = await req.json();
    if (!body.riskType) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'riskType is required' } },
        { status: 400 },
      );
    }
    if (body.probability != null && (body.probability < 1 || body.probability > 5)) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'probability must be 1-5' } },
        { status: 400 },
      );
    }
    if (body.impact != null && (body.impact < 1 || body.impact > 5)) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'impact must be 1-5' } },
        { status: 400 },
      );
    }

    const risk = await createRisk(id, body, user.id);
    await logAudit({
      userId: user.id,
      action: 'project.risk_create',
      resourceType: 'project',
      resourceId: id,
      metadata: {
        riskId: risk.id,
        riskType: body.riskType,
      },
    });
    return NextResponse.json({ success: true, data: risk }, { status: 201 });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    logger.error({ error: error }, '[risks:create]');
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
    if (!project) throw Errors.notFound('project', id);

    const body = await req.json();
    if (!body.riskId) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'riskId is required' } },
        { status: 400 },
      );
    }

    const risk = await updateRisk(id, body.riskId, body, user.id);
    if (!risk) throw Errors.notFound('risk_assessment', body.riskId);
    await logAudit({
      userId: user.id,
      action: 'project.risk_update',
      resourceType: 'project',
      resourceId: id,
      metadata: {
        riskId: body.riskId,
        fields: Object.keys(body ?? {}),
      },
    });

    return NextResponse.json({ success: true, data: risk });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    logger.error({ error: error }, '[risks:update]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

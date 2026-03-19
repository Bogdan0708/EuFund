import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { withUserRLS } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth } from '@/lib/auth/helpers';
import { logger } from '@/lib/logger';
import { getGhidEvidenceCoverage } from '@/lib/services/compliance';

const log = logger.child({ component: 'compliance-evidence-coverage-api' });
type Params = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const project = await withUserRLS(user.id, async (tx) => {
      return tx.query.projects.findFirst({
        where: and(eq(projects.id, params.id), isNull(projects.deletedAt)),
      });
    });
    if (!project) throw Errors.notFound('project', params.id);

    const coverage = await getGhidEvidenceCoverage(project.id, user.id);

    return NextResponse.json({
      success: true,
      data: coverage,
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[compliance:evidence-coverage]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

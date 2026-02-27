import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { withUserRLS } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth, requireOrgRole } from '@/lib/auth/helpers';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/legal/audit';
import { generateComplianceTasksFromGhid } from '@/lib/compliance/ghid-task-generator';
import { listGhidComplianceTasks, saveGhidComplianceTasks } from '@/lib/services/compliance';

const log = logger.child({ component: 'compliance-ghid-tasks-api' });
type Params = { params: { id: string } };

const createSchema = z.object({
  ghidText: z.string().min(200).max(100_000),
});

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const project = await withUserRLS(user.id, async (tx) => {
      return tx.query.projects.findFirst({
        where: and(eq(projects.id, params.id), isNull(projects.deletedAt)),
      });
    });
    if (!project) throw Errors.notFound('project', params.id);

    await requireOrgRole(user.id, project.orgId, 'viewer');
    const tasks = await listGhidComplianceTasks(project.id, user.id);

    return NextResponse.json({
      success: true,
      data: {
        items: tasks,
        meta: {
          total: tasks.length,
          pending: tasks.filter((t) => t.status === 'pending').length,
          completed: tasks.filter((t) => t.status === 'compliant').length,
        },
      },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[compliance:ghid-tasks:list]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const project = await withUserRLS(user.id, async (tx) => {
      return tx.query.projects.findFirst({
        where: and(eq(projects.id, params.id), isNull(projects.deletedAt)),
      });
    });
    if (!project) throw Errors.notFound('project', params.id);

    await requireOrgRole(user.id, project.orgId, 'project_manager');

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return NextResponse.json(
        Errors.validation(issue.path.join('.') || 'body', issue.message, issue.message).toResponse('ro'),
        { status: 400 },
      );
    }

    const generated = generateComplianceTasksFromGhid(project.id, parsed.data.ghidText);
    const persisted = await saveGhidComplianceTasks(project.id, generated.tasks, user.id);

    await logAudit({
      userId: user.id,
      action: 'ai.compliance_check',
      resourceType: 'project',
      resourceId: project.id,
      metadata: {
        source: 'ghid_to_tasks_persisted',
        generated: generated.summary.total,
        inserted: persisted.length,
        readinessScore: generated.readiness.overallScore,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        generated: generated.summary.total,
        inserted: persisted.length,
        readiness: generated.readiness,
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[compliance:ghid-tasks:create]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

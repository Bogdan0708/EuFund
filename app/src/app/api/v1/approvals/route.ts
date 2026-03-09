import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withUserRLS } from '@/lib/db';
import { orgMembers, projects, users } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { getPaginationParams, requireAuth, requireOrgRole } from '@/lib/auth/helpers';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/legal/audit';

const log = logger.child({ component: 'approvals-route' });
export const dynamic = 'force-dynamic';

const updateApprovalSchema = z.object({
  orgId: z.string().uuid().optional(),
  projectId: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
  feedback: z.string().max(2000).optional(),
});

async function resolveAdminOrgId(userId: string, requestedOrgId: string | null): Promise<string> {
  if (requestedOrgId) {
    await requireOrgRole(userId, requestedOrgId, 'org_admin');
    return requestedOrgId;
  }

  const adminMemberships = await withUserRLS(userId, async (tx) => {
    return tx.query.orgMembers.findMany({
      where: and(
        eq(orgMembers.userId, userId),
        inArray(orgMembers.role, ['admin', 'org_admin']),
      ),
      columns: { orgId: true },
      limit: 2,
    });
  });

  if (adminMemberships.length === 1) {
    return adminMemberships[0].orgId;
  }

  throw new FondEUError({
    code: 'CONFLICT',
    statusCode: 409,
    messageEn: 'A valid administrator organization context is required.',
    messageRo: 'Este necesar contextul unei organizații administrate valid.',
    details: { reason: 'APPROVAL_ORG_REQUIRED' },
    retryable: false,
  });
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth();
    const url = new URL(req.url);
    const orgId = await resolveAdminOrgId(user.id, url.searchParams.get('orgId'));
    const { page, perPage, offset } = getPaginationParams(req);

    const whereClause = and(
      eq(projects.orgId, orgId),
      eq(projects.status, 'verificare'),
      isNull(projects.deletedAt),
    );

    const [countResult, pendingProjects] = await withUserRLS(user.id, async (tx) => {
      return Promise.all([
        tx.select({ count: sql<number>`count(*)` }).from(projects).where(whereClause),
        tx
          .select({
            id: projects.id,
            orgId: projects.orgId,
            title: projects.title,
            acronym: projects.acronym,
            status: projects.status,
            createdAt: projects.createdAt,
            updatedAt: projects.updatedAt,
            createdByName: users.fullName,
            createdByEmail: users.email,
          })
          .from(projects)
          .leftJoin(users, eq(projects.createdBy, users.id))
          .where(whereClause)
          .orderBy(desc(projects.updatedAt))
          .limit(perPage)
          .offset(offset),
      ]);
    });

    const total = Number(countResult[0]?.count ?? 0);
    return NextResponse.json({
      success: true,
      data: pendingProjects,
      pagination: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[approvals-route] GET error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const parsed = updateApprovalSchema.safeParse(body);
    if (!parsed.success) {
      throw Errors.validation('body', 'Date invalide', 'Invalid input');
    }

    const orgId = await resolveAdminOrgId(user.id, parsed.data.orgId ?? null);
    const { projectId, decision, feedback } = parsed.data;

    const project = await withUserRLS(user.id, async (tx) => {
      return tx.query.projects.findFirst({
        where: and(
          eq(projects.id, projectId),
          eq(projects.orgId, orgId),
          eq(projects.status, 'verificare'),
          isNull(projects.deletedAt),
        ),
      });
    });

    if (!project) {
      throw Errors.notFound('project', projectId);
    }

    const nextStatus = decision === 'approve' ? 'finalizat' : 'ciorna';
    await withUserRLS(user.id, async (tx) => {
      await tx
        .update(projects)
        .set({
          status: nextStatus,
          updatedAt: new Date(),
          metadata: {
            ...(project.metadata ?? {}),
            ...(feedback ? { approvalFeedback: feedback } : {}),
          },
        })
        .where(eq(projects.id, projectId));
    });

    await logAudit({
      userId: user.id,
      action: 'project.status_change',
      resourceType: 'project',
      resourceId: projectId,
      oldValue: { status: 'verificare' },
      newValue: { status: nextStatus },
      metadata: {
        reviewerId: user.id,
        reviewerEmail: user.email,
        decision,
        ...(feedback ? { feedback } : {}),
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        projectId,
        status: nextStatus,
        decision,
        ...(feedback ? { feedback } : {}),
      },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[approvals-route] POST error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

// ─── Organization Approvals API ─────────────────────────────────
// GET  /api/v1/organizations/[id]/approvals - List projects pending approval
// POST /api/v1/organizations/[id]/approvals - Approve or reject a project

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projects, users } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireOrgMembership, getPaginationParams } from '@/lib/auth/helpers';
import { logAudit } from '@/lib/legal/audit';
import { desc, eq, and, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'org-approvals' });

type Params = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const orgId = params.id;
    await requireOrgMembership(orgId);

    const { page, perPage, offset } = getPaginationParams(req);

    const whereClause = and(
      eq(projects.orgId, orgId),
      eq(projects.status, 'verificare'),
      isNull(projects.deletedAt),
    );

    const [countResult, pendingProjects] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(projects).where(whereClause),
      db
        .select({
          id: projects.id,
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

    const total = Number(countResult[0]?.count ?? 0);

    return NextResponse.json({
      success: true,
      data: pendingProjects,
      pagination: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[org-approvals] GET error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

const approvalSchema = z.object({
  projectId: z.string().uuid(),
  decision: z.enum(['approve', 'reject', 'aprobat', 'respins']),
  feedback: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const orgId = params.id;
    const { user } = await requireOrgMembership(orgId, 'org_admin');

    const body = await req.json();
    const parsed = approvalSchema.safeParse(body);
    if (!parsed.success) {
      throw Errors.validation('body', 'Date invalide', 'Invalid input');
    }

    const { projectId, decision, feedback } = parsed.data;

    // Verify project exists, belongs to org, and is in 'verificare' status
    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.id, projectId),
        eq(projects.orgId, orgId),
        eq(projects.status, 'verificare'),
        isNull(projects.deletedAt),
      ),
    });

    if (!project) {
      throw Errors.notFound('project', projectId);
    }

    const nextStatus = decision === 'approve' || decision === 'aprobat'
      ? 'finalizat'
      : 'ciorna';

    await db
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

    await logAudit({
      userId: user.id,
      action: 'project.status_change',
      resourceType: 'project',
      resourceId: projectId,
      oldValue: { status: 'verificare' },
      newValue: { status: nextStatus },
      metadata: {
        decision,
        ...(feedback ? { feedback } : {}),
      },
    });

    return NextResponse.json({
      success: true,
      data: { projectId, status: nextStatus, decision },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[org-approvals] POST error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

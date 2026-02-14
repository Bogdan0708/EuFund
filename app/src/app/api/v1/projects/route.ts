// ─── Projects API ────────────────────────────────────────────────
// GET  /api/v1/projects - List projects with filtering, search, pagination
// POST /api/v1/projects - Create new project

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projects, orgMembers, organizations } from '@/lib/db/schema';
import { createProjectSchema } from '@/lib/validators';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth, requireOrgRole, getPaginationParams } from '@/lib/auth/helpers';
import { logAudit } from '@/lib/legal/audit';
import { eq, and, isNull, ilike, inArray, desc, count, sql } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth();
    const { page, perPage, offset } = getPaginationParams(req);
    const url = new URL(req.url);
    const search = url.searchParams.get('search') || undefined;
    const status = url.searchParams.get('status') || undefined;
    const orgId = url.searchParams.get('orgId') || undefined;

    // Get user's org IDs
    const userOrgs = await db
      .select({ orgId: orgMembers.orgId })
      .from(orgMembers)
      .where(eq(orgMembers.userId, user.id));

    const orgIds = userOrgs.map((o) => o.orgId);

    if (orgIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        meta: { page, perPage, total: 0, totalPages: 0 },
      });
    }

    // Build conditions
    const conditions = [
      inArray(projects.orgId, orgIds),
      isNull(projects.deletedAt),
    ];

    if (orgId && orgIds.includes(orgId)) {
      conditions.push(eq(projects.orgId, orgId));
    }
    if (status) {
      conditions.push(eq(projects.status, status as any));
    }
    if (search) {
      conditions.push(ilike(projects.title, `%${search}%`));
    }

    const whereClause = and(...conditions);

    const [results, totalResult] = await Promise.all([
      db
        .select({
          id: projects.id,
          orgId: projects.orgId,
          callId: projects.callId,
          title: projects.title,
          acronym: projects.acronym,
          status: projects.status,
          totalBudget: projects.totalBudget,
          complianceScore: projects.complianceScore,
          matchScore: projects.matchScore,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
        })
        .from(projects)
        .where(whereClause)
        .orderBy(desc(projects.updatedAt))
        .limit(perPage)
        .offset(offset),
      db.select({ total: count() }).from(projects).where(whereClause),
    ]);

    const total = totalResult[0]?.total || 0;

    return NextResponse.json({
      success: true,
      data: results,
      meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    console.error('[projects:list]', error);
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const parsed = createProjectSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      return NextResponse.json(
        Errors.validation(firstError.path.join('.'), firstError.message, firstError.message).toResponse('ro'),
        { status: 400 },
      );
    }

    const data = parsed.data;

    // Verify user has access to the organization
    await requireOrgRole(user.id, data.orgId, 'project_manager');

    // Insert project
    const [project] = await db.insert(projects).values({
      orgId: data.orgId,
      callId: data.callId,
      createdBy: user.id,
      title: data.title,
      acronym: data.acronym,
      status: 'ciorna',
      currentVersion: 1,
      startDate: data.startDate,
      endDate: data.endDate,
      durationMonths: data.durationMonths,
    }).returning();

    await logAudit({
      userId: user.id,
      action: 'project.create',
      resourceType: 'project',
      resourceId: project.id,
      newValue: { title: data.title, orgId: data.orgId, callId: data.callId },
    });

    return NextResponse.json({
      success: true,
      data: project,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    console.error('[projects:create]', error);
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

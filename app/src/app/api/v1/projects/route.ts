// ─── Projects API ────────────────────────────────────────────────
// GET  /api/v1/projects - List projects with filtering, search, pagination
// POST /api/v1/projects - Create new project

import { NextRequest, NextResponse } from 'next/server';
import { withUserRLS } from '@/lib/db';
import { projects, orgMembers, organizations } from '@/lib/db/schema';
import { createProjectSchema } from '@/lib/validators';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth, requireOrgRole, getPaginationParams } from '@/lib/auth/helpers';
import { logAudit } from '@/lib/legal/audit';
import { eq, and, isNull, ilike, inArray, desc, count } from 'drizzle-orm';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'projects-api' });
type ProjectStatus = NonNullable<typeof projects.$inferSelect.status>;

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth();
    const { page, perPage, offset } = getPaginationParams(req);
    const url = new URL(req.url);
    const search = url.searchParams.get('search') || undefined;
    const status = url.searchParams.get('status') || undefined;
    const orgId = url.searchParams.get('orgId') || undefined;

    // Get user's org IDs
    const userOrgs = await withUserRLS(user.id, async (tx) => {
      return tx
        .select({ orgId: orgMembers.orgId })
        .from(orgMembers)
        .where(eq(orgMembers.userId, user.id));
    });

    const orgIds = userOrgs.map((o) => o.orgId);

    if (orgIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          items: [],
          meta: { page, perPage, total: 0, totalPages: 0 },
        },
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
      conditions.push(eq(projects.status, status as ProjectStatus));
    }
    if (search) {
      conditions.push(ilike(projects.title, `%${search}%`));
    }

    const whereClause = and(...conditions);

    const [results, totalResult] = await withUserRLS(user.id, async (tx) => {
      return Promise.all([
        tx
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
        tx.select({ total: count() }).from(projects).where(whereClause),
      ]);
    });

    const total = totalResult[0]?.total || 0;

    return NextResponse.json({
      success: true,
      data: {
        items: results,
        meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
      },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[projects:list]');
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

    // Resolve orgId: use provided, or find user's first org, or create a default
    let orgId = data.orgId;
    if (!orgId) {
      const userOrg = await withUserRLS(user.id, async (tx) => {
        return tx.query.orgMembers.findFirst({
          where: eq(orgMembers.userId, user.id),
        });
      });
      if (userOrg) {
        orgId = userOrg.orgId;
      } else {
        // Auto-create a personal organization for the user
        const newOrg = await withUserRLS(user.id, async (tx) => {
          const [createdOrg] = await tx.insert(organizations).values({
            name: `Organizația lui ${user.name || 'Utilizator'}`,
            orgType: 'srl',
            orgSize: 'micro',
          }).returning();
          await tx.insert(orgMembers).values({
            orgId: createdOrg.id,
            userId: user.id,
            role: 'org_admin',
          });
          return createdOrg;
        });
        orgId = newOrg.id;
      }
    } else {
      // Verify user has access to the organization
      await requireOrgRole(user.id, orgId, 'project_manager');
    }

    // Insert project
    const project = await withUserRLS(user.id, async (tx) => {
      const [createdProject] = await tx.insert(projects).values({
        orgId,
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
      return createdProject;
    });

    await logAudit({
      userId: user.id,
      action: 'project.create',
      resourceType: 'project',
      resourceId: project.id,
      newValue: { title: data.title, orgId, callId: data.callId },
    });

    return NextResponse.json({
      success: true,
      data: project,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[projects:create]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

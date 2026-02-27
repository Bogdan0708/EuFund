// ─── Organization Audit Log API ──────────────────────────────────
// GET /api/v1/organizations/[id]/audit - List audit entries for org members
// Requires org_admin role minimum.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { auditLog, orgMembers, users } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth, requireOrgRole, getPaginationParams } from '@/lib/auth/helpers';
import { desc, eq, inArray, and, gte, lte, sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'org-audit' });

type Params = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const orgId = params.id;

    await requireOrgRole(user.id, orgId, 'org_admin');

    const { page, perPage, offset } = getPaginationParams(req);
    const url = new URL(req.url);

    // Optional filters
    const actionFilter = url.searchParams.get('action');
    const resourceTypeFilter = url.searchParams.get('resourceType');
    const fromDate = url.searchParams.get('from');
    const toDate = url.searchParams.get('to');

    // Get all user IDs that are members of this org
    const members = await db
      .select({ userId: orgMembers.userId })
      .from(orgMembers)
      .where(eq(orgMembers.orgId, orgId));

    const memberUserIds = members.map((m) => m.userId);

    if (memberUserIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        pagination: { page, perPage, total: 0, totalPages: 0 },
      });
    }

    // Build conditions
    const conditions = [inArray(auditLog.userId, memberUserIds)];
    if (actionFilter) {
      conditions.push(eq(auditLog.action, actionFilter));
    }
    if (resourceTypeFilter) {
      conditions.push(eq(auditLog.resourceType, resourceTypeFilter));
    }
    if (fromDate) {
      conditions.push(gte(auditLog.createdAt, new Date(fromDate)));
    }
    if (toDate) {
      conditions.push(lte(auditLog.createdAt, new Date(toDate)));
    }

    const whereClause = and(...conditions);

    // Count + paginated query in parallel
    const [countResult, entries] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(auditLog).where(whereClause),
      db
        .select({
          id: auditLog.id,
          userId: auditLog.userId,
          action: auditLog.action,
          resourceType: auditLog.resourceType,
          resourceId: auditLog.resourceId,
          metadata: auditLog.metadata,
          createdAt: auditLog.createdAt,
          userName: users.fullName,
          userEmail: users.email,
        })
        .from(auditLog)
        .leftJoin(users, eq(auditLog.userId, users.id))
        .where(whereClause)
        .orderBy(desc(auditLog.createdAt))
        .limit(perPage)
        .offset(offset),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    return NextResponse.json({
      success: true,
      data: entries,
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
    log.error({ error }, '[org-audit] GET error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

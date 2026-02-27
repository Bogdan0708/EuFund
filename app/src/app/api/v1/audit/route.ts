import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auditLog, orgMembers, users } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { getPaginationParams, requireAuth, requireOrgRole } from '@/lib/auth/helpers';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'audit-route' });
export const dynamic = 'force-dynamic';

async function resolveAdminOrgId(userId: string, requestedOrgId: string | null): Promise<string> {
  if (requestedOrgId) {
    await requireOrgRole(userId, requestedOrgId, 'org_admin');
    return requestedOrgId;
  }

  const adminMembership = await db.query.orgMembers.findFirst({
    where: and(
      eq(orgMembers.userId, userId),
      inArray(orgMembers.role, ['admin', 'org_admin']),
    ),
  });

  if (!adminMembership) {
    throw Errors.forbidden();
  }

  return adminMembership.orgId;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth();
    const url = new URL(req.url);
    const orgId = await resolveAdminOrgId(user.id, url.searchParams.get('orgId'));
    const { page, perPage, offset } = getPaginationParams(req);

    const actionFilter = url.searchParams.get('action');
    const resourceTypeFilter = url.searchParams.get('resourceType');
    const fromDate = url.searchParams.get('from');
    const toDate = url.searchParams.get('to');

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

    const conditions = [inArray(auditLog.userId, memberUserIds)];
    if (actionFilter) conditions.push(eq(auditLog.action, actionFilter));
    if (resourceTypeFilter) conditions.push(eq(auditLog.resourceType, resourceTypeFilter));
    if (fromDate) conditions.push(gte(auditLog.createdAt, new Date(fromDate)));
    if (toDate) conditions.push(lte(auditLog.createdAt, new Date(toDate)));
    const whereClause = and(...conditions);

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
      pagination: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[audit-route] GET error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

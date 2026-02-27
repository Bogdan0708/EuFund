import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { withUserRLS } from '@/lib/db';
import { orgMembers } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth } from '@/lib/auth/helpers';
import { verifyAuditChainIntegrity } from '@/lib/legal/audit-integrity';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'audit-integrity-route' });
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/audit/integrity — admin-only audit chain verification
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth();

    // Require admin role in at least one organization
    const adminMembership = await withUserRLS(user.id, async (tx) => {
      return tx.query.orgMembers.findFirst({
        where: and(
          eq(orgMembers.userId, user.id),
          inArray(orgMembers.role, ['admin', 'org_admin']),
        ),
      });
    });

    if (!adminMembership) {
      throw Errors.forbidden();
    }

    const url = new URL(req.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    const result = await verifyAuditChainIntegrity({
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[audit-integrity] GET error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

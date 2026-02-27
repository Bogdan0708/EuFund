import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db, withUserRLS } from '@/lib/db';
import { featureFlags, orgMembers } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth } from '@/lib/auth/helpers';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';
import { z } from 'zod';

const log = logger.child({ component: 'feature-flags-route' });
export const dynamic = 'force-dynamic';

const createFlagSchema = z.object({
  key: z.string().min(1).max(100).regex(/^[a-z0-9._-]+$/, 'Key must be lowercase alphanumeric with dots, dashes, or underscores'),
  description: z.string().max(1000).optional(),
  enabled: z.boolean().default(false),
  targeting: z.object({
    tiers: z.array(z.string()).optional(),
    userIds: z.array(z.string()).optional(),
    percentage: z.number().min(0).max(100).optional(),
  }).optional(),
});

async function requireAdmin(userId: string): Promise<void> {
  const adminMembership = await withUserRLS(userId, async (tx) => {
    return tx.query.orgMembers.findFirst({
      where: and(
        eq(orgMembers.userId, userId),
        inArray(orgMembers.role, ['admin', 'org_admin']),
      ),
    });
  });

  if (!adminMembership) {
    throw Errors.forbidden();
  }
}

/**
 * GET /api/v1/admin/feature-flags — list all flags
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth();
    await requireAdmin(user.id);

    const flags = await db.select().from(featureFlags);

    return NextResponse.json({ success: true, data: flags });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[feature-flags] GET error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

/**
 * POST /api/v1/admin/feature-flags — create a new flag
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    await requireAdmin(user.id);

    const body = await req.json();
    const parsed = createFlagSchema.safeParse(body);
    if (!parsed.success) {
      throw Errors.validation('body', 'Date invalide.', 'Invalid data.');
    }

    const [created] = await db.insert(featureFlags).values({
      key: parsed.data.key,
      description: parsed.data.description,
      enabled: parsed.data.enabled,
      targeting: parsed.data.targeting ?? {},
      createdBy: user.id,
    }).returning();

    await logAudit({
      userId: user.id,
      action: 'system.feature_flag_change',
      resourceType: 'feature_flag',
      resourceId: created.id,
      newValue: { key: parsed.data.key, enabled: parsed.data.enabled },
    });

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[feature-flags] POST error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

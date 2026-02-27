import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db, withUserRLS } from '@/lib/db';
import { featureFlags, orgMembers } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth } from '@/lib/auth/helpers';
import { logAudit } from '@/lib/legal/audit';
import { invalidateFlagCache } from '@/lib/feature-flags';
import { logger } from '@/lib/logger';
import { z } from 'zod';

const log = logger.child({ component: 'feature-flags-key-route' });
export const dynamic = 'force-dynamic';

const updateFlagSchema = z.object({
  enabled: z.boolean().optional(),
  description: z.string().max(1000).optional(),
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

type RouteParams = { params: Promise<{ key: string }> };

/**
 * PATCH /api/v1/admin/feature-flags/[key] — update a flag
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuth();
    await requireAdmin(user.id);

    const { key } = await params;
    const body = await req.json();
    const parsed = updateFlagSchema.safeParse(body);
    if (!parsed.success) {
      throw Errors.validation('body', 'Date invalide.', 'Invalid data.');
    }

    const [existing] = await db
      .select()
      .from(featureFlags)
      .where(eq(featureFlags.key, key))
      .limit(1);

    if (!existing) {
      throw Errors.notFound('feature_flag', key);
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled;
    if (parsed.data.description !== undefined) updates.description = parsed.data.description;
    if (parsed.data.targeting !== undefined) updates.targeting = parsed.data.targeting;

    const [updated] = await db
      .update(featureFlags)
      .set(updates)
      .where(eq(featureFlags.key, key))
      .returning();

    invalidateFlagCache(key);

    await logAudit({
      userId: user.id,
      action: 'system.feature_flag_change',
      resourceType: 'feature_flag',
      resourceId: existing.id,
      oldValue: { enabled: existing.enabled, targeting: existing.targeting },
      newValue: { enabled: updated.enabled, targeting: updated.targeting },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[feature-flags] PATCH error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

/**
 * DELETE /api/v1/admin/feature-flags/[key] — delete a flag
 */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuth();
    await requireAdmin(user.id);

    const { key } = await params;

    const [existing] = await db
      .select()
      .from(featureFlags)
      .where(eq(featureFlags.key, key))
      .limit(1);

    if (!existing) {
      throw Errors.notFound('feature_flag', key);
    }

    await db.delete(featureFlags).where(eq(featureFlags.key, key));
    invalidateFlagCache(key);

    await logAudit({
      userId: user.id,
      action: 'system.feature_flag_change',
      resourceType: 'feature_flag',
      resourceId: existing.id,
      oldValue: { key: existing.key, enabled: existing.enabled },
      metadata: { action: 'deleted' },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[feature-flags] DELETE error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

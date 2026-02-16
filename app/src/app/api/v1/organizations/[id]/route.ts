// ─── Organization Detail API ─────────────────────────────────────
// GET    /api/v1/organizations/[id] - Get organization details
// PUT    /api/v1/organizations/[id] - Update organization
// DELETE /api/v1/organizations/[id] - Soft delete organization

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { organizations, orgMembers } from '@/lib/db/schema';
import { organizationSchema } from '@/lib/validators';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth, requireOrgRole } from '@/lib/auth/helpers';
import { logAudit, sanitizeForAudit } from '@/lib/legal/audit';
import { eq, and, isNull } from 'drizzle-orm';
import { logger } from '@/lib/logger';

type Params = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = params;

    await requireOrgRole(user.id, id, 'viewer');

    const org = await db.query.organizations.findFirst({
      where: and(eq(organizations.id, id), isNull(organizations.deletedAt)),
    });

    if (!org) {
      throw Errors.notFound('organization', id);
    }

    // Get members list
    const members = await db
      .select({
        id: orgMembers.id,
        userId: orgMembers.userId,
        role: orgMembers.role,
        joinedAt: orgMembers.joinedAt,
      })
      .from(orgMembers)
      .where(eq(orgMembers.orgId, id));

    return NextResponse.json({
      success: true,
      data: { ...org, members },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    logger.error({ error: error }, '[organizations:get]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = params;

    await requireOrgRole(user.id, id, 'org_admin');

    const body = await req.json();
    const parsed = organizationSchema.partial().safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      return NextResponse.json(
        Errors.validation(firstError.path.join('.'), firstError.message, firstError.message).toResponse('ro'),
        { status: 400 },
      );
    }

    const existing = await db.query.organizations.findFirst({
      where: and(eq(organizations.id, id), isNull(organizations.deletedAt)),
    });

    if (!existing) {
      throw Errors.notFound('organization', id);
    }

    const [updated] = await db
      .update(organizations)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(organizations.id, id))
      .returning();

    await logAudit({
      userId: user.id,
      action: 'organization.update',
      resourceType: 'organization',
      resourceId: id,
      oldValue: sanitizeForAudit(existing as any),
      newValue: sanitizeForAudit(parsed.data as any),
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    logger.error({ error: error }, '[organizations:update]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = params;

    await requireOrgRole(user.id, id, 'org_admin');

    const existing = await db.query.organizations.findFirst({
      where: and(eq(organizations.id, id), isNull(organizations.deletedAt)),
    });

    if (!existing) {
      throw Errors.notFound('organization', id);
    }

    // Soft delete
    await db
      .update(organizations)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(organizations.id, id));

    await logAudit({
      userId: user.id,
      action: 'organization.delete',
      resourceType: 'organization',
      resourceId: id,
    });

    return NextResponse.json({ success: true, message: 'Organizația a fost ștearsă.' });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    logger.error({ error: error }, '[organizations:delete]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

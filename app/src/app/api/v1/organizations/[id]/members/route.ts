// ─── Organization Members API ────────────────────────────────────
// GET  /api/v1/organizations/[id]/members - List members
// POST /api/v1/organizations/[id]/members - Add member
// DELETE via body { userId } - Remove member

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { orgMembers, users } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { withAuthScope, requireOrgRole } from '@/lib/auth/helpers';
import { logAudit } from '@/lib/legal/audit';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';

type Params = { params: { id: string } };

const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['org_admin', 'project_manager', 'viewer']).default('viewer'),
});

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = params;
    return await withAuthScope(async (user) => {
      await requireOrgRole(user.id, id, 'viewer');

      const members = await db
        .select({
          id: orgMembers.id,
          userId: orgMembers.userId,
          role: orgMembers.role,
          joinedAt: orgMembers.joinedAt,
          email: users.email,
          fullName: users.fullName,
        })
        .from(orgMembers)
        .innerJoin(users, eq(orgMembers.userId, users.id))
        .where(eq(orgMembers.orgId, id));

      return NextResponse.json({ success: true, data: members });
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = params;
    let auditData: Parameters<typeof logAudit>[0] | undefined;

    const response = await withAuthScope(async (user) => {
      await requireOrgRole(user.id, id, 'org_admin');

      const body = await req.json();
      const parsed = addMemberSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          Errors.validation('body', 'Date invalide', 'Invalid input').toResponse('ro'),
          { status: 400 },
        );
      }

      // Find user by email
      const targetUser = await db.query.users.findFirst({
        where: eq(users.email, parsed.data.email),
      });

      if (!targetUser) {
        return NextResponse.json(
          Errors.notFound('user').toResponse('ro'),
          { status: 404 },
        );
      }

      // Check if already a member
      const existing = await db.query.orgMembers.findFirst({
        where: and(eq(orgMembers.orgId, id), eq(orgMembers.userId, targetUser.id)),
      });

      if (existing) {
        return NextResponse.json(
          Errors.validation('email', 'Utilizatorul este deja membru.', 'User is already a member.').toResponse('ro'),
          { status: 409 },
        );
      }

      const [member] = await db.insert(orgMembers).values({
        orgId: id,
        userId: targetUser.id,
        role: parsed.data.role,
        invitedBy: user.id,
      }).returning();

      auditData = {
        userId: user.id,
        action: 'organization.member_add',
        resourceType: 'organization',
        resourceId: id,
        metadata: { addedUserId: targetUser.id, role: parsed.data.role },
      };

      return NextResponse.json({ success: true, data: member }, { status: 201 });
    });

    if (auditData) {
      await logAudit(auditData);
    }

    return response;
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

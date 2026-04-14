// ─── Auth Helper Utilities ───────────────────────────────────────
import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { db, withUserRLS } from '@/lib/db';
import { users, orgMembers, organizations } from '@/lib/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { Errors } from '@/lib/errors';

export type OrgRole = 'admin' | 'org_admin' | 'project_manager' | 'viewer';

const ROLE_RANK: Record<OrgRole, number> = {
  admin: 4,
  org_admin: 3,
  project_manager: 2,
  viewer: 1,
};

export interface SessionUser {
  id: string;
  email: string;
  name?: string;
  isPlatformAdmin?: boolean;
}

type SessionUserWithFlags = {
  isPlatformAdmin?: boolean;
};

/**
 * Get the authenticated user from the session, or throw 401
 */
export async function requireAuth(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.email || !session?.user?.id) {
    throw Errors.unauthorized();
  }
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name || undefined,
    isPlatformAdmin: (session.user as SessionUserWithFlags).isPlatformAdmin || false,
  };
}

/**
 * Require platform admin privileges, or throw 403
 */
export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await requireAuth();

  // Always verify against database to prevent stale-session privilege drift.
  const dbUser = await withUserRLS(user.id, async (tx) => {
    return tx.query.users.findFirst({
      where: eq(users.id, user.id),
    });
  });

  if (!dbUser?.isPlatformAdmin) {
    throw Errors.forbidden();
  }

  return { ...user, isPlatformAdmin: true };
}

/**
 * Require the caller to be a member of the given organization.
 * Optionally checks that the member's role meets a minimum rank.
 *
 * NOTE: Uses `db` directly (not `withUserRLS`) because the caller
 * may not yet be a member and RLS would hide the row.
 */
export async function requireOrgMembership(
  orgId: string,
  minRole?: OrgRole,
): Promise<{ user: SessionUser; membership: { id: string; orgId: string; userId: string; role: OrgRole } }> {
  const user = await requireAuth();

  // Verify org exists and is not soft-deleted
  const org = await db.query.organizations.findFirst({
    where: and(eq(organizations.id, orgId), isNull(organizations.deletedAt)),
    columns: { id: true },
  });

  if (!org) {
    throw Errors.forbidden();
  }

  const membership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, user.id)),
  });

  if (!membership) {
    throw Errors.forbidden();
  }

  if (minRole && ROLE_RANK[membership.role as OrgRole] < ROLE_RANK[minRole]) {
    throw Errors.forbidden();
  }

  return {
    user,
    membership: {
      id: membership.id,
      orgId: membership.orgId,
      userId: membership.userId,
      role: membership.role as OrgRole,
    },
  };
}

/**
 * Extract pagination params from request URL
 */
export function getPaginationParams(req: NextRequest) {
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const perPage = Math.min(100, Math.max(1, parseInt(url.searchParams.get('perPage') || '20', 10)));
  const offset = (page - 1) * perPage;
  return { page, perPage, offset };
}

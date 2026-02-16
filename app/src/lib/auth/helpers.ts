// ─── Auth Helper Utilities ───────────────────────────────────────
import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { orgMembers } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { Errors } from '@/lib/errors';

export type UserRole = 'admin' | 'org_admin' | 'project_manager' | 'viewer';

export interface SessionUser {
  id: string;
  email: string;
  name?: string;
}

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
  };
}

/**
 * Check if user has at least the required role in an organization
 */
export async function requireOrgRole(
  userId: string,
  orgId: string,
  minRole: UserRole = 'viewer',
): Promise<UserRole> {
  const roleHierarchy: Record<UserRole, number> = {
    admin: 4,
    org_admin: 3,
    project_manager: 2,
    viewer: 1,
  };

  const membership = await db.query.orgMembers.findFirst({
    where: and(
      eq(orgMembers.orgId, orgId),
      eq(orgMembers.userId, userId),
    ),
  });

  if (!membership) {
    throw Errors.forbidden();
  }

  const userRoleLevel = roleHierarchy[membership.role as UserRole] || 0;
  const requiredLevel = roleHierarchy[minRole];

  if (userRoleLevel < requiredLevel) {
    throw Errors.forbidden();
  }

  return membership.role as UserRole;
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

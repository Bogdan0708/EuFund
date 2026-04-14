// ─── Auth Helper Utilities ───────────────────────────────────────
import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { withUserRLS } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { Errors } from '@/lib/errors';

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
 * Extract pagination params from request URL
 */
export function getPaginationParams(req: NextRequest) {
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const perPage = Math.min(100, Math.max(1, parseInt(url.searchParams.get('perPage') || '20', 10)));
  const offset = (page - 1) * perPage;
  return { page, perPage, offset };
}

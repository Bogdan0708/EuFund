import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { orgMembers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

/**
 * Get current user from session, or null if not authenticated
 */
export async function getUser(): Promise<AuthUser | null> {
  const session = await auth();
  if (!session?.user?.email) return null;
  return {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    id: (session.user as any).id,
    email: session.user.email,
    name: session.user.name || null,
  };
}

/**
 * Get current user or throw (for protected server components/actions)
 */
export async function requireUser(): Promise<AuthUser> {
  const user = await getUser();
  if (!user) {
    throw new Error('Authentication required');
  }
  return user;
}

/**
 * Get all organizations the user is a member of, with their role
 */
export async function getUserOrganizations(userId: string) {
  const memberships = await db.query.orgMembers.findMany({
    where: eq(orgMembers.userId, userId),
    with: {
      organization: true,
    },
  });

  return memberships.map((m) => ({
    ...m.organization,
    role: m.role,
  }));
}

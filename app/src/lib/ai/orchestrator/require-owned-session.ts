import { db } from '@/lib/db';
import { workflowSessions } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireAuth, type SessionUser } from '@/lib/auth/helpers';
import { Errors } from '@/lib/errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Authenticates the caller and verifies they own the session identified by
 * sessionId. Centralizes the auth + UUID validation + ownership check used
 * by Phase 1 section versioning endpoints (GET versions, POST state,
 * POST rollback).
 *
 * Throws:
 * - Errors.unauthorized()   — no session cookie (propagated from requireAuth)
 * - Errors.validation(...)  — sessionId is not a valid UUID
 * - Errors.notFound(...)    — session doesn't exist OR belongs to another user
 *                             (single 404 to avoid leaking session existence)
 */
export async function requireOwnedSession(sessionId: string): Promise<{
  user: SessionUser;
  session: typeof workflowSessions.$inferSelect;
}> {
  const user = await requireAuth();

  if (!UUID_RE.test(sessionId)) {
    throw Errors.validation('sessionId', 'ID de sesiune invalid', 'Invalid session ID');
  }

  const [session] = await db
    .select()
    .from(workflowSessions)
    .where(and(eq(workflowSessions.id, sessionId), eq(workflowSessions.userId, user.id)))
    .limit(1);

  if (!session) {
    throw Errors.notFound('session', sessionId);
  }

  return { user, session };
}

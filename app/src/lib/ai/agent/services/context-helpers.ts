import { db } from '@/lib/db'
import { agentSessions } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { NotFoundError } from './errors'
import type { ToolContext } from '../types'
import type { ServiceContext } from './types'

export function buildServiceContextFromToolCtx(toolCtx: ToolContext): ServiceContext {
  return {
    userId: toolCtx.userId,
    sessionId: toolCtx.sessionId,
    organizationId: (toolCtx.session as any).organizationId ?? undefined,
    projectId: toolCtx.session.projectId ?? undefined,
    requestId: toolCtx.requestId,
    now: new Date(),
  }
}

/**
 * Verifies that the session exists AND is owned by ctx.userId.
 * Returns the full session row. Throws NotFoundError if the session
 * is missing or owned by another user.
 *
 * This is the canonical ownership check for all Phase 3 service
 * mutations. Do not inline equivalent logic in individual services.
 */
export async function verifySessionOwnership(
  ctx: ServiceContext,
  sessionId: string,
): Promise<typeof agentSessions.$inferSelect> {
  const rows = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, ctx.userId)))
    .limit(1)

  if (!rows[0]) {
    throw new NotFoundError('session', sessionId)
  }

  return rows[0]
}

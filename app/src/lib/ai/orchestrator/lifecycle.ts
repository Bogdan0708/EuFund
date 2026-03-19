import { db } from '@/lib/db'
import { workflowSessions } from '@/lib/db/schema'
import { eq, and, lt, sql, asc } from 'drizzle-orm'
import { getTierLimits } from '@/lib/billing/tiers'

export async function enforceMaxSessions(userId: string, tier: string): Promise<void> {
  const limits = getTierLimits(tier)
  const activeSessions = await db
    .select()
    .from(workflowSessions)
    .where(and(
      eq(workflowSessions.userId, userId),
      sql`${workflowSessions.status} IN ('active', 'paused')`
    ))
    .orderBy(asc(workflowSessions.updatedAt))

  if (activeSessions.length >= limits.maxActiveSessions) {
    const toPause = activeSessions.slice(0, activeSessions.length - limits.maxActiveSessions + 1)
    for (const session of toPause) {
      await db.update(workflowSessions)
        .set({ status: 'paused', updatedAt: new Date() })
        .where(eq(workflowSessions.id, session.id))
    }
  }
}

export async function cleanupAbandonedSessions(): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const abandoned = await db
    .select({ id: workflowSessions.id })
    .from(workflowSessions)
    .where(and(
      sql`${workflowSessions.status} IN ('active', 'paused')`,
      lt(workflowSessions.updatedAt, sevenDaysAgo)
    ))

  for (const session of abandoned) {
    await db.update(workflowSessions)
      .set({ status: 'abandoned', updatedAt: new Date() })
      .where(eq(workflowSessions.id, session.id))
  }
  return abandoned.length
}

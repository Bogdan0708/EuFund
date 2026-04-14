// ── application_agent_sessions upsert + observability updates ──
// Row is created lazily on first managed attempt (including
// pre-stream V3 fallback). On success, last_turn_* columns are
// updated. On failure, degraded_at + degraded_reason are set.

import { db } from '@/lib/db'
import { applicationAgentSessions } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import type { DegradedReason } from './circuit-breaker'

export async function ensureAppAgentSession(
  sessionId: string,
  userId: string,
  createdWithFlag: boolean,
): Promise<void> {
  const [existing] = await db.select()
    .from(applicationAgentSessions)
    .where(and(
      eq(applicationAgentSessions.sessionId, sessionId),
      eq(applicationAgentSessions.userId, userId),
    ))
    .limit(1)

  if (existing) {
    await db.update(applicationAgentSessions)
      .set({ updatedAt: new Date() })
      .where(eq(applicationAgentSessions.id, existing.id))
    return
  }

  await db.insert(applicationAgentSessions).values({
    sessionId,
    userId,
    runtimeMode: 'managed',
    createdWithFlag,
    status: 'active',
  })
}

export async function markDegraded(
  sessionId: string,
  userId: string,
  reason: DegradedReason,
): Promise<void> {
  await db.update(applicationAgentSessions)
    .set({
      degradedAt: new Date(),
      degradedReason: reason,
      updatedAt: new Date(),
    })
    .where(and(
      eq(applicationAgentSessions.sessionId, sessionId),
      eq(applicationAgentSessions.userId, userId),
    ))
}

export async function recordTurnSuccess(
  sessionId: string,
  userId: string,
  model: string | null,
  toolCount: number,
): Promise<void> {
  await db.update(applicationAgentSessions)
    .set({
      lastTurnAt: new Date(),
      lastTurnModel: model,
      lastTurnToolCount: toolCount,
      updatedAt: new Date(),
    })
    .where(and(
      eq(applicationAgentSessions.sessionId, sessionId),
      eq(applicationAgentSessions.userId, userId),
    ))
}

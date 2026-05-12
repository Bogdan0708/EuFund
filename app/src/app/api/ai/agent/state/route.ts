// app/src/app/api/ai/agent/state/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { agentSessions, agentSections } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { projectSessionState } from '@/lib/ai/agent/state-projection'
import type { AgentSession, AgentSection } from '@/lib/ai/agent/types'

export async function GET(req: NextRequest) {
  const user = await requireAuth()

  const sessionId = req.nextUrl.searchParams.get('sessionId')
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId parameter' }, { status: 400 })
  }

  const [session] = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, user.id)))
    .limit(1)

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const sectionRows = await db
    .select()
    .from(agentSections)
    .where(eq(agentSections.sessionId, sessionId))

  const state = projectSessionState(session as AgentSession, sectionRows as AgentSection[])
  return NextResponse.json(state)
}

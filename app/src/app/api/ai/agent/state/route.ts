// app/src/app/api/ai/agent/state/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import type { UIStateSnapshot } from '@/lib/ai/agent/types'
import { db } from '@/lib/db'
import { agentSessions, agentSections } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

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

  const state: UIStateSnapshot = {
    sessionId: session.id,
    phase: session.currentPhase,
    stateVersion: session.stateVersion,
    warnings: (session.warnings as UIStateSnapshot['warnings']) || [],
    sections: sectionRows.map(s => ({
      sectionKey: s.sectionKey,
      title: s.title,
      status: s.status,
      documentOrder: s.documentOrder,
    })),
    blueprint: session.blueprint as UIStateSnapshot['blueprint'],
    eligibility: session.eligibility as UIStateSnapshot['eligibility'],
  }

  return NextResponse.json(state)
}

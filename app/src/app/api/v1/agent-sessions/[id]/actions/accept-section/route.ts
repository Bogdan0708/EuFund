// POST /api/v1/agent-sessions/[id]/actions/accept-section
//
// Approves a drafted section, advancing it to approved status. Returns
// an updated UIStateSnapshot.
//
// Requires: session ownership, session must be active, outline must be
// frozen, section must be in draft state.

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireAuth } from '@/lib/auth/helpers'
import { acceptSectionBody } from '@/lib/validation/agent-actions'
import { approveSection } from '@/lib/ai/agent/services/sections'
import { projectSessionState } from '@/lib/ai/agent/state-projection'
import { db } from '@/lib/db'
import { agentSessions, agentSections } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { errorToResponse } from '@/lib/api/agent-action-envelope'
import type { AgentSession, AgentSection } from '@/lib/ai/agent/types'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: RouteParams) {
  const user = await requireAuth()
  const { id: sessionId } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'BAD_JSON',
          messageRo: 'Corpul cererii nu este JSON valid.',
          messageEn: 'Request body is not valid JSON.',
        },
      },
      { status: 400 },
    )
  }

  const parsed = acceptSectionBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'BAD_REQUEST',
          messageRo: 'Cerere invalidă.',
          messageEn: 'Bad request.',
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    )
  }

  try {
    await approveSection(
      {
        userId: user.id,
        sessionId,
        requestId: randomUUID(),
        now: new Date(),
      },
      {
        sessionId,
        sectionKey: parsed.data.sectionKey,
        expectedStateVersion: parsed.data.expectedStateVersion,
      },
    )
  } catch (err) {
    return errorToResponse(err)
  }

  // Return updated UIStateSnapshot
  const sessionRows = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, user.id)))
    .limit(1)

  const session = sessionRows[0]
  if (!session) {
    return NextResponse.json(
      {
        error: {
          code: 'NOT_FOUND',
          messageRo: 'Sesiune inexistentă.',
          messageEn: 'Session not found.',
        },
      },
      { status: 404 },
    )
  }

  const sectionRows = await db
    .select()
    .from(agentSections)
    .where(eq(agentSections.sessionId, sessionId))

  return NextResponse.json(
    projectSessionState(session as AgentSession, sectionRows as AgentSection[]),
  )
}

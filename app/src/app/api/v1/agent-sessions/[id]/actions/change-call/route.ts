// POST /api/v1/agent-sessions/[id]/actions/change-call
//
// Switches the selected call for an active session. Deletes all existing
// section rows (they belong to the old call), resets the outline and
// blueprint, and returns an updated UIStateSnapshot.
//
// Requires: session ownership, session must be active, outline must not
// be frozen, and the new callId must exist in the vector store.

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireAuth } from '@/lib/auth/helpers'
import { changeCallBody } from '@/lib/validation/agent-actions'
import { changeCall } from '@/lib/ai/agent/services/change-call'
import { projectSessionState } from '@/lib/ai/agent/state-projection'
import { db } from '@/lib/db'
import { agentSections } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { errorToResponse, requireDeterministicActionsEnabled } from '@/lib/api/agent-action-envelope'
import type { AgentSection } from '@/lib/ai/agent/types'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: RouteParams) {
  const user = await requireAuth()
  const flagResponse = await requireDeterministicActionsEnabled(user.id)
  if (flagResponse) return flagResponse

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

  const parsed = changeCallBody.safeParse(body)
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

  let result
  try {
    result = await changeCall(
      {
        userId: user.id,
        sessionId,
        requestId: randomUUID(),
        now: new Date(),
      },
      {
        sessionId,
        newCallId: parsed.data.newCallId,
        expectedStateVersion: parsed.data.expectedStateVersion,
      },
    )
  } catch (err) {
    return errorToResponse(err)
  }

  // changeCall already returns the updated session — no need to re-read it.
  // Sections are deleted by the service, so this query returns [].
  const sectionRows = await db
    .select()
    .from(agentSections)
    .where(eq(agentSections.sessionId, sessionId))

  return NextResponse.json(
    projectSessionState(result.session, sectionRows as AgentSection[]),
  )
}

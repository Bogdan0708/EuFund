import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { agentSessions, agentSections } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TERMINAL_STATUSES = ['completed', 'abandoned']

// User-allowed state transitions
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ['accepted', 'needs_review'],
  needs_review: ['accepted', 'draft'],
  accepted: ['draft'],
}

type Params = { params: { sessionId: string; sectionId: string } }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    const { sessionId, sectionId } = params

    if (!UUID_RE.test(sessionId) || !UUID_RE.test(sectionId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 })
    }

    let body: Record<string, unknown>
    try { body = await req.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const targetStatus = body?.status
    if (typeof targetStatus !== 'string') {
      return NextResponse.json({ error: 'status is required' }, { status: 400 })
    }

    // Verify session ownership and status
    const session = await db.query.agentSessions.findFirst({
      where: and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, user.id)),
    })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    if (TERMINAL_STATUSES.includes(session.status)) {
      return NextResponse.json({ error: 'Session is not active' }, { status: 409 })
    }

    // Verify section belongs to session
    const section = await db.query.agentSections.findFirst({
      where: and(eq(agentSections.id, sectionId), eq(agentSections.sessionId, sessionId)),
    })
    if (!section) {
      return NextResponse.json({ error: 'Section not found' }, { status: 404 })
    }

    // Validate transition
    const allowed = ALLOWED_TRANSITIONS[section.status]
    if (!allowed || !allowed.includes(targetStatus)) {
      return NextResponse.json(
        { error: `Cannot transition from '${section.status}' to '${targetStatus}'` },
        { status: 400 },
      )
    }

    // Apply transition
    const [updated] = await db
      .update(agentSections)
      .set({ status: targetStatus as typeof section.status, updatedAt: new Date() })
      .where(eq(agentSections.id, sectionId))
      .returning()

    return NextResponse.json({ success: true, data: updated })
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      const e = error as { statusCode: number; toResponse?: (l: string) => unknown }
      return NextResponse.json(
        e.toResponse ? e.toResponse('ro') : { error: 'Error' },
        { status: e.statusCode },
      )
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

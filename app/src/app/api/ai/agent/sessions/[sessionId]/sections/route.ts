import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { agentSessions, agentSections } from '@/lib/db/schema'
import { eq, and, asc, sql } from 'drizzle-orm'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Params = { params: { sessionId: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    const { sessionId } = params

    if (!UUID_RE.test(sessionId)) {
      return NextResponse.json({ error: 'Invalid sessionId format' }, { status: 400 })
    }

    const session = await db.query.agentSessions.findFirst({
      where: and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, user.id)),
    })

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const rows = await db
      .select({
        id: agentSections.id,
        sectionKey: agentSections.sectionKey,
        title: agentSections.title,
        status: agentSections.status,
        documentOrder: agentSections.documentOrder,
        versionCount: sql<number>`(SELECT count(*) FROM agent_section_versions WHERE section_id = ${agentSections.id})`.as('version_count'),
        updatedAt: agentSections.updatedAt,
      })
      .from(agentSections)
      .where(eq(agentSections.sessionId, sessionId))
      .orderBy(asc(agentSections.documentOrder))

    return NextResponse.json({ success: true, data: rows })
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

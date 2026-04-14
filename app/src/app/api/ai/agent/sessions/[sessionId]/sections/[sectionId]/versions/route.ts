import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { agentSessions, agentSections, agentSectionVersions } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Params = { params: { sessionId: string; sectionId: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    const { sessionId, sectionId } = params

    if (!UUID_RE.test(sessionId) || !UUID_RE.test(sectionId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 })
    }

    const session = await db.query.agentSessions.findFirst({
      where: and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, user.id)),
    })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const section = await db.query.agentSections.findFirst({
      where: and(eq(agentSections.id, sectionId), eq(agentSections.sessionId, sessionId)),
    })
    if (!section) {
      return NextResponse.json({ error: 'Section not found' }, { status: 404 })
    }

    const rows = await db
      .select({
        id: agentSectionVersions.id,
        versionNumber: agentSectionVersions.versionNumber,
        kind: agentSectionVersions.kind,
        content: agentSectionVersions.content,
        modelUsed: agentSectionVersions.modelUsed,
        sourcesUsed: agentSectionVersions.sourcesUsed,
        createdAt: agentSectionVersions.createdAt,
      })
      .from(agentSectionVersions)
      .where(eq(agentSectionVersions.sectionId, sectionId))
      .orderBy(desc(agentSectionVersions.versionNumber))

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

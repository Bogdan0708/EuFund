import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { agentSessions, agentMessages } from '@/lib/db/schema'
import { eq, and, isNull, asc } from 'drizzle-orm'

type Params = { params: { sessionId: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    const { sessionId } = params

    // Validate sessionId format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
      return NextResponse.json({ error: 'Invalid sessionId format' }, { status: 400 })
    }

    // Verify session exists and belongs to user
    const session = await db.query.agentSessions.findFirst({
      where: and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, user.id)),
    })

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Load non-compacted messages in order
    const rows = await db
      .select({
        id: agentMessages.id,
        role: agentMessages.role,
        content: agentMessages.content,
        toolName: agentMessages.toolName,
        toolCallId: agentMessages.toolCallId,
        createdAt: agentMessages.createdAt,
      })
      .from(agentMessages)
      .where(and(
        eq(agentMessages.sessionId, sessionId),
        isNull(agentMessages.compactedAt),
      ))
      .orderBy(asc(agentMessages.sequenceNumber))

    return NextResponse.json({
      success: true,
      data: rows.map(r => ({
        ...r,
        content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content),
      })),
    })
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      const e = error as { statusCode: number; toResponse?: (l: string) => unknown }
      return NextResponse.json(
        e.toResponse ? e.toResponse('ro') : { error: 'Unauthorized' },
        { status: e.statusCode },
      )
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

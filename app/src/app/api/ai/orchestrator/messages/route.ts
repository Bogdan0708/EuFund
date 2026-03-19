import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { workflowMessages, workflowSessions } from '@/lib/db/schema'
import { eq, and, asc } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const sessionId = req.nextUrl.searchParams.get('sessionId')

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
    }

    const [session] = await db
      .select()
      .from(workflowSessions)
      .where(and(
        eq(workflowSessions.id, sessionId),
        eq(workflowSessions.userId, user.id)
      ))
      .limit(1)

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const messages = await db
      .select()
      .from(workflowMessages)
      .where(eq(workflowMessages.sessionId, sessionId))
      .orderBy(asc(workflowMessages.createdAt))

    return NextResponse.json({ messages, session })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

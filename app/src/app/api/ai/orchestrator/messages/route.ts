import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { workflowMessages, workflowSessions } from '@/lib/db/schema'
import { eq, and, asc } from 'drizzle-orm'

function tryParseContent(content: string): string {
  try {
    const parsed = JSON.parse(content)
    if (typeof parsed === 'object' && parsed !== null) {
      return Object.entries(parsed)
        .filter(([, v]) => typeof v === 'string' || Array.isArray(v))
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v as string[]).join(', ') : v}`)
        .join('\n') || content
    }
    return content
  } catch {
    return content
  }
}

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

    const transformedMessages = messages.map(msg => ({
      ...msg,
      content: msg.role === 'assistant' ? tryParseContent(msg.content) : msg.content,
      checkpoint: msg.eventType === 'checkpoint' && msg.metadata ? msg.metadata : undefined,
    }))

    return NextResponse.json({ messages: transformedMessages, session })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

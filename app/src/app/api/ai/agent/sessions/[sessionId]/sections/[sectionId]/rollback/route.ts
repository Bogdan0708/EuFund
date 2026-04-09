import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { agentSessions, agentSections, agentSectionVersions } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TERMINAL_STATUSES = ['completed', 'abandoned']

type Params = { params: { sessionId: string; sectionId: string } }

export async function POST(req: NextRequest, { params }: Params) {
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
    const targetVersion = body?.targetVersion as number | undefined
    if (!Number.isInteger(targetVersion) || !targetVersion || targetVersion < 1) {
      return NextResponse.json({ error: 'targetVersion must be a positive integer' }, { status: 400 })
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

    // Execute rollback in a transaction
    const newVersion = await db.transaction(async (tx) => {
      // Get current max version number inside transaction to prevent race
      const [maxRow] = await tx
        .select({ versionNumber: agentSectionVersions.versionNumber })
        .from(agentSectionVersions)
        .where(eq(agentSectionVersions.sectionId, sectionId))
        .orderBy(desc(agentSectionVersions.versionNumber))
        .limit(1)

      const currentMax = maxRow?.versionNumber ?? 0

      // Find target version content
      const [target] = await tx
        .select()
        .from(agentSectionVersions)
        .where(and(
          eq(agentSectionVersions.sectionId, sectionId),
          eq(agentSectionVersions.versionNumber, targetVersion),
        ))

      if (!target) {
        throw Object.assign(new Error('Target version not found'), { statusCode: 400 })
      }

      // Append new version with rolled-back content
      const [inserted] = await tx
        .insert(agentSectionVersions)
        .values({
          sectionId,
          versionNumber: currentMax + 1,
          kind: 'system_rewrite',
          content: target.content,
          modelUsed: target.modelUsed,
          sourcesUsed: target.sourcesUsed,
        })
        .returning()

      // Update section: restore content, reset status, bump updatedAt
      const now = new Date()
      await tx
        .update(agentSections)
        .set({ content: target.content, status: 'draft', updatedAt: now })
        .where(eq(agentSections.id, sectionId))

      // Bump session updatedAt (rollback is a session-visible change)
      await tx
        .update(agentSessions)
        .set({ updatedAt: now })
        .where(eq(agentSessions.id, sessionId))

      return inserted
    })

    return NextResponse.json({ success: true, data: newVersion })
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      const e = error as { statusCode: number; message?: string; toResponse?: (l: string) => unknown }
      return NextResponse.json(
        e.toResponse ? e.toResponse('ro') : { error: e.message || 'Error' },
        { status: e.statusCode },
      )
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

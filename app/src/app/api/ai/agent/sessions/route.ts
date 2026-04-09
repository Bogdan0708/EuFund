import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { agentSessions, projects } from '@/lib/db/schema'
import { eq, and, inArray, desc, sql } from 'drizzle-orm'

type SessionStatus = 'active' | 'paused' | 'completed' | 'abandoned' | 'error'
const VALID_STATUSES: SessionStatus[] = ['active', 'paused', 'completed', 'abandoned', 'error']
const RESUMABLE_STATUSES: SessionStatus[] = ['active', 'paused', 'error']
const MAX_LIMIT = 100
const DEFAULT_LIMIT = 20

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()

    const url = req.nextUrl
    const statusParam = url.searchParams.get('status')
    const projectId = url.searchParams.get('projectId')
    const limitParam = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get('limit') || '', 10) || DEFAULT_LIMIT))

    // Parse status filter — validate against known enum values
    const statuses: SessionStatus[] = statusParam
      ? statusParam.split(',').filter((s): s is SessionStatus => VALID_STATUSES.includes(s as SessionStatus))
      : [...RESUMABLE_STATUSES]

    // Validate projectId is UUID-like if provided
    if (projectId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) {
      return NextResponse.json({ error: 'Invalid projectId format' }, { status: 400 })
    }

    // Build where conditions
    const conditions = [
      eq(agentSessions.userId, user.id),
      inArray(agentSessions.status, statuses),
    ]
    if (projectId) {
      conditions.push(eq(agentSessions.projectId, projectId))
    }

    const rows = await db
      .select({
        id: agentSessions.id,
        projectId: agentSessions.projectId,
        projectTitle: projects.title,
        status: agentSessions.status,
        currentPhase: agentSessions.currentPhase,
        locale: agentSessions.locale,
        selectedCallId: agentSessions.selectedCallId,
        messageSummary: agentSessions.messageSummary,
        stateVersion: agentSessions.stateVersion,
        createdAt: agentSessions.createdAt,
        updatedAt: agentSessions.updatedAt,
        sectionCount: sql<number>`(SELECT count(*) FROM agent_sections WHERE session_id = ${agentSessions.id})`.as('section_count'),
      })
      .from(agentSessions)
      .leftJoin(projects, eq(agentSessions.projectId, projects.id))
      .where(and(...conditions))
      .orderBy(desc(agentSessions.updatedAt))
      .limit(limitParam)

    return NextResponse.json({ success: true, data: rows })
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      const e = error as { statusCode: number; toResponse?: (l: string) => unknown }
      return NextResponse.json(
        e.toResponse ? e.toResponse('ro') : { error: 'Forbidden' },
        { status: e.statusCode },
      )
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { workflowSessions, projects } from '@/lib/db/schema'
import { eq, desc, and } from 'drizzle-orm'

export async function GET(request: Request) {
  try {
    const user = await requireAuth()
    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10), 50)

    const conditions = [eq(workflowSessions.userId, user.id)]
    if (status) {
      conditions.push(eq(workflowSessions.status, status as 'active' | 'paused' | 'completed' | 'abandoned'))
    }

    const sessions = await db
      .select({
        id: workflowSessions.id,
        currentStep: workflowSessions.currentStep,
        status: workflowSessions.status,
        projectId: workflowSessions.projectId,
        projectTitle: projects.title,
        createdAt: workflowSessions.createdAt,
        updatedAt: workflowSessions.updatedAt,
      })
      .from(workflowSessions)
      .leftJoin(projects, eq(workflowSessions.projectId, projects.id))
      .where(and(...conditions))
      .orderBy(desc(workflowSessions.updatedAt))
      .limit(limit)

    return NextResponse.json({ sessions })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { workflowSessions, projects } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'

export async function GET() {
  try {
    const user = await requireAuth()

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
      .where(eq(workflowSessions.userId, user.id))
      .orderBy(desc(workflowSessions.updatedAt))
      .limit(10)

    return NextResponse.json({ sessions })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

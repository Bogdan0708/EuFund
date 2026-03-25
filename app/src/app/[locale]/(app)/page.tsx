import { auth } from '@/lib/auth'
import { withUserRLS } from '@/lib/db'
import { workflowSessions, projects } from '@/lib/db/schema'
import { eq, desc, and, count } from 'drizzle-orm'
import { SmartLanding } from '@/components/landing/SmartLanding'

export default async function HomePage() {
  const session = await auth()
  if (!session?.user?.id) return null

  const userId = session.user.id

  const { activeSession, recentProjects, totalProjects } = await withUserRLS(userId, async (tx) => {
    const [activeSession] = await tx
      .select({
        id: workflowSessions.id,
        currentStep: workflowSessions.currentStep,
        projectTitle: projects.title,
        updatedAt: workflowSessions.updatedAt,
      })
      .from(workflowSessions)
      .leftJoin(projects, eq(workflowSessions.projectId, projects.id))
      .where(and(eq(workflowSessions.userId, userId), eq(workflowSessions.status, 'active')))
      .orderBy(desc(workflowSessions.updatedAt))
      .limit(1)

    const recentProjects = await tx
      .select({ id: projects.id, title: projects.title, status: projects.status })
      .from(projects)
      .where(eq(projects.userId, userId))
      .orderBy(desc(projects.updatedAt))
      .limit(3)

    const [{ value: totalProjects }] = await tx
      .select({ value: count() })
      .from(projects)
      .where(eq(projects.userId, userId))

    return { activeSession, recentProjects, totalProjects }
  })

  return (
    <SmartLanding
      user={{ name: session.user.name }}
      activeSession={activeSession ? {
        ...activeSession,
        projectTitle: activeSession.projectTitle ?? null,
        updatedAt: activeSession.updatedAt.toISOString(),
      } : null}
      recentProjects={recentProjects.map(p => ({
        ...p,
        title: p.title || 'Untitled',
        status: p.status || 'draft',
      }))}
      totalProjects={totalProjects}
      matches={[]}
    />
  )
}

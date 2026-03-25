import { auth } from '@/lib/auth'
import { withUserRLS } from '@/lib/db'
import { projects } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { ProjectGrid } from '@/components/projects/ProjectGrid'

export default async function ProjectsPage() {
  const session = await auth()
  if (!session?.user?.id) return null
  const userId = session.user.id as string

  const userProjects = await withUserRLS(userId, async (tx) => {
    return tx
      .select({ id: projects.id, title: projects.title, status: projects.status, updatedAt: projects.updatedAt })
      .from(projects)
      .where(eq(projects.createdBy, userId))
      .orderBy(desc(projects.updatedAt))
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Proiecte</h1>
      <ProjectGrid projects={userProjects.map(p => ({
        ...p,
        title: p.title || 'Untitled',
        status: p.status || 'draft',
        updatedAt: p.updatedAt?.toISOString() || new Date().toISOString(),
      }))} />
    </div>
  )
}

import { auth } from '@/lib/auth'
import { withUserRLS } from '@/lib/db'
import { projects } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { ProjectDetail } from '@/components/projects/ProjectDetail'

export default async function ProjectDetailPage({ params: { id } }: { params: { id: string } }) {
  const session = await auth()
  if (!session?.user?.id) return null
  const userId = session.user.id

  const [project] = await withUserRLS(userId, async (tx) => {
    return tx
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.createdBy, userId)))
      .limit(1)
  })

  if (!project) notFound()

  return (
    <ProjectDetail project={{
      id: project.id,
      title: project.title || 'Untitled',
      status: project.status || 'draft',
      description: project.sectionSummary || undefined,
      createdAt: project.createdAt?.toISOString() || '',
      updatedAt: project.updatedAt?.toISOString() || '',
    }} />
  )
}

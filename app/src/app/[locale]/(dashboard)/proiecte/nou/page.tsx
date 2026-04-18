import { requireAuth } from '@/lib/auth/helpers'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { NewProjectView } from './NewProjectView'

interface PageProps {
  params: { locale: 'ro' | 'en' }
  searchParams: { session?: string }
}

export default async function NewProjectPage({ params, searchParams }: PageProps) {
  const user = await requireAuth()

  const [preselectFlag, writesFlag] = await Promise.all([
    isFeatureEnabled('deterministic_preselect_enabled', { userId: user.id, bypassCache: true }),
    isFeatureEnabled('managed_agent_writes_enabled', { userId: user.id, bypassCache: true }),
  ])

  return (
    <NewProjectView
      locale={params.locale}
      initialSessionId={searchParams.session}
      preselectEnabled={preselectFlag && writesFlag}
    />
  )
}

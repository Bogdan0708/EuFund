import { requireAuth } from '@/lib/auth/helpers'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { NewProjectView } from './NewProjectView'

interface PageProps {
  params: { locale: 'ro' | 'en' }
  searchParams: { session?: string }
}

export default async function NewProjectPage({ params, searchParams }: PageProps) {
  const user = await requireAuth()

  // Client flag must mirror the route's gate exactly — see the comment on
  // /api/v1/projects/preselect/route.ts for the rationale on all four checks.
  // If the client flag disagrees with the server, the UI dispatches a preselect
  // POST that the route immediately rejects with 404 PRESELECT_DISABLED.
  const managedRuntimeEnabled = process.env.MANAGED_RUNTIME_ENABLED === 'true'
  const [preselectFlag, writesFlag, managedFlag] = await Promise.all([
    isFeatureEnabled('deterministic_preselect_enabled', { userId: user.id, bypassCache: true }),
    isFeatureEnabled('managed_agent_writes_enabled', { userId: user.id, bypassCache: true }),
    isFeatureEnabled('managed_agent_enabled', { userId: user.id, bypassCache: true }),
  ])

  // The /panou hero search hands off the project description via
  // sessionStorage rather than a URL parameter, so it isn't visible here.
  // NewProjectView reads it client-side and pre-fills the chat input.
  return (
    <NewProjectView
      locale={params.locale}
      initialSessionId={searchParams.session}
      preselectEnabled={preselectFlag && writesFlag && managedFlag && managedRuntimeEnabled}
    />
  )
}

'use client'
import { useTranslations, useLocale } from 'next-intl'
import { Search, Shield, Upload } from 'lucide-react'
import { HeroInput } from './HeroInput'
import { QuickStartCard } from './QuickStartCard'
import { ContinueBanner } from './ContinueBanner'
import { ProjectsPreview } from './ProjectsPreview'
import { MatchesPreview } from './MatchesPreview'

interface SmartLandingProps {
  user: { name?: string | null }
  activeSession?: {
    id: string
    currentStep: number
    projectTitle?: string | null
    updatedAt: string
  } | null
  recentProjects: { id: string; title: string; status: string }[]
  totalProjects: number
  matches: { callCode: string; title: string; matchScore: number }[]
}

export function SmartLanding({ user, activeSession, recentProjects, totalProjects, matches }: SmartLandingProps) {
  const t = useTranslations('landing')
  const locale = useLocale()
  const prefix = `/${locale}`
  const isNewUser = totalProjects === 0 && !activeSession
  const firstName = user.name?.split(' ')[0] || ''

  if (isNewUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] gap-8">
        <div className="text-center space-y-3">
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-[var(--text-primary)]">
            {t('welcomeTitle')}
          </h1>
          <p className="text-lg text-[var(--text-secondary)]">{t('welcomeSubtitle')}</p>
        </div>
        <HeroInput large />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-3xl mt-4">
          <QuickStartCard href={`${prefix}/calls`} icon={Search} title={t('quickStart.browseCalls')} description={t('quickStart.browseCallsDesc')} />
          <QuickStartCard href={`${prefix}/calls`} icon={Shield} title={t('quickStart.checkEligibility')} description={t('quickStart.checkEligibilityDesc')} />
          <QuickStartCard href={`${prefix}/files`} icon={Upload} title={t('quickStart.uploadDocs')} description={t('quickStart.uploadDocsDesc')} />
        </div>
      </div>
    )
  }

  const greeting = getGreeting(t, firstName)

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">{greeting}</h1>
      {activeSession && <ContinueBanner session={activeSession} />}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ProjectsPreview projects={recentProjects} total={totalProjects} />
        <MatchesPreview matches={matches} />
      </div>
      <HeroInput large={false} />
    </div>
  )
}

function getGreeting(t: ReturnType<typeof useTranslations>, name: string): string {
  const hour = new Date().getHours()
  if (hour < 12) return t('greetingMorning', { name })
  if (hour < 18) return t('greetingAfternoon', { name })
  return t('greetingEvening', { name })
}

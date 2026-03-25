'use client'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { GlassCard, GlassBadge } from '@/components/glass'
import { normalizeProjectStatus, STATUS_VARIANT } from '@/lib/status-map'

interface ProjectsPreviewProps {
  projects: { id: string; title: string; status: string }[]
  total: number
}

export function ProjectsPreview({ projects, total }: ProjectsPreviewProps) {
  const locale = useLocale()
  const t = useTranslations('landing')

  return (
    <GlassCard hover={false} className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[var(--text-primary)] font-semibold">{t('myProjects')} ({total})</h3>
      </div>
      <div className="flex flex-col gap-2">
        {projects.map(p => {
          const status = normalizeProjectStatus(p.status)
          return (
            <Link key={p.id} href={`/${locale}/projects/${p.id}`} className="flex items-center justify-between py-1.5 hover:bg-[var(--bg-surface-hover)] px-2 -mx-2 rounded-lg transition-colors">
              <span className="text-sm text-[var(--text-primary)] truncate">{p.title}</span>
              <GlassBadge variant={STATUS_VARIANT[status]}>{t(`status.${status}`)}</GlassBadge>
            </Link>
          )
        })}
      </div>
      {total > 3 && (
        <Link href={`/${locale}/projects`} className="block mt-3 text-sm text-[var(--accent)] hover:underline">
          {t('viewAll')} →
        </Link>
      )}
    </GlassCard>
  )
}

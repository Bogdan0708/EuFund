'use client'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { DsCard } from '@/components/ui/ds-card'
import { StatusBadge } from '@/components/ui/status-badge'

interface ProjectsPreviewProps {
  projects: { id: string; title: string; status: string }[]
  total: number
}

export function ProjectsPreview({ projects, total }: ProjectsPreviewProps) {
  const locale = useLocale()
  const t = useTranslations('landing')

  return (
    <DsCard className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-on-surface font-semibold">{t('myProjects')} ({total})</h3>
      </div>
      <div className="flex flex-col gap-2">
        {projects.map(p => (
          <Link key={p.id} href={`/${locale}/projects/${p.id}`} className="flex items-center justify-between py-1.5 hover:bg-surface-container-high px-2 -mx-2 rounded-lg transition-colors">
            <span className="text-sm text-on-surface truncate">{p.title}</span>
            <StatusBadge kind="project" value={p.status} />
          </Link>
        ))}
      </div>
      {total > 3 && (
        <Link href={`/${locale}/projects`} className="block mt-3 text-sm text-primary hover:underline">
          {t('viewAll')} &rarr;
        </Link>
      )}
    </DsCard>
  )
}

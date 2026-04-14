'use client'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { DsCard } from '@/components/ui/ds-card'
import { StatusBadge } from '@/components/ui/status-badge'
import { Icon } from '@/components/ui/ds-icon'

interface ProjectCardProps {
  project: { id: string; title: string; status: string; updatedAt: string }
}

export function ProjectCard({ project }: ProjectCardProps) {
  const locale = useLocale()
  const t = useTranslations('projects')

  return (
    <Link href={`/${locale}/projects/${project.id}`}>
      <DsCard className="p-5 flex flex-col gap-3 h-full hover:shadow-lg transition-shadow cursor-pointer">
        <div className="flex items-start justify-between">
          <Icon name="folder_open" size="md" className="text-primary shrink-0" />
          <StatusBadge kind="project" value={project.status} />
        </div>
        <h3 className="text-on-surface font-semibold text-base line-clamp-2">{project.title || t('untitled')}</h3>
        <p className="text-outline text-xs mt-auto">
          {new Date(project.updatedAt).toLocaleDateString(locale === 'ro' ? 'ro-RO' : 'en-US')}
        </p>
      </DsCard>
    </Link>
  )
}

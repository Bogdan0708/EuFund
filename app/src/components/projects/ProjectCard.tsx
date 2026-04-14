'use client'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { GlassCard, GlassBadge } from '@/components/glass'
import { normalizeProjectStatus, STATUS_VARIANT } from '@/lib/status-map'
import { FolderOpen } from 'lucide-react'

interface ProjectCardProps {
  project: { id: string; title: string; status: string; updatedAt: string }
}

export function ProjectCard({ project }: ProjectCardProps) {
  const locale = useLocale()
  const t = useTranslations('projects')
  const status = normalizeProjectStatus(project.status)

  return (
    <Link href={`/${locale}/projects/${project.id}`}>
      <GlassCard className="p-5 flex flex-col gap-3 h-full">
        <div className="flex items-start justify-between">
          <FolderOpen size={20} className="text-[var(--accent)] shrink-0" />
          <GlassBadge variant={STATUS_VARIANT[status]}>{t(`status.${status}`)}</GlassBadge>
        </div>
        <h3 className="text-[var(--text-primary)] font-semibold text-base line-clamp-2">{project.title || t('untitled')}</h3>
        <p className="text-[var(--text-tertiary)] text-xs mt-auto">
          {new Date(project.updatedAt).toLocaleDateString(locale === 'ro' ? 'ro-RO' : 'en-US')}
        </p>
      </GlassCard>
    </Link>
  )
}

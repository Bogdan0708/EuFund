'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { GlassCard, GlassBadge, GlassChip } from '@/components/glass'
import { normalizeProjectStatus, STATUS_VARIANT } from '@/lib/status-map'

interface ProjectDetailProps {
  project: { id: string; title: string; status: string; description?: string; createdAt: string; updatedAt: string }
}

export function ProjectDetail({ project }: ProjectDetailProps) {
  const t = useTranslations('projects')
  const [activeTab, setActiveTab] = useState<'sections' | 'files' | 'history'>('sections')
  const status = normalizeProjectStatus(project.status)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{project.title || t('untitled')}</h1>
          <p className="text-[var(--text-tertiary)] text-sm mt-1">
            {t('lastUpdated')}: {new Date(project.updatedAt).toLocaleDateString()}
          </p>
        </div>
        <GlassBadge variant={STATUS_VARIANT[status]}>{t(`status.${status}`)}</GlassBadge>
      </div>

      <div className="flex gap-2">
        <GlassChip active={activeTab === 'sections'} onClick={() => setActiveTab('sections')}>{t('tabs.sections')}</GlassChip>
        <GlassChip active={activeTab === 'files'} onClick={() => setActiveTab('files')}>{t('tabs.files')}</GlassChip>
        <GlassChip active={activeTab === 'history'} onClick={() => setActiveTab('history')}>{t('tabs.history')}</GlassChip>
      </div>

      <GlassCard hover={false} className="p-6 min-h-[300px]">
        {activeTab === 'sections' && (
          <p className="text-[var(--text-tertiary)]">{t('sectionsPlaceholder')}</p>
        )}
        {activeTab === 'files' && (
          <p className="text-[var(--text-tertiary)]">{t('filesPlaceholder')}</p>
        )}
        {activeTab === 'history' && (
          <p className="text-[var(--text-tertiary)]">{t('historyPlaceholder')}</p>
        )}
      </GlassCard>
    </div>
  )
}

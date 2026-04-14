'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { DsCard } from '@/components/ui/ds-card'
import { DsChip } from '@/components/ui/ds-chip'
import { StatusBadge } from '@/components/ui/status-badge'

interface ProjectDetailProps {
  project: { id: string; title: string; status: string; description?: string; createdAt: string; updatedAt: string }
}

export function ProjectDetail({ project }: ProjectDetailProps) {
  const t = useTranslations('projects')
  const [activeTab, setActiveTab] = useState<'sections' | 'files' | 'history'>('sections')

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-on-surface">{project.title || t('untitled')}</h1>
          <p className="text-outline text-sm mt-1">
            {t('lastUpdated')}: {new Date(project.updatedAt).toLocaleDateString()}
          </p>
        </div>
        <StatusBadge kind="project" value={project.status} />
      </div>

      <div className="flex gap-2">
        <DsChip variant={activeTab === 'sections' ? 'selected' : 'default'} onClick={() => setActiveTab('sections')}>{t('tabs.sections')}</DsChip>
        <DsChip variant={activeTab === 'files' ? 'selected' : 'default'} onClick={() => setActiveTab('files')}>{t('tabs.files')}</DsChip>
        <DsChip variant={activeTab === 'history' ? 'selected' : 'default'} onClick={() => setActiveTab('history')}>{t('tabs.history')}</DsChip>
      </div>

      <DsCard className="p-6 min-h-[300px]">
        {activeTab === 'sections' && (
          <p className="text-outline">{t('sectionsPlaceholder')}</p>
        )}
        {activeTab === 'files' && (
          <p className="text-outline">{t('filesPlaceholder')}</p>
        )}
        {activeTab === 'history' && (
          <p className="text-outline">{t('historyPlaceholder')}</p>
        )}
      </DsCard>
    </div>
  )
}

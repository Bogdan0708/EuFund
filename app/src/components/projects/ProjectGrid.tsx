'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { GlassInput, GlassChip, GlassSkeleton } from '@/components/glass'
import { ProjectCard } from './ProjectCard'

interface Project {
  id: string; title: string; status: string; updatedAt: string
}

interface ProjectGridProps {
  projects: Project[]
  loading?: boolean
}

const FILTERS = ['all', 'draft', 'action_plan', 'built', 'exported'] as const

export function ProjectGrid({ projects, loading = false }: ProjectGridProps) {
  const t = useTranslations('projects')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<string>('all')

  const filtered = projects.filter(p => {
    const matchesSearch = !search || p.title?.toLowerCase().includes(search.toLowerCase())
    const matchesFilter = filter === 'all' || p.status === filter
    return matchesSearch && matchesFilter
  })

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => <GlassSkeleton key={i} className="h-40" />)}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-3">
        <GlassInput value={search} onChange={e => setSearch(e.target.value)} placeholder={t('searchPlaceholder')} className="md:max-w-sm" />
        <div className="flex gap-2 flex-wrap">
          {FILTERS.map(f => (
            <GlassChip key={f} active={filter === f} onClick={() => setFilter(f)}>
              {t(`filter.${f}`)}
            </GlassChip>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="text-[var(--text-tertiary)] text-center py-12">{t('noProjects')}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(p => <ProjectCard key={p.id} project={p} />)}
        </div>
      )}
    </div>
  )
}

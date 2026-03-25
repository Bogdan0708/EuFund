'use client'
import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { GlassSkeleton } from '@/components/glass'
import { CallCard } from '@/components/calls/CallCard'
import { CallFilters } from '@/components/calls/CallFilters'

interface Call {
  id: string
  callCode: string
  titleRo: string
  titleEn?: string | null
  status: string
  submissionEnd?: string | null
  officialUrl?: string | null
  lastVerifiedAt?: string | null
}

export default function CallsPage() {
  const t = useTranslations('calls')
  const [calls, setCalls] = useState<Call[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    fetch('/api/v1/admin/calls')
      .then(r => r.json())
      .then(data => {
        setCalls(data.calls || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const filtered = calls.filter(c => {
    const matchesSearch =
      !search ||
      c.titleRo?.toLowerCase().includes(search.toLowerCase()) ||
      c.callCode?.toLowerCase().includes(search.toLowerCase())
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter
    return matchesSearch && matchesStatus
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{t('title')}</h1>
      <CallFilters
        search={search}
        onSearchChange={setSearch}
        status={statusFilter}
        onStatusChange={setStatusFilter}
      />
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <GlassSkeleton key={i} className="h-40" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-[var(--text-tertiary)] text-center py-12">{t('noCalls')}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(c => (
            <CallCard key={c.id} call={c} />
          ))}
        </div>
      )}
    </div>
  )
}

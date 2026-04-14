'use client'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { GlassCard, GlassBadge } from '@/components/glass'

interface MatchesPreviewProps {
  matches: { callCode: string; title: string; matchScore: number }[]
}

export function MatchesPreview({ matches }: MatchesPreviewProps) {
  const locale = useLocale()
  const t = useTranslations('landing')

  if (matches.length === 0) {
    return (
      <GlassCard hover={false} className="p-5">
        <h3 className="text-[var(--text-primary)] font-semibold mb-3">{t('newMatches')}</h3>
        <p className="text-[var(--text-secondary)] text-sm">{t('noMatchesYet')}</p>
        <Link href={`/${locale}/calls`} className="block mt-3 text-sm text-[var(--accent)] hover:underline">
          {t('browseCalls')} →
        </Link>
      </GlassCard>
    )
  }

  return (
    <GlassCard hover={false} className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[var(--text-primary)] font-semibold">{t('newMatches')} ({matches.length})</h3>
      </div>
      <div className="flex flex-col gap-2">
        {matches.map(m => (
          <div key={m.callCode} className="flex items-center justify-between py-1.5">
            <span className="text-sm text-[var(--text-primary)] truncate">{m.callCode}</span>
            <GlassBadge variant="accent">{m.matchScore}%</GlassBadge>
          </div>
        ))}
      </div>
      <Link href={`/${locale}/calls`} className="block mt-3 text-sm text-[var(--accent)] hover:underline">
        {t('viewAllCalls')} →
      </Link>
    </GlassCard>
  )
}

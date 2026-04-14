'use client'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { DsCard } from '@/components/ui/ds-card'
import { Badge } from '@/components/ui/badge'

interface MatchesPreviewProps {
  matches: { callCode: string; title: string; matchScore: number }[]
}

export function MatchesPreview({ matches }: MatchesPreviewProps) {
  const locale = useLocale()
  const t = useTranslations('landing')

  if (matches.length === 0) {
    return (
      <DsCard className="p-5">
        <h3 className="text-on-surface font-semibold mb-3">{t('newMatches')}</h3>
        <p className="text-on-surface-variant text-sm">{t('noMatchesYet')}</p>
        <Link href={`/${locale}/calls`} className="block mt-3 text-sm text-primary hover:underline">
          {t('browseCalls')} &rarr;
        </Link>
      </DsCard>
    )
  }

  return (
    <DsCard className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-on-surface font-semibold">{t('newMatches')} ({matches.length})</h3>
      </div>
      <div className="flex flex-col gap-2">
        {matches.map(m => (
          <div key={m.callCode} className="flex items-center justify-between py-1.5">
            <span className="text-sm text-on-surface truncate">{m.callCode}</span>
            <Badge variant="outline" className="bg-sky-100 text-sky-700 border-sky-200 font-medium">{m.matchScore}%</Badge>
          </div>
        ))}
      </div>
      <Link href={`/${locale}/calls`} className="block mt-3 text-sm text-primary hover:underline">
        {t('viewAllCalls')} &rarr;
      </Link>
    </DsCard>
  )
}

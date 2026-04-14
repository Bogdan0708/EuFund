'use client'
import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { DsInput } from '@/components/ui/ds-input'
import { Icon } from '@/components/ui/ds-icon'

interface HeroInputProps {
  large?: boolean
}

export function HeroInput({ large = true }: HeroInputProps) {
  const [value, setValue] = useState('')
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('landing')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!value.trim()) return
    router.push(`/${locale}/ai?idea=${encodeURIComponent(value.trim())}`)
  }

  return (
    <form onSubmit={handleSubmit} className="relative w-full max-w-2xl mx-auto">
      <DsInput
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={t('heroPlaceholder')}
        className={`pr-12 ${large ? 'px-6 py-4 text-lg' : ''}`}
      />
      {value.trim() && (
        <button
          type="submit"
          className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-primary text-on-primary hover:bg-primary/90 transition-all"
        >
          <Icon name="arrow_forward" size="sm" />
        </button>
      )}
    </form>
  )
}

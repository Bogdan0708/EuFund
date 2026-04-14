'use client'
import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { GlassInput } from '@/components/glass'
import { ArrowRight } from 'lucide-react'

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
      <GlassInput
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={t('heroPlaceholder')}
        large={large}
        className="pr-12"
      />
      {value.trim() && (
        <button
          type="submit"
          className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-[var(--accent)] text-white hover:brightness-110 transition-all"
        >
          <ArrowRight size={18} />
        </button>
      )}
    </form>
  )
}

'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { DsButton } from '@/components/ui/ds-button'
import { Icon } from '@/components/ui/ds-icon'

const HELPFUL_LINKS = [
  { key: 'home', icon: 'home', path: '/panou' },
  { key: 'projects', icon: 'folder_special', path: '/proiecte' },
  { key: 'fundingCalls', icon: 'search_insights', path: '/finantari' },
  { key: 'aiAssistant', icon: 'auto_awesome', path: '/asistent-ai' },
] as const

export default function LocaleNotFound() {
  const params = useParams()
  const locale = (params?.locale as string) === 'en' ? 'en' : 'ro'
  const t = useTranslations('notFound')

  return (
    <main className="min-h-screen mesh-gradient flex flex-col items-center justify-center overflow-hidden relative px-6">
      {/* Decorative mesh halo */}
      <div className="absolute inset-0 -z-10 flex items-center justify-center">
        <div
          className="w-[600px] h-[600px] rounded-full blur-3xl opacity-60"
          style={{
            background: 'radial-gradient(circle at center, rgba(0, 113, 227, 0.08) 0%, rgba(74, 71, 210, 0.05) 30%, transparent 70%)',
          }}
        />
      </div>

      {/* Background decorative blobs */}
      <div className="fixed bottom-0 left-0 w-full h-1/2 pointer-events-none -z-20">
        <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] bg-secondary/5 rounded-full blur-[100px]" />
        <div className="absolute top-[20%] left-[-10%] w-[400px] h-[400px] bg-primary/5 rounded-full blur-[80px]" />
      </div>

      {/* 404 Display Typography */}
      <div className="relative mb-8">
        <h1 className="text-[120px] md:text-[180px] font-black tracking-tighter text-on-surface/10 select-none">
          404
        </h1>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-primary font-black text-8xl md:text-9xl tracking-tight drop-shadow-sm">
            404
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="space-y-6 max-w-xl text-center">
        <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-on-surface">
          {t('title')}
        </h2>
        <p className="text-lg md:text-xl text-on-surface-variant leading-relaxed">
          {t('description')}
        </p>

        {/* Primary CTA */}
        <div className="pt-10">
          <DsButton asChild size="lg">
            <Link href={`/${locale}/panou`}>
              <Icon name="home" size="md" />
              {t('backToHome')}
            </Link>
          </DsButton>
        </div>
      </div>

      {/* Helpful links grid */}
      <div className="mt-24 grid grid-cols-1 md:grid-cols-4 gap-8 w-full max-w-4xl">
        {HELPFUL_LINKS.map((link, i) => (
          <Link
            key={link.key}
            href={`/${locale}${link.path}`}
            className={`space-y-3 text-left group transition-opacity hover:opacity-100 opacity-80 ${
              i > 0 ? 'md:border-l md:border-outline-variant/20 md:pl-6' : ''
            }`}
          >
            <div className="text-primary font-bold tracking-widest text-xs uppercase">
              {t(`links.${link.key}.label`)}
            </div>
            <h3 className="font-bold text-on-surface group-hover:text-primary transition-colors">
              {t(`links.${link.key}.title`)}
            </h3>
            <p className="text-sm text-on-surface-variant">
              {t(`links.${link.key}.description`)}
            </p>
          </Link>
        ))}
      </div>

      {/* Branding footer */}
      <footer className="fixed bottom-8 w-full text-center">
        <div className="flex items-center justify-center gap-2 opacity-40 grayscale hover:grayscale-0 hover:opacity-100 transition-all duration-500">
          <span className="text-xl font-black tracking-tighter text-on-surface">FondEU</span>
          <div className="w-1 h-1 bg-primary rounded-full" />
          <span className="text-sm font-medium text-on-surface-variant tracking-tight">
            {t('tagline')}
          </span>
        </div>
      </footer>
    </main>
  )
}

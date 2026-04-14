'use client'

import { useLocale } from 'next-intl'
import { usePathname, useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Icon } from '@/components/ui/ds-icon'

/**
 * Builds a locale-swapped URL that preserves search params AND hash
 * so session-resume links (e.g. `/ro/asistent-ai?session=xyz`) survive
 * a language switch. Reads search/hash from `window.location` at call
 * time — safe because this runs only inside onClick handlers on the
 * client, and avoids the SSR-bailout that `useSearchParams()` forces
 * on the whole layout subtree.
 */
function buildLocaleUrl(nextLocale: string, pathname: string): string {
  const segments = pathname.split('/')
  if (segments.length >= 2) segments[1] = nextLocale
  let nextPath = segments.join('/') || `/${nextLocale}`

  if (typeof window !== 'undefined') {
    if (window.location.search) nextPath += window.location.search
    if (window.location.hash) nextPath += window.location.hash
  }

  return nextPath
}

/**
 * Top-nav locale switcher. Rewrites the current URL's locale prefix
 * (e.g. /ro/panou → /en/panou) and pushes to the new path while
 * preserving query params and hash.
 *
 * Locale flows through to the orchestrator via `createSession(userId, locale, tier)`
 * so both the site and future chat output switch together.
 */
export function LocaleSwitcher() {
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const switchTo = (next: 'ro' | 'en') => {
    if (next === locale || isPending) return
    const nextPath = buildLocaleUrl(next, pathname)
    startTransition(() => {
      router.push(nextPath)
      router.refresh()
    })
  }

  return (
    <div
      className="flex items-center gap-0.5 h-10 px-1 rounded-full bg-surface-container-high/50"
      role="group"
      aria-label="Language"
    >
      <button
        type="button"
        onClick={() => switchTo('ro')}
        disabled={isPending}
        aria-pressed={locale === 'ro'}
        className={`h-8 min-w-[36px] px-2 rounded-full text-xs font-bold tracking-wide transition-colors disabled:opacity-60 ${
          locale === 'ro'
            ? 'bg-white text-primary shadow-sm'
            : 'text-on-surface-variant hover:text-on-surface'
        }`}
      >
        RO
      </button>
      <button
        type="button"
        onClick={() => switchTo('en')}
        disabled={isPending}
        aria-pressed={locale === 'en'}
        className={`h-8 min-w-[36px] px-2 rounded-full text-xs font-bold tracking-wide transition-colors disabled:opacity-60 ${
          locale === 'en'
            ? 'bg-white text-primary shadow-sm'
            : 'text-on-surface-variant hover:text-on-surface'
        }`}
      >
        EN
      </button>
    </div>
  )
}

/**
 * Compact icon-only variant for tight headers. Not currently used but
 * available if the bar runs out of space on small viewports.
 */
export function LocaleSwitcherCompact() {
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const other = locale === 'ro' ? 'en' : 'ro'
  const toggle = () => {
    if (isPending) return
    const nextPath = buildLocaleUrl(other, pathname)
    startTransition(() => {
      router.push(nextPath)
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      aria-label={`Switch to ${other.toUpperCase()}`}
      className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container-high transition-colors relative disabled:opacity-60"
    >
      <Icon name="language" size="md" />
      <span className="absolute bottom-1 right-1 text-[8px] font-bold text-primary bg-white rounded px-0.5">
        {locale.toUpperCase()}
      </span>
    </button>
  )
}

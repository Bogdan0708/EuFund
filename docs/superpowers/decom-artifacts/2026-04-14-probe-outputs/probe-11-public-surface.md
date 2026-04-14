# Probe 11 — Public-surface probe

**Run on:** 2026-04-14 against `master` at commit `1040228`.
**Spec reference:** Section 2, probe 11.
**Purpose:** Snapshot route-aware public surfaces (`publicPaths`, sitemap, robots, nav, locale handling) and flag any entry pointing at a delete-candidate or stale URL.

## Commands

```bash
rg -n "publicPaths" app/src/middleware.ts
rg -n "rewrites|redirects" app/next.config.mjs app/next.config.js
cat app/src/app/sitemap.ts
cat app/src/app/robots.ts
rg -n "/ro/|/en/|router\.push|<Link " app/src/components/layout/
cat app/src/lib/i18n.ts app/src/i18n.ts | head -50
```

## Raw output

```text
## A. middleware.ts publicPaths array
47:const publicPaths = [
133:  const isPublic = publicPaths.some(path => pathname.startsWith(path));

## B. next.config.* rewrites and redirects
(none)

## C. sitemap.ts entries
import { MetadataRoute } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://fondeu.ro';

export default function sitemap(): MetadataRoute.Sitemap {
  const locales = ['ro', 'en'];
  const pages = [
    '',
    '/finantari',
    '/finantari/live',
    '/preturi',
    '/autentificare',
  ];

  const entries: MetadataRoute.Sitemap = [];

  for (const locale of locales) {
    for (const page of pages) {
      entries.push({
        url: `${BASE_URL}/${locale}${page}`,
        lastModified: new Date(),
        changeFrequency: page === '' ? 'daily' : 'weekly',
        priority: page === '' ? 1 : 0.8,
      });
    }
  }

  return entries;
}

## D. robots.ts entries
import { MetadataRoute } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://fondeu.ro';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/panou/', '/proiecte/', '/asistent/'],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}

## E. Layout/nav config — Sidebar, MobileNav, TopNav route references
app/src/components/layout/LocaleSwitcher.tsx:10: * so session-resume links (e.g. `/ro/asistent-ai?session=xyz`) survive
app/src/components/layout/LocaleSwitcher.tsx:31: * (e.g. /ro/panou → /en/panou) and pushes to the new path while
app/src/components/layout/LocaleSwitcher.tsx:47:      router.push(nextPath)
app/src/components/layout/LocaleSwitcher.tsx:103:      router.push(nextPath)
app/src/components/layout/CommandPalette.tsx:34:    router.push(path)

## F. i18n locale + slug map
import { getRequestConfig } from 'next-intl/server';

export const locales = ['ro', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'ro';

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = (await requestLocale) || defaultLocale;

  return {
    locale,
    messages: (await import(`@/messages/${locale}.json`)).default,
  };
});
```

## Classification

| Surface | Finding | Classification |
|---------|---------|----------------|
| `middleware.ts` `publicPaths` | Includes `/api/ai/diagnostic`, auth, onboarding, pricing, and reset-password paths; no stale `(app)` route references found in the declared array | Current public-path surface is mostly aligned; diagnostic endpoint remains publicly routed and belongs in Plan 5 review |
| `next.config.*` rewrites / redirects | None | No redirect/rewrite cleanup required for current route retirement work |
| `sitemap.ts` | Publishes `/ro|en/finantari` and `/ro|en/finantari/live` even though the current route tree has no matching funding pages | Stale public surface; route-surface cleanup candidate outside the now-closed `(app)` deletion track |
| `robots.ts` | Disallows `/panou/`, `/proiecte/`, `/asistent/` | Current route family references are consistent with live Romanian dashboard paths |
| `CommandPalette.tsx` | Pushes to `/panou`, `/proiecte`, `/asistent-ai`, `/documente`, `/setari` | Current route family references are consistent with live Romanian dashboard paths |
| `LocaleSwitcher.tsx` | Preserves current pathname across locale swap (`/ro/panou -> /en/panou`) | Current behavior is path-preserving; no explicit stale slug map surfaced here |
| `i18n` config | Locale declaration only (`ro`, `en`) | No separate localized slug map file to clean up |

## Notes

- The probe surfaced one concrete stale public surface on current `master`: the funding-call entries in `sitemap.ts`.
- Because probe 02 found no `(app)` subtree, route-surface cleanup now means public declarations like sitemap/nav/middleware, not directory deletion.

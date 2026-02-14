import createIntlMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { locales, defaultLocale } from '@/lib/i18n';
import { auth } from '@/lib/auth';

const intlMiddleware = createIntlMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
});

// Public paths that don't require authentication (without locale prefix)
const publicPaths = [
  '/',
  '/autentificare',
  '/inregistrare',
];

function isPublicPath(pathname: string): boolean {
  // Strip locale prefix: /ro/autentificare -> /autentificare
  const withoutLocale = pathname.replace(/^\/(ro|en)/, '') || '/';
  return publicPaths.some((p) => withoutLocale === p || withoutLocale.startsWith(p + '/'));
}

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Skip API routes and static files
  if (pathname.startsWith('/api') || pathname.startsWith('/_next') || pathname.includes('.')) {
    return NextResponse.next();
  }

  // Run i18n middleware first
  const intlResponse = intlMiddleware(req);

  // Check auth for protected routes
  if (!isPublicPath(pathname)) {
    const session = await auth();
    if (!session?.user) {
      const locale = pathname.match(/^\/(ro|en)/)?.[1] || defaultLocale;
      const loginUrl = new URL(`/${locale}/autentificare`, req.url);
      loginUrl.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return intlResponse;
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};

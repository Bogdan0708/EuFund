// ─── Global Authentication & Security Middleware ───────────────
// Phase 1 Security: Auth + CSRF + Security Headers + CSP Nonces
import { auth } from '@/lib/auth/edge';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { trackRequest } from '@/lib/monitoring/metrics';

// Edge-safe logger (no pino in Edge runtime)
const makeLog = (ctx: Record<string, unknown> = {}) => ({
  warn: (data: Record<string, unknown>, msg: string) => console.warn(JSON.stringify({ ...ctx, ...data, msg })),
  info: (data: Record<string, unknown>, msg: string) => console.log(JSON.stringify({ ...ctx, ...data, msg })),
  child: (childCtx: Record<string, unknown>) => makeLog({ ...ctx, ...childCtx }),
});
const baseLog = makeLog({ component: 'middleware' });

// ─── CSP Nonce Generation ───
function generateNonce(): string {
  return crypto.randomUUID();
}

// ─── Build CSP Header ───
function buildCSP(nonce: string, isDev: boolean): string {
  const directives = [
    "default-src 'self'",
    isDev
      ? `script-src 'self' 'unsafe-eval' 'nonce-${nonce}' 'strict-dynamic'`
      : `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.anthropic.com https://*.googleapis.com https://eurlex.europa.eu",
    "object-src 'none'",
    "media-src 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "worker-src 'self' blob:",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
    "report-uri /api/csp-report",
    "report-to csp-endpoint",
  ];
  return directives.join('; ');
}

// Public paths that don't require authentication
const publicPaths = [
  '/api/auth',
  '/api/health',
  '/api/ready',
  '/api/csp-report', // CSP violation reporting endpoint
  '/api/metrics',    // Prometheus scrape endpoint
  '/api/ai/diagnostic', // AI diagnostic (token-protected)
  '/ro/autentificare',
  '/en/autentificare',
  '/ro/inregistrare',
  '/en/inregistrare',
  '/ro/resetare-parola',
  '/en/resetare-parola',
  '/ro/preturi',
  '/en/pricing',
  '/pricing',
  '/_next',
  '/favicon.ico',
  '/robots.txt',
  '/manifest.json',
  '/manifest.webmanifest',
  '/sitemap.xml'
];

if (process.env.NODE_ENV === 'development') {
  publicPaths.push('/api/test-ai'); // Testing endpoint
}

// CSRF validation helper — double-submit cookie pattern
function validateCSRF(req: NextRequest): boolean {
  const headerToken = req.headers.get('X-CSRF-Token');
  const cookieToken = req.cookies.get('csrf-token')?.value;

  // Both must exist and match
  if (!headerToken || !cookieToken || headerToken.length !== cookieToken.length) {
    return false;
  }

  // Constant-time comparison
  let mismatch = 0;
  for (let i = 0; i < headerToken.length; i++) {
    mismatch |= headerToken.charCodeAt(i) ^ cookieToken.charCodeAt(i);
  }
  return mismatch === 0;
}

export default auth(async (req) => {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const log = baseLog.child({ requestId });
  const pathname = req.nextUrl.pathname;

  // ═══════════════════════════════════════════════════════════════════
  // 0. PERMANENT REDIRECTS (old dashboard paths → new routes)
  // ═══════════════════════════════════════════════════════════════════
  const redirects: Record<string, string> = {
    '/ro/panou': '/ro',
    '/en/panou': '/en',
    '/ro/proiecte': '/ro/projects',
    '/en/proiecte': '/en/projects',
    '/ro/finantari': '/ro/calls',
    '/en/finantari': '/en/calls',
    '/ro/billing': '/ro/settings',
    '/en/billing': '/en/settings',
  };

  const redirectTo = redirects[pathname];
  if (redirectTo) {
    return NextResponse.redirect(new URL(redirectTo, req.url), 301);
  }

  const isPublic = publicPaths.some(path => pathname.startsWith(path));
  const finalizeResponse = (response: NextResponse) => {
    try {
      trackRequest(req.method, pathname, response.status, Date.now() - startedAt);
    } catch {
      // Metrics are best-effort and must not block request handling.
    }
    return response;
  };

  // Get client IP for security logging
  const ip = req.ip ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1';

  // ═══════════════════════════════════════════════════════════════════
  // 1. RATE LIMITING
  // ═══════════════════════════════════════════════════════════════════
  // Cloud Armor enforces global per-IP rate limiting at the load balancer layer.

  // ═══════════════════════════════════════════════════════════════════
  // 2. AUTHENTICATION ENFORCEMENT
  // ═══════════════════════════════════════════════════════════════════
  if (!isPublic && !req.auth) {
    if (pathname.startsWith('/api/')) {
      log.warn({ ip, path: pathname }, '[middleware] Unauthorized API access');
      const response = NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
      response.headers.set('x-request-id', requestId);
      return finalizeResponse(response);
    }

    // Redirect to login for web pages
    const loginUrl = pathname.startsWith('/en') ? '/en/autentificare' : '/ro/autentificare';
    const response = NextResponse.redirect(new URL(loginUrl, req.url));
    response.headers.set('x-request-id', requestId);
    return finalizeResponse(response);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 2b. EMAIL VERIFICATION ENFORCEMENT
  // ═══════════════════════════════════════════════════════════════════
  if (!isPublic && req.auth?.user && !req.auth.user.emailVerified) {
    // Allow auth-related routes and the verification page itself
    const verificationExempt = [
      '/api/auth/',
      '/ro/verifica-email', '/en/verify-email',
      '/ro/verificare-email', '/en/verificare-email',
    ];
    const isVerificationExempt = verificationExempt.some(p => pathname.startsWith(p));

    if (!isVerificationExempt) {
      if (pathname.startsWith('/api/')) {
        log.warn({ ip, path: pathname }, '[middleware] Unverified email — API access blocked');
        const response = NextResponse.json(
          {
            error: 'Email verification required',
            code: 'EMAIL_NOT_VERIFIED',
            messageRo: 'Trebuie să vă verificați adresa de email.',
            messageEn: 'You must verify your email address.',
          },
          { status: 403 }
        );
        response.headers.set('x-request-id', requestId);
        return finalizeResponse(response);
      }

      // Redirect web pages to verification prompt
      const verifyUrl = pathname.startsWith('/en') ? '/en/verifica-email' : '/ro/verifica-email';
      const response = NextResponse.redirect(new URL(verifyUrl, req.url));
      response.headers.set('x-request-id', requestId);
      return finalizeResponse(response);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 3. CSRF PROTECTION (state-changing operations)
  // ═══════════════════════════════════════════════════════════════════
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const csrfExemptPaths = [
      '/api/auth/callback',
      '/api/auth/session',
      '/api/webhooks',
      '/api/health',
      '/api/csp-report',
    ];

    const isExempt = csrfExemptPaths.some(p => pathname.startsWith(p));

    if (!isExempt && !isPublic && pathname.startsWith('/api/')) {
      if (!validateCSRF(req)) {
        log.warn({ ip, path: pathname }, '[middleware] CSRF validation failed');
        const response = NextResponse.json(
          {
            error: 'CSRF token required',
            code: 'CSRF_REQUIRED',
            message: 'Security token missing or invalid'
          },
          { status: 403 }
        );
        response.headers.set('x-request-id', requestId);
        return finalizeResponse(response);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 4. CSRF TOKEN COOKIE (set on all responses if missing)
  // ═══════════════════════════════════════════════════════════════════
  // Uses Synchronizer Token Pattern:
  // - Server sets httpOnly cookie (JS can't steal it)
  // - Server also sends token in X-CSRF-Token response header
  // - Client reads from response header, sends back in request header
  // - Server validates: request header must match cookie value

  // ═══════════════════════════════════════════════════════════════════
  // 5. SECURITY HEADERS (all responses)
  // ═══════════════════════════════════════════════════════════════════
  // Generate nonce first and pass it through request headers so
  // App Router server components can read it via next/headers().
  const nonce = generateNonce();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('x-request-id', requestId);
  // Set CSP on request headers so Next.js can extract the nonce for its own <script> tags.
  // Next.js reads `content-security-policy` from req.headers in app-render.
  const isDev = process.env.NODE_ENV === 'development';
  const cspValue = buildCSP(nonce, isDev);
  requestHeaders.set('content-security-policy', cspValue);
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // Set CSRF cookie if missing
  const existingCsrfToken = req.cookies.get('csrf-token')?.value;
  const csrfToken = existingCsrfToken ?? crypto.randomUUID();

  if (!existingCsrfToken) {
    response.cookies.set('csrf-token', csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600,
      path: '/'
    });
  }
  // Always expose CSRF token via response header for client bootstrap.
  response.headers.set('X-CSRF-Token', csrfToken);

  // Keep nonce on response headers as well for observability/debugging.
  response.headers.set('x-nonce', nonce);
  response.headers.set('x-request-id', requestId);

  // Content Security
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions Policy (disable unnecessary features)
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');

  // Content Security Policy — already built and set on request headers above.
  // Set it on the response headers too.
  response.headers.set('Content-Security-Policy', cspValue);

  // Report-To header for CSP violation reporting (newer standard)
  response.headers.set('Report-To', JSON.stringify({
    group: 'csp-endpoint',
    max_age: 31536000,
    endpoints: [{ url: '/api/csp-report' }],
    include_subdomains: true
  }));

  // HSTS (Strict-Transport-Security) - only in production
  if (!isDev) {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  return finalizeResponse(response);
});

// Configure which routes to run middleware on
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};

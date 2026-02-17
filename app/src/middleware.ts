// ─── Global Authentication & Security Middleware ───────────────
// Phase 1 Security: Auth + CSRF + Security Headers + CSP Nonces
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
const baseLog = logger.child({ component: 'middleware' });

// ─── CSP Nonce Generation ───
function generateNonce(): string {
  return crypto.randomUUID();
}

// Public paths that don't require authentication
const publicPaths = [
  '/api/auth',
  '/api/health',
  '/api/csp-report', // CSP violation reporting endpoint
  '/ro/autentificare',
  '/ro/inregistrare',
  '/en/login',
  '/en/register',
  '/_next',
  '/favicon.ico',
  '/robots.txt',
  '/manifest.json'
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
  const requestId = crypto.randomUUID();
  const log = baseLog.child({ requestId });
  const pathname = req.nextUrl.pathname;
  const isPublic = publicPaths.some(path => pathname.startsWith(path));

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
      log.warn(`[middleware] Unauthorized API access: IP=${ip}, path=${pathname}`);
      const response = NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
      response.headers.set('x-request-id', requestId);
      return response;
    }

    // Redirect to login for web pages
    const loginUrl = pathname.startsWith('/en') ? '/en/login' : '/ro/autentificare';
    const response = NextResponse.redirect(new URL(loginUrl, req.url));
    response.headers.set('x-request-id', requestId);
    return response;
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
        log.warn(`[middleware] CSRF validation failed: IP=${ip}, path=${pathname}`);
        const response = NextResponse.json(
          {
            error: 'CSRF token required',
            code: 'CSRF_REQUIRED',
            message: 'Security token missing or invalid'
          },
          { status: 403 }
        );
        response.headers.set('x-request-id', requestId);
        return response;
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
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // Set CSRF cookie if missing
  if (!req.cookies.get('csrf-token')) {
    const csrfToken = crypto.randomUUID();
    response.cookies.set('csrf-token', csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600,
      path: '/'
    });
    // Expose token via response header so client can read it
    response.headers.set('X-CSRF-Token', csrfToken);
  }

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

  // Content Security Policy (strict, nonce-based)
  const isDev = process.env.NODE_ENV === 'development';
  
  const cspDirectives = [
    "default-src 'self'",
    
    // Script sources:
    // - production: nonce + strict-dynamic
    // - development: keep eval/inline for Next.js HMR tooling
    isDev 
      ? `script-src 'self' 'unsafe-eval' 'unsafe-inline' 'nonce-${nonce}'`
      : `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    
    // Style sources
    isDev
      ? `style-src 'self' 'unsafe-inline'`
      : `style-src 'self' 'nonce-${nonce}'`,
    
    // Images - allow data URIs and HTTPS
    "img-src 'self' data: https:",
    
    // Fonts - allow data URIs
    "font-src 'self' data:",
    
    // Connect sources - API endpoints
    "connect-src 'self' https://api.anthropic.com https://*.googleapis.com https://eurlex.europa.eu",
    
    // Object and embed sources
    "object-src 'none'",
    "media-src 'self'",
    
    // Frame restrictions
    "frame-ancestors 'none'",
    "frame-src 'none'",
    
    // Base URI and form actions
    "base-uri 'self'",
    "form-action 'self'",
    
    // Worker sources
    "worker-src 'self' blob:",
    
    // Upgrade insecure requests in production
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
    
    // CSP violation reporting
    `report-uri /api/csp-report`,
    `report-to csp-endpoint`
  ];

  response.headers.set('Content-Security-Policy', cspDirectives.join('; '));

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

  return response;
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

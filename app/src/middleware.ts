// ─── Global Authentication & Security Middleware ───────────────
// Phase 1 Security: Auth + Rate Limiting + CSRF + Security Headers + CSP Nonces
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
const log = logger.child({ component: 'middleware' });

// ─── CSP Nonce Generation ───
function generateNonce(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return Buffer.from(
    Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))
  ).toString('base64');
}

// ─── In-Memory Rate Limiter (Edge-compatible, no Redis needed) ───
const rateLimitStore = new Map<string, number[]>();
const MAX_RATE_LIMIT_ENTRIES = 50000;

function enforceRateLimitStoreCap(): void {
  while (rateLimitStore.size > MAX_RATE_LIMIT_ENTRIES) {
    const oldestKey = rateLimitStore.keys().next().value;
    if (!oldestKey) break;
    rateLimitStore.delete(oldestKey);
  }
}

function checkInMemoryRateLimit(key: string, max: number, windowMs: number): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const windowStart = now - windowMs;

  let timestamps = rateLimitStore.get(key) || [];

  timestamps = timestamps.filter(ts => ts > windowStart);
  if (timestamps.length === 0) {
    rateLimitStore.delete(key);
  }

  if (timestamps.length >= max) {
    const oldestTimestamp = Math.min(...timestamps);
    const resetTime = oldestTimestamp + windowMs;
    return { allowed: false, remaining: 0, resetTime };
  }

  timestamps.push(now);
  rateLimitStore.delete(key);
  rateLimitStore.set(key, timestamps);
  enforceRateLimitStoreCap();

  return { allowed: true, remaining: max - timestamps.length, resetTime: now + windowMs };
}

// Public paths that don't require authentication
const publicPaths = [
  '/api/auth',
  '/api/health',
  '/api/test-ai',  // Testing endpoint
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

// Enhanced rate limiting configuration per endpoint type
const RATE_LIMIT_CONFIGS: Record<string, { max: number; windowMs: number }> = {
  '/api/ai': { max: 100, windowMs: 60 * 60 * 1000 },           // 100 AI requests/hour per IP
  '/api/v1': { max: 1000, windowMs: 60 * 60 * 1000 },          // 1000 API requests/hour per IP
  '/api/auth/register': { max: 5, windowMs: 60 * 60 * 1000 },  // 5 registrations/hour per IP
  '/api/documents/upload': { max: 50, windowMs: 60 * 60 * 1000 }, // 50 uploads/hour per IP
  '/api/csp-report': { max: 100, windowMs: 60 * 60 * 1000 },   // 100 CSP reports/hour per IP
  'default': { max: 500, windowMs: 60 * 60 * 1000 },           // Default: 500/hour
};

// Get rate limit config for a given path
function getRateLimitConfig(pathname: string) {
  const match = Object.entries(RATE_LIMIT_CONFIGS).find(([path]) =>
    path !== 'default' && pathname.startsWith(path)
  );
  return match ? match[1] : RATE_LIMIT_CONFIGS['default'];
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
  const pathname = req.nextUrl.pathname;
  const isPublic = publicPaths.some(path => pathname.startsWith(path));

  // Get client IP for rate limiting and logging
  const ip = req.ip ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1';

  // ═══════════════════════════════════════════════════════════════════
  // 1. IP-BASED RATE LIMITING (DDoS Protection) - In-memory (edge-compatible)
  // ═══════════════════════════════════════════════════════════════════
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/health')) {
    const config = getRateLimitConfig(pathname);
    const rateLimitKey = `${ip}:${pathname.split('/').slice(0, 3).join('/')}`;
    const rateLimit = checkInMemoryRateLimit(rateLimitKey, config.max, config.windowMs);

    if (!rateLimit.allowed) {
      log.warn(`[middleware] Rate limit exceeded: IP=${ip}, path=${pathname}`);
      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
          resetTime: rateLimit.resetTime
        },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': config.max.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': rateLimit.resetTime.toString(),
            'Retry-After': Math.ceil((rateLimit.resetTime - Date.now()) / 1000).toString(),
          }
        }
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 2. AUTHENTICATION ENFORCEMENT
  // ═══════════════════════════════════════════════════════════════════
  if (!isPublic && !req.auth) {
    if (pathname.startsWith('/api/')) {
      log.warn(`[middleware] Unauthorized API access: IP=${ip}, path=${pathname}`);
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }

    // Redirect to login for web pages
    const loginUrl = pathname.startsWith('/en') ? '/en/login' : '/ro/autentificare';
    return NextResponse.redirect(new URL(loginUrl, req.url));
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
        return NextResponse.json(
          {
            error: 'CSRF token required',
            code: 'CSRF_REQUIRED',
            message: 'Security token missing or invalid'
          },
          { status: 403 }
        );
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
    
    // Style sources - nonces preferred, but allow unsafe-inline for backwards compatibility with Tailwind
    `style-src 'self' 'nonce-${nonce}' 'unsafe-inline'`,
    
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

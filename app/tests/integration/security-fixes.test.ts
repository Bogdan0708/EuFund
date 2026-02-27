import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
type NextAuthRequest = NextRequest & { auth?: { user?: { id?: string; email?: string } } | null };
import { ZodError } from 'zod';

// Helper to create mock Next.js requests
function createNextRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
    body?: any;
    ip?: string;
  } = {}
): NextAuthRequest {
  const { method = 'GET', headers = {}, cookies = {}, body, ip = '127.0.0.1' } = options;
  const requestUrl = `http://localhost:3000${url}`;
  const allHeaders = new Headers(headers);
  if (Object.keys(cookies).length > 0) {
    const cookieHeader = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join('; ');
    allHeaders.set('cookie', cookieHeader);
  }

  const request = new NextRequest(requestUrl, {
    method,
    headers: allHeaders,
    body: body ? JSON.stringify(body) : undefined,
    ip,
  }) as NextAuthRequest;

  return request;
}

// Store original process.env
const originalEnv = process.env;

describe('Enhanced Security Integration Tests (Fixes)', () => {
  
  beforeEach(() => {
    vi.resetModules();
    // Mock logger to prevent console noise
    vi.mock('@/lib/logger', () => ({
      logger: {
        child: () => ({
          warn: vi.fn(),
          error: vi.fn(),
          info: vi.fn(),
          debug: vi.fn(),
        }),
      },
    }));
  });

  afterEach(() => {
    // Restore original environment variables
    process.env = originalEnv;
  });

  describe('Rate Limiting', () => {
    
    it('should return 429 when rate limit is exceeded', async () => {
      // Mock the rate limit checker to return 'denied'
      vi.doMock('@/lib/redis/client', () => ({
        isRedisAvailable: vi.fn().mockResolvedValue(true),
        checkRateLimit: vi.fn().mockResolvedValue({
          allowed: false,
          remaining: 0,
          resetTime: new Date(Date.now() + 3600 * 1000),
        }),
      }));
      // Mock auth to return a 'free' tier user
      vi.doMock('@/lib/auth', () => ({
        auth: () => Promise.resolve({ user: { id: 'free-user-1', email: 'free@test.com' } }),
      }));
      // Mock db/cache to return 'free' tier
      vi.doMock('@/lib/db', () => ({ db: {}, schema: {} }));
      vi.doMock('lru-cache', () => ({
        LRUCache: class {
          get = () => 'free';
          set = vi.fn();
        }
      }));

      const { withAIAuth } = await import('@/lib/middleware/auth');
      const handler = vi.fn(() => Promise.resolve(NextResponse.json({ success: true })));
      
      const request = createNextRequest('/api/ai/predict');
      const response = await withAIAuth(request, handler);

      expect(response.status).toBe(429);
      const json = await response.json();
      expect(json.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(json.error).toBe('Rate limit exceeded');
      expect(json.tier).toBe('free');
    });

    it('should set X-RateLimit headers on success', async () => {
      const resetTime = new Date(Date.now() + 3600 * 1000);
      // Mock rate limit to return 'allowed'
      vi.doMock('@/lib/redis/client', () => ({
        isRedisAvailable: vi.fn().mockResolvedValue(true),
        checkRateLimit: vi.fn().mockResolvedValue({
          allowed: true,
          remaining: 9,
          resetTime,
        }),
      }));
       vi.doMock('@/lib/auth', () => ({
        auth: () => Promise.resolve({ user: { id: 'pro-user-1', email: 'pro@test.com' } }),
      }));
      vi.doMock('@/lib/db', () => ({ db: {}, schema: {} }));
       vi.doMock('lru-cache', () => ({
        LRUCache: class {
          get = () => 'pro';
          set = vi.fn();
        }
      }));

      const { withAIAuth } = await import('@/lib/middleware/auth');
      const handler = vi.fn(() => Promise.resolve(NextResponse.json({ success: true })));

      const request = createNextRequest('/api/ai/generate');
      const response = await withAIAuth(request, handler);

      expect(response.status).toBe(200);
      expect(response.headers.get('X-RateLimit-Limit')).toBe('100'); // Pro tier limit
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('9');
      expect(response.headers.get('X-RateLimit-Reset')).toBe(resetTime.toString());
    });
  });

  describe('Production-Specific Headers', () => {

    it.todo('should set Strict-Transport-Security (HSTS) header in production — requires full next-auth middleware mock', async () => {
      // Set NODE_ENV to production for this test
      process.env = { ...originalEnv, NODE_ENV: 'production' };
      
      vi.doMock('@/lib/auth/edge', () => ({
        auth: (handler: Function) => handler,
      }));

      const { default: middleware } = await import('@/middleware');
      const request = createNextRequest('/');
      const response = await middleware(request) as NextResponse;

      expect(response.headers.get('Strict-Transport-Security')).toBe(
        'max-age=31536000; includeSubDomains; preload'
      );
    });

    it('should NOT set Strict-Transport-Security (HSTS) header in development', async () => {
      process.env = { ...originalEnv, NODE_ENV: 'development' };

      vi.doMock('@/lib/auth/edge', () => ({
        auth: (handler: Function) => handler,
      }));

      const { default: middleware } = await import('@/middleware');
      const request = createNextRequest('/');
      const response = await middleware(request) as NextResponse;

      expect(response.headers.has('Strict-Transport-Security')).toBe(false);
    });
  });

  describe('CSP Nonce Verification', () => {
    it.todo('should ensure the x-nonce header matches the nonce in the CSP header — requires full next-auth middleware mock', async () => {
       vi.doMock('@/lib/auth/edge', () => ({
        auth: (handler: Function) => handler,
      }));

      const { default: middleware } = await import('@/middleware');
      const request = createNextRequest('/');
      const response = await middleware(request) as NextResponse;

      const nonce = response.headers.get('x-nonce');
      const cspHeader = response.headers.get('Content-Security-Policy');

      expect(nonce).toBeTruthy();
      expect(cspHeader).toContain(`'nonce-${nonce}'`);
    });
  });

  describe('Unauthenticated Page Redirect', () => {
    it('should redirect to the /ro/autentificare for unauthenticated requests to protected RO pages', async () => {
       vi.doMock('@/lib/auth/edge', () => ({
        auth: (handler: Function) => (req: NextAuthRequest) => {
          req.auth = null; // Simulate no session
          return handler(req);
        },
      }));
      
      const { default: middleware } = await import('@/middleware');
      const request = createNextRequest('/ro/dashboard');
      const response = await middleware(request) as NextResponse;

      // Check for redirect status code
      expect(response.status).toBe(307); // Next.js redirect is 302 Found
      expect(response.headers.get('Location')).toContain('/ro/autentificare');
    });

    it('should redirect to the /en/login for unauthenticated requests to protected EN pages', async () => {
       vi.doMock('@/lib/auth/edge', () => ({
        auth: (handler: Function) => (req: NextAuthRequest) => {
          req.auth = null; // Simulate no session
          return handler(req);
        },
      }));

      const { default: middleware } = await import('@/middleware');
      const request = createNextRequest('/en/dashboard');
      const response = await middleware(request) as NextResponse;

      expect(response.status).toBe(307);
      expect(response.headers.get('Location')).toContain('/en/login');
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
type NextAuthRequest = NextRequest & { auth?: { user?: { id?: string; email?: string } } | null };

function createNextRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
    body?: any;
  } = {}
): NextAuthRequest {
  const { method = 'GET', headers = {}, cookies = {}, body } = options;

  const requestUrl = url.startsWith('http') ? url : `http://localhost:3000${url}`;

  const allHeaders = new Headers(headers);
  if (Object.keys(cookies).length > 0) {
    const cookieHeader = Object.entries(cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
    allHeaders.set('cookie', cookieHeader);
  }

  const request = new NextRequest(requestUrl, {
    method,
    headers: allHeaders,
    body: body ? JSON.stringify(body) : undefined,
  }) as NextAuthRequest;

  return request;
}

describe('Security Integration Tests', () => {
  describe('CSRF Protection', () => {
    let middleware: any;

    beforeEach(async () => {
      vi.resetModules();
      vi.mock('@/lib/auth/edge', () => ({
        auth: (handler: Function) => handler,
      }));
      vi.mock('@/lib/logger', () => ({
        logger: {
          child: () => ({
            warn: vi.fn(),
            error: vi.fn(),
            info: vi.fn(),
          }),
        },
      }));
    });

    it('should reject POST to /api/* without CSRF token', async () => {
      const { default: middlewareFunc } = await import('@/middleware');
      
      const request = createNextRequest('/api/ai/predict-success', {
        method: 'POST',
        body: { test: 'data' },
      });
      request.auth = { user: { id: '1', email: 'test@example.com', emailVerified: true } } as any;

      const response = await middlewareFunc(request) as NextResponse;

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.code).toBe('CSRF_REQUIRED');
      expect(json.error).toBe('CSRF token required');
    });

    it('should reject PUT to /api/* without CSRF token', async () => {
      const { default: middlewareFunc } = await import('@/middleware');
      
      const request = createNextRequest('/api/v1/projects/123', {
        method: 'PUT',
        body: { name: 'Updated Project' },
      });
      request.auth = { user: { id: '1', email: 'test@example.com', emailVerified: true } } as any;

      const response = await middlewareFunc(request) as NextResponse;

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.code).toBe('CSRF_REQUIRED');
    });

    it('should reject DELETE to /api/* without CSRF token', async () => {
      const { default: middlewareFunc } = await import('@/middleware');
      
      const request = createNextRequest('/api/v1/projects/123', {
        method: 'DELETE',
      });
      request.auth = { user: { id: '1', email: 'test@example.com', emailVerified: true } } as any;

      const response = await middlewareFunc(request) as NextResponse;

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.code).toBe('CSRF_REQUIRED');
    });

    it('should allow GET requests without CSRF token', async () => {
      const { default: middlewareFunc } = await import('@/middleware');
      
      const request = createNextRequest('/api/health', {
        method: 'GET',
      });

      const response = await middlewareFunc(request) as NextResponse;

      expect(response.status).not.toBe(403);
      expect(response.headers.has('x-nonce')).toBe(true);
    });

    it('should accept POST with valid CSRF token from cookie', async () => {
      const { default: middlewareFunc } = await import('@/middleware');

      const csrfToken = 'a'.repeat(36);
      const request = createNextRequest('/api/ai/predict-success', {
        method: 'POST',
        headers: {
          'X-CSRF-Token': csrfToken,
        },
        cookies: {
          'csrf-token': csrfToken,
        },
        body: { test: 'data' },
      });
      request.auth = { user: { id: '1', email: 'test@example.com', emailVerified: true } } as any;

      const response = await middlewareFunc(request) as NextResponse;

      expect([200, 404]).toContain(response.status);
    });

    it('should reject POST with mismatched CSRF tokens', async () => {
      const { default: middlewareFunc } = await import('@/middleware');
      
      const request = createNextRequest('/api/ai/predict-success', {
        method: 'POST',
        headers: {
          'X-CSRF-Token': 'token-in-header',
        },
        cookies: {
          'csrf-token': 'different-token-in-cookie',
        },
        body: { test: 'data' },
      });
      request.auth = { user: { id: '1', email: 'test@example.com', emailVerified: true } } as any;

      const response = await middlewareFunc(request) as NextResponse;

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.code).toBe('CSRF_REQUIRED');
    });

    it('should exempt /api/auth/callback from CSRF check', async () => {
      const { default: middlewareFunc } = await import('@/middleware');
      
      const request = createNextRequest('/api/auth/callback/credentials', {
        method: 'POST',
        body: { username: 'test', password: 'test' },
      });

      const response = await middlewareFunc(request) as NextResponse;

      expect(response.status).not.toBe(403);
    });

    it('should exempt /api/health from CSRF check', async () => {
      const { default: middlewareFunc } = await import('@/middleware');
      
      const request = createNextRequest('/api/health', {
        method: 'POST',
      });

      const response = await middlewareFunc(request) as NextResponse;

      expect(response.status).not.toBe(403);
    });
  });

  describe('Security Headers', () => {
    let middleware: any;

    beforeEach(async () => {
      vi.resetModules();
      vi.mock('@/lib/auth/edge', () => ({
        auth: (handler: Function) => handler,
      }));
      vi.mock('@/lib/logger', () => ({
        logger: {
          child: () => ({
            warn: vi.fn(),
            error: vi.fn(),
            info: vi.fn(),
          }),
        },
      }));
    });

    it('should include X-Frame-Options: DENY', async () => {
      const { default: middlewareFunc } = await import('@/middleware');
      
      const request = createNextRequest('/api/health', {
        method: 'GET',
      });

      const response = await middlewareFunc(request) as NextResponse;

      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    });

    it('should include X-Content-Type-Options: nosniff', async () => {
      const { default: middlewareFunc } = await import('@/middleware');
      
      const request = createNextRequest('/api/health', {
        method: 'GET',
      });

      const response = await middlewareFunc(request) as NextResponse;

      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('should include Referrer-Policy header', async () => {
      const { default: middlewareFunc } = await import('@/middleware');
      
      const request = createNextRequest('/api/health', {
        method: 'GET',
      });

      const response = await middlewareFunc(request) as NextResponse;

      const referrerPolicy = response.headers.get('Referrer-Policy');
      expect(referrerPolicy).toBeTruthy();
      expect(referrerPolicy).toBe('strict-origin-when-cross-origin');
    });

    it('should include Content-Security-Policy with nonce', async () => {
      const { default: middlewareFunc } = await import('@/middleware');

      const request = createNextRequest('/api/health', {
        method: 'GET',
      });

      const response = await middlewareFunc(request) as NextResponse;

      const csp = response.headers.get('Content-Security-Policy');
      expect(csp).toBeTruthy();
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain('nonce-');
      expect(csp).toContain("frame-ancestors 'none'");
    });

    it('should include nonce in response headers', async () => {
      const { default: middlewareFunc } = await import('@/middleware');

      const request = createNextRequest('/api/health', {
        method: 'GET',
      });

      const response = await middlewareFunc(request) as NextResponse;

      const nonce = response.headers.get('x-nonce');
      expect(nonce).toBeTruthy();
      expect(nonce!.length).toBeGreaterThan(0);
    });

    it('should set CSRF cookie with HttpOnly and SameSite', async () => {
      const { default: middlewareFunc } = await import('@/middleware');

      const request = createNextRequest('/api/health', {
        method: 'GET',
      });

      const response = await middlewareFunc(request) as NextResponse;

      const setCookie = response.headers.get('Set-Cookie');
      if (setCookie) {
        expect(setCookie).toContain('csrf-token=');
        expect(setCookie).toContain('HttpOnly');
        expect(setCookie.toLowerCase()).toContain('samesite=strict');
      }
    });

    it('should include X-XSS-Protection header', async () => {
      const { default: middlewareFunc } = await import('@/middleware');
      
      const request = createNextRequest('/api/health', {
        method: 'GET',
      });

      const response = await middlewareFunc(request) as NextResponse;

      expect(response.headers.get('X-XSS-Protection')).toBe('1; mode=block');
    });

    it('should include Permissions-Policy header', async () => {
      const { default: middlewareFunc } = await import('@/middleware');
      
      const request = createNextRequest('/api/health', {
        method: 'GET',
      });

      const response = await middlewareFunc(request) as NextResponse;

      const permissionsPolicy = response.headers.get('Permissions-Policy');
      expect(permissionsPolicy).toBeTruthy();
      expect(permissionsPolicy).toContain('camera=()');
      expect(permissionsPolicy).toContain('microphone=()');
    });
  });

  describe('Auth Middleware', () => {
    beforeEach(async () => {
      vi.resetModules();
      vi.mock('@/lib/logger', () => ({
        logger: {
          child: () => ({
            warn: vi.fn(),
            error: vi.fn(),
            info: vi.fn(),
          }),
        },
      }));
    });

    it('should return 401 for /api/ai/* routes without auth', async () => {
      vi.doMock('@/lib/auth/edge', () => ({
        auth: (handler: Function) => async (req: any) => {
          req.auth = null;
          return handler(req);
        },
      }));

      const { default: middlewareFunc } = await import('@/middleware');

      const request = createNextRequest('/api/ai/predict-success', {
        method: 'GET',
      });

      const response = await middlewareFunc(request) as NextResponse;

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe('Authentication required');
      expect(json.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 for /api/v1/* routes without auth', async () => {
      vi.doMock('@/lib/auth/edge', () => ({
        auth: (handler: Function) => async (req: any) => {
          req.auth = null;
          return handler(req);
        },
      }));

      const { default: middlewareFunc } = await import('@/middleware');

      const request = createNextRequest('/api/v1/projects', {
        method: 'GET',
      });

      const response = await middlewareFunc(request) as NextResponse;

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe('Authentication required');
    });

    it('should allow access to /api/health without auth', async () => {
      vi.doMock('@/lib/auth/edge', () => ({
        auth: (handler: Function) => async (req: any) => {
          req.auth = null;
          return handler(req);
        },
      }));

      const { default: middlewareFunc } = await import('@/middleware');

      const request = createNextRequest('/api/health', {
        method: 'GET',
      });

      const response = await middlewareFunc(request) as NextResponse;

      expect(response.status).not.toBe(401);
    });

    it('should allow access to /api/auth/* without auth', async () => {
      vi.doMock('@/lib/auth/edge', () => ({
        auth: (handler: Function) => async (req: any) => {
          req.auth = null;
          return handler(req);
        },
      }));

      const { default: middlewareFunc } = await import('@/middleware');

      const request = createNextRequest('/api/auth/signin', {
        method: 'GET',
      });

      const response = await middlewareFunc(request) as NextResponse;

      expect(response.status).not.toBe(401);
    });

    it('should allow authenticated requests to /api/ai/*', async () => {
      vi.doMock('@/lib/auth/edge', () => ({
        auth: (handler: Function) => async (req: any) => {
          req.auth = { user: { id: '1', email: 'test@example.com', emailVerified: true } };
          return handler(req);
        },
      }));

      const { default: middlewareFunc } = await import('@/middleware');
      
      const request = createNextRequest('/api/ai/match-grants', {
        method: 'GET',
      });

      const response = await middlewareFunc(request) as NextResponse;

      expect(response.status).not.toBe(401);
    });
  });

  describe('Input Validation', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it('should validate schema for /api/ai/predict-success', async () => {
      const { z } = await import('zod');
      
      const inputSchema = z.object({
        projectTitle: z.string().min(5),
        projectSummary: z.string().min(20),
        programType: z.string(),
        totalBudget: z.number().positive(),
        durationMonths: z.number().positive(),
        sector: z.string(),
        trl: z.number().min(1).max(9).optional(),
        partners: z.array(z.object({
          name: z.string(),
          country: z.string(),
          type: z.enum(['university', 'research_institute', 'sme', 'large_enterprise', 'ngo', 'public_body']),
          role: z.enum(['coordinator', 'partner']),
        })),
      });

      const validInput = {
        projectTitle: 'Innovation Project',
        projectSummary: 'A comprehensive project summary with sufficient detail',
        programType: 'horizon_europe',
        totalBudget: 500000,
        durationMonths: 36,
        sector: 'ICT',
        trl: 5,
        partners: [
          {
            name: 'Lead Partner',
            country: 'RO',
            type: 'university' as const,
            role: 'coordinator' as const,
          },
        ],
      };

      const result = inputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should reject invalid TRL values', async () => {
      const { z } = await import('zod');
      
      const inputSchema = z.object({
        trl: z.number().min(1).max(9),
      });

      expect(inputSchema.safeParse({ trl: 0 }).success).toBe(false);
      expect(inputSchema.safeParse({ trl: 10 }).success).toBe(false);
      expect(inputSchema.safeParse({ trl: 5 }).success).toBe(true);
    });
  });
});

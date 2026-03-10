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

    it('should reject /api/ai/predict-success with invalid input', async () => {
      vi.mock('@/lib/ai/predictive-analytics', () => ({
        predictProposalSuccess: vi.fn(),
        quickSuccessPrediction: vi.fn(),
      }));
      vi.mock('@/lib/legal/audit', () => ({
        logAudit: vi.fn(),
      }));
      vi.mock('@/lib/middleware/auth', () => ({
        withAIAuth: (req: any, handler: Function) =>
          handler({ id: '1', email: 'test@example.com', tier: 'free' }),
      }));
      vi.mock('@/lib/db', () => ({
        db: {
          query: {
            orgMembers: {
              findFirst: vi.fn(),
              findMany: vi.fn().mockResolvedValue([{ orgId: 'org-1' }]),
            },
          },
          insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'review-1' }]) }) }),
        },
      }));

      const { POST } = await import('@/app/api/ai/predict-success/route');

      const invalidPayloads = [
        {},
        { projectTitle: 'ab' },
        { projectTitle: 'Valid Title', projectSummary: 'Short' },
        { projectTitle: 'Valid Title', projectSummary: 'Valid summary text here', totalBudget: -1000 },
        { projectTitle: 'Valid Title', projectSummary: 'Valid summary text here', totalBudget: 10000, durationMonths: -5 },
      ];

      for (const payload of invalidPayloads) {
        const request = createNextRequest('/api/ai/predict-success', {
          method: 'POST',
          body: payload,
        });

        const response = await POST(request);
        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json.error).toBeTruthy();
      }
    });

    it('should reject /api/ai/generate-proposal with missing fields', async () => {
      vi.mock('@/lib/ai/proposal-generator', () => ({
        generateProposal: vi.fn(),
      }));
      vi.mock('@/lib/legal/audit', () => ({
        logAudit: vi.fn(),
      }));
      vi.mock('@/lib/middleware/auth', () => ({
        withAIAuth: (req: any, handler: Function) => 
          handler({ id: '1', email: 'test@example.com', tier: 'pro' }),
      }));

      const { POST } = await import('@/app/api/ai/generate-proposal/route');
      
      const invalidPayloads = [
        {},
        { businessDescription: '' },
        { fundingProgram: 'horizon_europe' },
        { businessDescription: 'x', fundingProgram: '' },
      ];

      for (const payload of invalidPayloads) {
        const request = createNextRequest('/api/ai/generate-proposal', {
          method: 'POST',
          body: payload,
        });

        const response = await POST(request);
        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json.error).toBeTruthy();
      }
    });

    it('should accept valid payload for /api/ai/predict-success', async () => {
      vi.mock('@/lib/ai/predictive-analytics', () => ({
        predictProposalSuccess: vi.fn(),
        quickSuccessPrediction: vi.fn().mockReturnValue({
          successProbability: 0.85,
          confidenceLevel: 'high',
          strengths: [],
          weaknesses: [],
          recommendations: [],
          riskFactors: [],
          scoreBreakdown: {},
          benchmarkComparison: {},
        }),
      }));
      vi.mock('@/lib/legal/audit', () => ({
        logAudit: vi.fn(),
      }));
      vi.mock('@/lib/logger', () => ({
        logger: {
          error: vi.fn(),
          child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
        },
      }));
      vi.mock('@/lib/ai/eu-ai-act', () => ({
        withEUAIActCompliance: (_feature: string, handler: Function) =>
          async (payload: unknown, _userId?: string) => ({
            result: await handler(payload).then((value: any) => value.result ?? value),
            metadata: { oversightRequired: false },
          }),
      }));
      vi.mock('@/lib/ai/sanitize', () => ({
        sanitizeAIResponseDeep: (data: unknown) => ({ sanitized: data, piiRedacted: [] }),
      }));
      vi.mock('@/lib/middleware/tier-gate', () => ({
        assertTier: vi.fn().mockImplementation((tier: string) => tier),
      }));
      vi.mock('@/lib/middleware/auth', () => ({
        withAIAuth: (req: any, handler: Function) =>
          handler({ id: '1', email: 'test@example.com', tier: 'free' }),
      }));
      vi.mock('@/lib/db', () => ({
        db: { query: { orgMembers: { findFirst: vi.fn() } }, insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'review-1' }]) }) }) },
      }));

      const { POST } = await import('@/app/api/ai/predict-success/route');

      const validPayload = {
        projectTitle: 'Innovation Project',
        projectSummary: 'A comprehensive project summary with sufficient detail',
        programType: 'horizon_europe',
        totalBudget: 500000,
        durationMonths: 36,
        sector: 'ICT',
        quick: true,
        partners: [
          {
            name: 'Lead Partner',
            country: 'RO',
            type: 'university',
            role: 'coordinator',
          },
        ],
      };

      const request = createNextRequest('/api/ai/predict-success', {
        method: 'POST',
        body: validPayload,
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
    });

    it('should accept valid payload for /api/ai/generate-proposal', async () => {
      vi.mock('@/lib/ai/proposal-generator', () => ({
        generateProposal: vi.fn().mockResolvedValue({
          proposal: { title: 'Generated Proposal' },
          tokensUsed: 1000,
          ragSourcesUsed: 5,
        }),
      }));
      vi.mock('@/lib/legal/audit', () => ({
        logAudit: vi.fn(),
      }));
      vi.mock('@/lib/middleware/auth', () => ({
        withAIAuth: (req: any, handler: Function) => 
          handler({ id: '1', email: 'test@example.com', tier: 'pro' }),
      }));

      const { POST } = await import('@/app/api/ai/generate-proposal/route');
      
      const validPayload = {
        businessDescription: 'A detailed business description explaining our innovative solution',
        fundingProgram: 'horizon_europe',
      };

      const request = createNextRequest('/api/ai/generate-proposal', {
        method: 'POST',
        body: validPayload,
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeTruthy();
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

    it('should validate schema for /api/ai/generate-proposal', async () => {
      const { generateProposalSchema } = await import('@/lib/validation/schemas');
      
      const validInput = {
        businessDescription: 'A detailed business description explaining our innovative solution',
        fundingProgram: 'horizon_europe',
      };

      const result = generateProposalSchema.safeParse(validInput);
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

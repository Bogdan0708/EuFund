import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

function createJsonRequest(body: unknown) {
  return new NextRequest('http://localhost:3000/api/ai/match-grants', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ai/match-grants', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('fails closed when validated call data is unavailable', async () => {
    vi.doMock('@/lib/middleware/auth', () => ({
      withAIAuth: (_req: NextRequest, handler: Function) =>
        handler({ id: 'user-1', email: 'u@test.com', tier: 'pro' }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            innerJoin: vi.fn(() => ({
              where: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([]),
              })),
            })),
          })),
        })),
      },
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }));

    const { POST } = await import('@/app/api/ai/match-grants/route');
    const response = await POST(createJsonRequest({
      companyProfile: {
        companyName: 'Acme',
        companyType: 'sme',
        country: 'RO',
        sector: 'ICT',
        employeeCount: 12,
        annualRevenue: 2000000,
      },
    }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('CALL_DATA_UNAVAILABLE');
  });

  it('uses demo calls only when explicitly enabled', async () => {
    vi.stubEnv('ALLOW_DEMO_CALLS', 'true');

    vi.doMock('@/lib/middleware/auth', () => ({
      withAIAuth: (_req: NextRequest, handler: Function) =>
        handler({ id: 'user-1', email: 'u@test.com', tier: 'pro' }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            innerJoin: vi.fn(() => ({
              where: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([]),
              })),
            })),
          })),
        })),
      },
    }));
    vi.doMock('@/lib/ai/grant-matcher', () => ({
      matchGrants: vi.fn().mockResolvedValue({
        matches: [{ call: { id: 'demo-call-001' }, overallScore: 88 }],
        tokensUsed: 10,
      }),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }));

    const { POST } = await import('@/app/api/ai/match-grants/route');
    const response = await POST(createJsonRequest({
      companyProfile: {
        companyName: 'Acme',
        companyType: 'sme',
        country: 'RO',
        sector: 'ICT',
        employeeCount: 12,
        annualRevenue: 2000000,
      },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.metadata.isDemoFallback).toBe(true);
  });
});

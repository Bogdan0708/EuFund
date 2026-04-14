import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

function createJsonRequest(path: string, body: unknown) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Tier-gated routes', () => {
  it('rejects proposal generation for free-tier users', async () => {
    vi.resetModules();
    vi.stubEnv('BILLING_ENABLED', 'true');

    vi.doMock('@/lib/middleware/auth', () => ({
      withAIAuth: (_req: NextRequest, handler: Function) =>
        handler({ id: 'user-1', email: 'u@test.com', tier: 'free' }),
    }));

    const { POST } = await import('@/app/api/ai/generate-proposal/route');
    const response = await POST(createJsonRequest('/api/ai/generate-proposal', {
      projectIdea: 'Automated compliance platform for EU applicants',
      fundingProgram: 'pnrr',
    }));
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('FORBIDDEN');
    vi.unstubAllEnvs();
  });

  it('allows proposal generation for pro-tier users', async () => {
    vi.resetModules();
    vi.stubEnv('BILLING_ENABLED', 'true');

    const generateProposal = vi.fn().mockResolvedValue({
      proposal: { title: 'Generated Proposal' },
      tokensUsed: 1000,
      ragSourcesUsed: 5,
    });

    vi.doMock('@/lib/ai/proposal-generator', () => ({ generateProposal }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }));
    vi.doMock('@/lib/middleware/auth', () => ({
      withAIAuth: (_req: NextRequest, handler: Function) =>
        handler({ id: 'user-1', email: 'u@test.com', tier: 'pro' }),
    }));

    const { POST } = await import('@/app/api/ai/generate-proposal/route');
    const response = await POST(createJsonRequest('/api/ai/generate-proposal', {
      projectIdea: 'Automated compliance platform for EU applicants',
      fundingProgram: 'pnrr',
    }));

    expect(response.status).toBe(200);
    expect(generateProposal).toHaveBeenCalledOnce();
    vi.unstubAllEnvs();
  });

  it('rejects MySMIS export for free-tier users', async () => {
    vi.resetModules();
    vi.stubEnv('BILLING_ENABLED', 'true');

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@test.com' }),
    }));
    vi.doMock('@/lib/middleware/tier-gate', async () => {
      const actual = await vi.importActual<typeof import('@/lib/middleware/tier-gate')>('@/lib/middleware/tier-gate');
      return {
        ...actual,
        requireTier: () => async () => {
          throw (await import('@/lib/errors')).Errors.forbidden();
        },
      };
    });

    const { GET } = await import('@/app/api/v1/projects/[id]/mysmis-export/route');
    const response = await GET(
      new NextRequest('http://localhost:3000/api/v1/projects/project-1/mysmis-export'),
      { params: { id: 'project-1' } },
    );
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('FORBIDDEN');
    vi.unstubAllEnvs();
  });
});

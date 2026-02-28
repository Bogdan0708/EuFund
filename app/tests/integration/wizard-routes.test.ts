import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('AI Wizard routes', () => {
  it('enhance-idea returns enhanced payload', async () => {
    vi.resetModules();

    vi.doMock('@/lib/middleware/auth', () => ({
      withAIAuth: vi.fn(async (_req: NextRequest, handler: (user: { id: string; tier: 'pro'; email: string }) => Promise<Response>) => {
        return handler({ id: 'user-1', tier: 'pro', email: 'u@test.com' });
      }),
    }));
    vi.doMock('@/lib/ai/client', () => ({
      aiGenerate: vi.fn().mockResolvedValue({ text: 'Enhanced idea\n- Suggestion 1\n- Suggestion 2', tokensUsed: 120 }),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

    const { POST } = await import('@/app/api/ai/wizard/enhance-idea/route');
    const req = new NextRequest('http://localhost:3000/api/ai/wizard/enhance-idea', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectIdea: 'O idee de proiect suficient de lungă pentru validare minimă.', locale: 'ro' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.success).toBe(true);
    expect(payload.data.enhancedIdea).toContain('Enhanced idea');
    expect(payload.data.suggestions.length).toBeGreaterThan(0);
  });

  it('match-calls returns ranked matches from DB calls', async () => {
    vi.resetModules();

    vi.doMock('@/lib/middleware/auth', () => ({
      withAIAuth: vi.fn(async (_req: NextRequest, handler: (user: { id: string; tier: 'pro'; email: string }) => Promise<Response>) => {
        return handler({ id: 'user-1', tier: 'pro', email: 'u@test.com' });
      }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            innerJoin: vi.fn(() => ({
              where: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([{
                  id: 'call-1',
                  callCode: 'PNRR-001',
                  titleRo: 'Call title',
                  descriptionRo: 'Call desc',
                  programName: 'PNRR',
                  eligibleTypes: ['srl'],
                  eligibleRegions: ['RO32'],
                  eligibleCaen: ['6201'],
                  budgetMin: '100000',
                  budgetMax: '500000',
                  cofinancingRate: '10',
                  durationMin: 6,
                  durationMax: 24,
                  submissionEnd: new Date('2026-12-15T17:00:00Z'),
                  status: 'deschis',
                }]),
              })),
            })),
          })),
        })),
      },
    }));
    vi.doMock('@/lib/ai/grant-matcher', () => ({
      matchGrants: vi.fn().mockResolvedValue({
        matches: [{
          call: { id: 'call-1', callCode: 'PNRR-001', titleRo: 'Call title', programName: 'PNRR' },
          eligibilityScore: 80,
          relevanceScore: 77,
          overallScore: 79,
          recommendations: [],
        }],
      }),
    }));
    vi.doMock('@/lib/ai/eu-ai-act', () => ({
      withEUAIActCompliance: vi.fn((_feature: string, fn: (payload: unknown) => Promise<unknown>) => {
        return async (payload: unknown) => {
          const out = await fn(payload) as { result: unknown };
          return { result: out.result, metadata: null };
        };
      }),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

    const { POST } = await import('@/app/api/ai/wizard/match-calls/route');
    const req = new NextRequest('http://localhost:3000/api/ai/wizard/match-calls', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectIdea: 'Idee de proiect pentru digitalizare în manufactură.',
        organization: { orgType: 'srl' },
        budget: 200000,
        locale: 'ro',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.success).toBe(true);
    expect(payload.data.matches.length).toBe(1);
  });

  it('generate-project returns proposal payload', async () => {
    vi.resetModules();

    vi.doMock('@/lib/middleware/auth', () => ({
      withAIAuth: vi.fn(async (_req: NextRequest, handler: (user: { id: string; tier: 'pro'; email: string }) => Promise<Response>) => {
        return handler({ id: 'user-1', tier: 'pro', email: 'u@test.com' });
      }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          callsForProposals: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'call-1',
              program: { code: 'PNRR', nameRo: 'PNRR' },
              evaluationCriteria: {},
              eligibleExpenses: {},
            }),
          },
        },
      },
    }));
    vi.doMock('@/lib/ai/proposal-generator', () => ({
      generateProposal: vi.fn().mockResolvedValue({
        proposal: {
          title: 'Titlu',
          acronym: 'ACR',
          summary: 'Rezumat',
          context: 'Context',
          objectives: { general: 'General', specific: ['S1'] },
          methodology: { approach: 'Approach', workPackages: [] },
          budget: { summary: 'Budget', categories: [] },
          indicators: [],
          sustainability: 'Sustainability',
          risks: [],
        },
        tokensUsed: 1000,
        ragSourcesUsed: 2,
      }),
    }));
    vi.doMock('@/lib/ai/fact-checker', () => ({
      factCheckGeneratedContent: vi.fn().mockReturnValue({
        annotated: {
          title: 'Titlu',
          acronym: 'ACR',
          summary: 'Rezumat',
          context: 'Context',
          objectives: { general: 'General', specific: ['S1'] },
          methodology: { approach: 'Approach', workPackages: [] },
          budget: { summary: 'Budget', categories: [] },
          indicators: [],
          sustainability: 'Sustainability',
          risks: [],
        },
        confidenceScore: 0.8,
        references: [],
        unverifiableClaims: [],
      }),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

    const { POST } = await import('@/app/api/ai/wizard/generate-project/route');
    const req = new NextRequest('http://localhost:3000/api/ai/wizard/generate-project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectIdea: 'Idee suficient de lungă pentru generare automată a propunerii.',
        callId: '11111111-1111-4111-8111-111111111111',
        organization: { orgName: 'Org', orgType: 'srl', sector: 'IT' },
        locale: 'ro',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.success).toBe(true);
    expect(payload.data.proposal.title).toBe('Titlu');
  });

  it('save-project persists project and version snapshot', async () => {
    vi.resetModules();

    const tx = { insert: vi.fn() };
    const dbMock = {
      transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<unknown>) => {
        let insertCount = 0;
        tx.insert = vi.fn(() => ({
          values: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue(insertCount++ === 0 ? [{ id: 'project-1' }] : []),
          })),
        }));
        return fn(tx);
      }),
    };

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
      requireOrgRole: vi.fn().mockResolvedValue('project_manager'),
    }));
    vi.doMock('@/lib/db', () => ({ db: dbMock }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

    const { POST } = await import('@/app/api/ai/wizard/save-project/route');
    const req = new NextRequest('http://localhost:3000/api/ai/wizard/save-project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        callId: '11111111-1111-4111-8111-111111111111',
        orgId: '22222222-2222-4222-8222-222222222222',
        proposal: {
          title: 'Titlu',
          summary: 'Rezumat',
          objectives: { general: 'General', specific: [] },
          methodology: { approach: 'Approach', workPackages: [] },
          budget: { summary: 'Budget', categories: [] },
          indicators: [],
          sustainability: 'Sustainability',
          risks: [],
        },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.success).toBe(true);
    expect(payload.data.id).toBe('project-1');
  });
});

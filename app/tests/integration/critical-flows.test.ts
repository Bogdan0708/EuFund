import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

function createJsonRequest(path: string, body: unknown, method = 'POST') {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Critical Flows and Isolation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('grant matching flow returns matches for authenticated users', async () => {
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
                limit: vi.fn().mockResolvedValue([
                  {
                    id: 'call-1',
                    callCode: 'POCIDIF-001',
                    titleRo: 'Digitalizare IMM',
                    descriptionRo: 'Call description',
                    programName: 'POCIDIF',
                    eligibleTypes: ['sme'],
                    eligibleRegions: ['RO'],
                    eligibleCaen: ['6201'],
                    budgetMin: '100000',
                    budgetMax: '500000',
                    cofinancingRate: '10',
                    durationMin: 6,
                    durationMax: 24,
                    submissionEnd: new Date('2026-12-31T00:00:00Z'),
                    status: 'deschis',
                  },
                ]),
              })),
            })),
          })),
        })),
      },
    }));
    vi.doMock('@/lib/ai/grant-matcher', () => ({
      matchGrants: vi.fn().mockResolvedValue({
        matches: [{ call: { id: 'call-1' }, overallScore: 91 }],
        tokensUsed: 123,
      }),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }));

    const { POST } = await import('@/app/api/ai/match-grants/route');
    const req = createJsonRequest('/api/ai/match-grants', {
      companyProfile: {
        companyName: 'Acme',
        companyType: 'sme',
        country: 'RO',
        sector: 'ICT',
        employeeCount: 12,
        annualRevenue: 2000000,
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.matches).toHaveLength(1);
  });

  it('idea enrichment flow logs user-bound audit events', async () => {
    const logAudit = vi.fn();
    vi.doMock('@/lib/middleware/auth', () => ({
      withAIAuth: (_req: NextRequest, handler: Function) =>
        handler({ id: 'user-99', email: 'u@test.com', tier: 'pro' }),
    }));
    vi.doMock('@/lib/ai/knowledge-engine', () => ({
      quickQualityCheck: vi.fn().mockReturnValue({ score: 70, gaps: [], strengths: ['ok'] }),
      generateKnowledgeRecommendations: vi.fn().mockResolvedValue({
        proposalImprovements: [],
        bestPractices: [],
        lessonsLearned: [],
        successPatterns: [],
        commonPitfalls: [],
        expertInsights: [],
        overallQualityScore: 80,
        readinessLevel: 'minor_revisions',
      }),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit }));

    const { POST } = await import('@/app/api/ai/generate-insights/route');
    const req = createJsonRequest('/api/ai/generate-insights', {
      projectTitle: 'Smart City Platform',
      projectSummary: 'A detailed summary of an EU-ready digital public service project.',
      programType: 'pnrr',
      sector: 'digital',
      quick: false,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-99' }));
  });

  it('application generation rejects invalid payloads and accepts valid ones', async () => {
    const generateProposal = vi.fn().mockResolvedValue({
      proposal: { title: 'Generated' },
      tokensUsed: 44,
      ragSourcesUsed: 2,
    });
    vi.doMock('@/lib/middleware/auth', () => ({
      withAIAuth: (_req: NextRequest, handler: Function) =>
        handler({ id: 'user-1', email: 'u@test.com', tier: 'pro' }),
    }));
    vi.doMock('@/lib/ai/proposal-generator', () => ({ generateProposal }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }));

    const { POST } = await import('@/app/api/ai/generate-proposal/route');

    const invalidRes = await POST(createJsonRequest('/api/ai/generate-proposal', { fundingProgram: 'pnrr' }));
    expect(invalidRes.status).toBe(400);

    const validRes = await POST(createJsonRequest('/api/ai/generate-proposal', {
      projectIdea: 'Automated compliance platform for EU applicants',
      fundingProgram: 'pnrr',
      organizationName: 'FondEU',
      organizationType: 'company',
    }));
    expect(validRes.status).toBe(200);
    expect(generateProposal).toHaveBeenCalled();
  });

  it('authorization boundary: document metadata is denied across tenants', async () => {
    const { Errors } = await import('@/lib/errors');
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-a', email: 'a@test.com' }),
      requireOrgRole: vi.fn().mockRejectedValue(Errors.forbidden()),
    }));
    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: any) => Promise<unknown>) => fn({
        query: {
          documents: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'doc-1',
              orgId: 'org-b',
              projectId: null,
              uploadedBy: 'user-b',
              storagePath: '2026-02-27/doc.pdf',
              filename: 'doc.pdf',
              mimeType: 'application/pdf',
              fileSize: 42,
              deletedAt: null,
            }),
          },
          projects: { findFirst: vi.fn() },
        },
        update: vi.fn(),
      })),
      db: {
        query: {
          documents: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'doc-1',
              orgId: 'org-b',
              projectId: null,
              uploadedBy: 'user-b',
              storagePath: '2026-02-27/doc.pdf',
              filename: 'doc.pdf',
              mimeType: 'application/pdf',
              fileSize: 42,
              deletedAt: null,
            }),
          },
        },
      },
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }));

    const { GET } = await import('@/app/api/documents/[id]/route');
    const req = new NextRequest('http://localhost:3000/api/documents/doc-1');
    const res = await GET(req, { params: { id: 'doc-1' } });

    expect(res.status).toBe(403);
  });

  it('tenant isolation: upload rejects org/project mismatch', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@test.com', name: 'U' }),
      requireOrgRole: vi.fn().mockResolvedValue('project_manager'),
    }));
    vi.doMock('@/lib/db', () => ({
      withUserRLS: vi.fn(async (_userId: string, fn: (tx: any) => Promise<unknown>) => fn({
        query: {
          projects: {
            findFirst: vi.fn().mockResolvedValue({ id: 'proj-2', orgId: 'org-2' }),
          },
        },
        insert: vi.fn(),
      })),
      db: {
        query: {
          projects: {
            findFirst: vi.fn().mockResolvedValue({ id: 'proj-2', orgId: 'org-2' }),
          },
        },
      },
    }));

    const { POST } = await import('@/app/api/documents/upload/route');
    const form = new FormData();
    form.set('orgId', 'org-1');
    form.set('projectId', 'proj-2');
    form.set('docType', 'altul');
    form.set('file', new File(['hello'], 'note.txt', { type: 'text/plain' }));
    const req = new NextRequest('http://localhost:3000/api/documents/upload', { method: 'POST', body: form });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

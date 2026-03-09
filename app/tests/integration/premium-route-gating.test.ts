import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

function createJsonRequest(path: string, body: unknown) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Premium route gating', () => {
  it('allows quick market intelligence for free-tier users', async () => {
    vi.resetModules();

    vi.doMock('@/lib/middleware/auth', () => ({
      withAIAuth: (_req: NextRequest, handler: Function) =>
        handler({ id: 'user-1', email: 'u@test.com', tier: 'free' }),
    }));

    const { POST } = await import('@/app/api/ai/market-intelligence/route');
    const response = await POST(createJsonRequest('/api/ai/market-intelligence', {
      projectBudget: 100000,
      romanianPartnerCount: 1,
      hasPublicProcurement: true,
      projectDurationMonths: 12,
      quick: true,
    }));

    expect(response.status).toBe(200);
  });

  it('rejects full market intelligence for free-tier users', async () => {
    vi.resetModules();

    vi.doMock('@/lib/middleware/auth', () => ({
      withAIAuth: (_req: NextRequest, handler: Function) =>
        handler({ id: 'user-1', email: 'u@test.com', tier: 'free' }),
    }));

    const { POST } = await import('@/app/api/ai/market-intelligence/route');
    const response = await POST(createJsonRequest('/api/ai/market-intelligence', {
      projectBudget: 100000,
      romanianPartnerCount: 1,
      hasPublicProcurement: true,
      projectDurationMonths: 12,
      quick: false,
    }));
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error.code).toBe('FORBIDDEN');
  });

  it('rejects full advanced analytics for free-tier users while keeping quick mode accessible', async () => {
    vi.resetModules();

    vi.doMock('@/lib/middleware/auth', () => ({
      withAIAuth: (_req: NextRequest, handler: Function) =>
        handler({ id: 'user-1', email: 'u@test.com', tier: 'free' }),
    }));

    const { POST } = await import('@/app/api/ai/advanced-analytics/route');

    const quickResponse = await POST(createJsonRequest('/api/ai/advanced-analytics', {
      organizationName: 'Org',
      projects: [],
      sector: 'ICT',
      quick: true,
    }));
    expect(quickResponse.status).toBe(200);

    const fullResponse = await POST(createJsonRequest('/api/ai/advanced-analytics', {
      organizationName: 'Org',
      projects: [],
      sector: 'ICT',
      quick: false,
    }));
    const json = await fullResponse.json();

    expect(fullResponse.status).toBe(403);
    expect(json.error.code).toBe('FORBIDDEN');
  });

  it('rejects advanced project health and report generation for free-tier users', async () => {
    vi.resetModules();

    vi.doMock('@/lib/middleware/auth', () => ({
      withAIAuth: (_req: NextRequest, handler: Function) =>
        handler({ id: 'user-1', email: 'u@test.com', tier: 'free' }),
    }));

    const { POST: projectHealthPOST } = await import('@/app/api/ai/project-health/route');
    const projectHealthResponse = await projectHealthPOST(createJsonRequest('/api/ai/project-health', {
      projectId: 'project-1',
      projectTitle: 'Project',
      mode: 'advanced',
      workPackages: [],
      budget: 0,
      spentBudget: 0,
    }));
    expect(projectHealthResponse.status).toBe(403);

    const { POST: reportPOST } = await import('@/app/api/ai/generate-report/route');
    const reportResponse = await reportPOST(createJsonRequest('/api/ai/generate-report', {
      projectId: 'project-1',
      projectTitle: 'Project',
      reportType: 'periodic',
      periodStart: '2026-01-01',
      periodEnd: '2026-02-01',
      budget: {
        total: 1000,
        spent: 100,
        coFinancingRate: 10,
        categories: [],
        partnerBudgets: [],
      },
      workPackages: [],
      milestones: [],
      risks: [],
      partners: [],
    }));
    expect(reportResponse.status).toBe(403);
  });

  it('keeps quick insights and quick partner matching free, but gates full analysis', async () => {
    vi.resetModules();

    vi.doMock('@/lib/middleware/auth', () => ({
      withAIAuth: (_req: NextRequest, handler: Function) =>
        handler({ id: 'user-1', email: 'u@test.com', tier: 'free' }),
    }));

    const { POST: insightsPOST } = await import('@/app/api/ai/generate-insights/route');
    const quickInsights = await insightsPOST(createJsonRequest('/api/ai/generate-insights', {
      projectTitle: 'Project',
      projectSummary: 'This is a sufficiently detailed summary for validation.',
      programType: 'pnrr',
      sector: 'ICT',
      quick: true,
    }));
    expect(quickInsights.status).toBe(200);

    const fullInsights = await insightsPOST(createJsonRequest('/api/ai/generate-insights', {
      projectTitle: 'Project',
      projectSummary: 'This is a sufficiently detailed summary for validation.',
      programType: 'pnrr',
      sector: 'ICT',
      quick: false,
    }));
    expect(fullInsights.status).toBe(403);

    const { POST: partnersPOST } = await import('@/app/api/ai/recommend-partners/route');
    const quickPartners = await partnersPOST(createJsonRequest('/api/ai/recommend-partners', {
      projectTitle: 'Project',
      projectSummary: 'This is a sufficiently detailed summary for validation.',
      programType: 'pnrr',
      totalBudget: 1000,
      requiredCapabilities: ['ai'],
      existingPartners: [],
      sector: 'ICT',
      quick: true,
    }));
    expect(quickPartners.status).toBe(200);

    const fullPartners = await partnersPOST(createJsonRequest('/api/ai/recommend-partners', {
      projectTitle: 'Project',
      projectSummary: 'This is a sufficiently detailed summary for validation.',
      programType: 'pnrr',
      totalBudget: 1000,
      requiredCapabilities: ['ai'],
      existingPartners: [],
      sector: 'ICT',
      quick: false,
    }));
    expect(fullPartners.status).toBe(403);
  });

  it('gates document analysis, consortium analysis, full project analysis, and non-quick deadline assessment for free-tier users', async () => {
    vi.resetModules();

    vi.doMock('@/lib/middleware/auth', () => ({
      withAIAuth: (_req: NextRequest, handler: Function) =>
        handler({ id: 'user-1', email: 'u@test.com', tier: 'free' }),
    }));

    const { POST: documentPOST } = await import('@/app/api/ai/analyze-document/route');
    const form = new FormData();
    form.set('file', new File(['this is enough text to pass content extraction'], 'note.txt', { type: 'text/plain' }));
    const documentResponse = await documentPOST(new NextRequest('http://localhost:3000/api/ai/analyze-document', {
      method: 'POST',
      body: form,
    }));
    expect(documentResponse.status).toBe(403);

    const { POST: consortiumPOST } = await import('@/app/api/ai/analyze-consortium/route');
    const consortiumResponse = await consortiumPOST(createJsonRequest('/api/ai/analyze-consortium', {
      projectId: 'project-1',
      partners: [],
      programType: 'pnrr',
      requiredCapabilities: [],
    }));
    expect(consortiumResponse.status).toBe(403);

    const { POST: projectAnalysisPOST } = await import('@/app/api/ai/project-analysis/route');
    const quickAnalysis = await projectAnalysisPOST(createJsonRequest('/api/ai/project-analysis', {
      mode: 'quick',
      projectId: 'project-1',
      projectTitle: 'Project',
      workPackages: [],
      deadline: '2026-12-31',
      budget: 1000,
      spentBudget: 100,
    }));
    expect(quickAnalysis.status).toBe(200);

    const fullAnalysis = await projectAnalysisPOST(createJsonRequest('/api/ai/project-analysis', {
      mode: 'full',
      projectId: 'project-1',
      projectTitle: 'Project',
      projectSummary: 'Detailed summary',
      programType: 'pnrr',
      budget: 1000,
      spentBudget: 100,
      durationMonths: 12,
      elapsedMonths: 2,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      workPackages: [],
      partners: [],
      organization: { type: 'srl', country: 'RO' },
    }));
    expect(fullAnalysis.status).toBe(403);

    const { POST: deadlinePOST } = await import('@/app/api/ai/deadline-risk-assessment/route');
    const quickDeadline = await deadlinePOST(createJsonRequest('/api/ai/deadline-risk-assessment', {
      type: 'quick',
      projectId: 'project-1',
      projectTitle: 'Project',
      workPackages: [],
      projectEnd: '2026-12-31',
    }));
    expect(quickDeadline.status).toBe(200);

    const fullDeadline = await deadlinePOST(createJsonRequest('/api/ai/deadline-risk-assessment', {
      type: 'deadline',
      projectId: 'project-1',
      projectTitle: 'Project',
      projectStart: '2026-01-01',
      projectEnd: '2026-12-31',
      submissionDeadline: '2026-10-01',
      workPackages: [],
    }));
    expect(fullDeadline.status).toBe(403);
  });

  it('gates compliance validation, lifecycle forecasting, ghid task generation, and wizard project generation for free-tier users', async () => {
    vi.resetModules();

    vi.doMock('@/lib/middleware/auth', () => ({
      withAIAuth: (_req: NextRequest, handler: Function) =>
        handler({ id: 'user-1', email: 'u@test.com', tier: 'free' }),
    }));

    const { POST: compliancePOST } = await import('@/app/api/ai/validate-compliance/route');
    const complianceResponse = await compliancePOST(createJsonRequest('/api/ai/validate-compliance', {
      proposalText: 'This is a long enough proposal text for compliance validation.',
      regulations: ['Reg 1'],
    }));
    expect(complianceResponse.status).toBe(403);

    const { POST: forecastPOST } = await import('@/app/api/ai/forecast-lifecycle/route');
    const forecastResponse = await forecastPOST(createJsonRequest('/api/ai/forecast-lifecycle', {
      projectId: 'project-1',
      parameters: {
        projectTitle: 'Project',
        programType: 'pnrr',
        totalBudget: 1000,
        spentBudget: 100,
        durationMonths: 12,
        elapsedMonths: 2,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        milestones: [],
        partners: [],
      },
    }));
    expect(forecastResponse.status).toBe(403);

    const { POST: ghidPOST } = await import('@/app/api/ai/ghid-to-tasks/route');
    const ghidResponse = await ghidPOST(createJsonRequest('/api/ai/ghid-to-tasks', {
      projectId: '123e4567-e89b-42d3-a456-426614174000',
      ghidText: 'x'.repeat(250),
    }));
    expect(ghidResponse.status).toBe(403);

    const { POST: wizardGeneratePOST } = await import('@/app/api/ai/wizard/generate-project/route');
    const wizardGenerateResponse = await wizardGeneratePOST(createJsonRequest('/api/ai/wizard/generate-project', {
      projectIdea: 'This is a sufficiently detailed project idea for the wizard flow.',
      callId: '123e4567-e89b-42d3-a456-426614174111',
      organization: {
        orgName: 'Org',
        orgType: 'srl',
      },
      locale: 'ro',
    }));
    expect(wizardGenerateResponse.status).toBe(403);
  });

  it('keeps quick success prediction free but gates full prediction for free-tier users', async () => {
    vi.resetModules();

    vi.doMock('@/lib/middleware/auth', () => ({
      withAIAuth: (_req: NextRequest, handler: Function) =>
        handler({ id: 'user-1', email: 'u@test.com', tier: 'free' }),
    }));
    vi.doMock('@/lib/ai/predictive-analytics', () => ({
      predictProposalSuccess: vi.fn().mockResolvedValue({
        successProbability: 0.81,
        confidenceLevel: 'high',
        strengths: [],
        weaknesses: [],
        recommendations: [],
        riskFactors: [],
        scoreBreakdown: {},
        benchmarkComparison: {},
      }),
      quickSuccessPrediction: vi.fn().mockReturnValue({
        successProbability: 0.55,
        confidenceLevel: 'low',
        strengths: [],
        weaknesses: [],
        recommendations: [],
        riskFactors: [],
        scoreBreakdown: {},
        benchmarkComparison: {},
      }),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          orgMembers: {
            findFirst: vi.fn(),
            findMany: vi.fn().mockResolvedValue([{ orgId: '123e4567-e89b-42d3-a456-426614174222' }]),
          },
        },
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'review-1' }]),
          }),
        }),
      },
    }));

    const { POST } = await import('@/app/api/ai/predict-success/route');

    const quickResponse = await POST(createJsonRequest('/api/ai/predict-success', {
      projectTitle: 'Project',
      projectSummary: 'This is a sufficiently detailed summary for prediction testing.',
      programType: 'pnrr',
      totalBudget: 1000,
      durationMonths: 12,
      sector: 'ICT',
      quick: true,
      partners: [{ name: 'Lead', country: 'RO', type: 'sme', role: 'coordinator' }],
    }));
    expect(quickResponse.status).toBe(200);

    const fullResponse = await POST(createJsonRequest('/api/ai/predict-success', {
      projectTitle: 'Project',
      projectSummary: 'This is a sufficiently detailed summary for prediction testing.',
      programType: 'pnrr',
      totalBudget: 1000,
      durationMonths: 12,
      sector: 'ICT',
      quick: false,
      partners: [{ name: 'Lead', country: 'RO', type: 'sme', role: 'coordinator' }],
    }));
    expect(fullResponse.status).toBe(403);
  });

  it('gates wizard chat and wizard idea enhancement for free-tier users', async () => {
    vi.resetModules();

    vi.doMock('@/lib/middleware/auth', () => ({
      authenticateAIUser: vi.fn().mockResolvedValue({
        user: { id: 'user-1', email: 'u@test.com', tier: 'free' },
      }),
      withAIAuth: (_req: NextRequest, handler: Function) =>
        handler({ id: 'user-1', email: 'u@test.com', tier: 'free' }),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('@/lib/rag/pipeline', () => ({
      hybridSearch: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock('ai', async (importOriginal) => {
      const orig = await importOriginal<typeof import('ai')>();
      return {
        ...orig,
        streamText: vi.fn(),
      };
    });
    vi.doMock('@/lib/ai/wizard-actions', () => ({
      enhanceProjectIdea: vi.fn(),
      matchFundingCalls: vi.fn(),
      generateProjectProposal: vi.fn(),
      saveWizardProject: vi.fn(),
    }));

    const { POST: wizardChatPOST } = await import('@/app/api/ai/wizard/chat/route');
    const wizardChatResponse = await wizardChatPOST(createJsonRequest('/api/ai/wizard/chat', {
      messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Help me build a project' }] }],
      locale: 'en',
    }));
    expect(wizardChatResponse.status).toBe(403);

    const { POST: wizardEnhancePOST } = await import('@/app/api/ai/wizard/enhance-idea/route');
    const wizardEnhanceResponse = await wizardEnhancePOST(createJsonRequest('/api/ai/wizard/enhance-idea', {
      projectIdea: 'This is a sufficiently detailed project idea for enhancement testing.',
      locale: 'ro',
    }));
    expect(wizardEnhanceResponse.status).toBe(403);
  });
});

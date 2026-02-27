import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('POST /api/ai/predict-success oversight enforcement', () => {
  it('returns pending_review with reviewUrl for quick mode', async () => {
    vi.resetModules();

    const quickSuccessPrediction = vi.fn().mockReturnValue({
      successProbability: 0.55,
      confidenceLevel: 'low',
      strengths: [],
      weaknesses: [],
      recommendations: [],
      riskFactors: [],
      scoreBreakdown: {},
      benchmarkComparison: {},
    });

    const insertReturning = vi.fn().mockResolvedValue([
      { id: '123e4567-e89b-42d3-a456-426614174111' },
    ]);
    const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });

    vi.doMock('@/lib/ai/predictive-analytics', () => ({
      predictProposalSuccess: vi.fn(),
      quickSuccessPrediction,
    }));
    vi.doMock('@/lib/middleware/auth', () => ({
      withAIAuth: (req: NextRequest, handler: (user: any) => Promise<any>) =>
        handler({ id: '123e4567-e89b-42d3-a456-426614174000', email: 'u@test.com', tier: 'free' }),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          orgMembers: {
            findFirst: vi.fn().mockResolvedValue({
              orgId: '123e4567-e89b-42d3-a456-426614174222',
            }),
          },
        },
        insert: vi.fn().mockReturnValue({ values: insertValues }),
      },
    }));

    const { POST } = await import('@/app/api/ai/predict-success/route');

    const request = new NextRequest('http://localhost:3000/api/ai/predict-success', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectTitle: 'Quick Project',
        projectSummary: 'This is a valid summary long enough for quick mode testing.',
        programType: 'horizon_europe',
        totalBudget: 100000,
        durationMonths: 12,
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
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.status).toBe('pending_review');
    expect(json.reviewId).toBe('123e4567-e89b-42d3-a456-426614174111');
    expect(json.reviewUrl).toBe('/api/v1/organizations/123e4567-e89b-42d3-a456-426614174222/ai-reviews?status=pending_review');
    expect(json.data).toBeUndefined();
    expect(quickSuccessPrediction).toHaveBeenCalledOnce();
  });
});

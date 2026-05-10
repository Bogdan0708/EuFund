import { describe, it, expect, vi, beforeEach } from 'vitest';
import { matchGrants } from '@/lib/ai/grant-matcher';
import { aiGenerateObject } from '@/lib/ai/client';
import { analyzeRomanianContent } from '@/lib/ai/romanian-specialist';
import { runEligibility } from '@/lib/ai/agent/services/eligibility';

vi.mock('@/lib/ai/client', () => ({
  aiGenerateObject: vi.fn(),
}));

vi.mock('@/lib/ai/romanian-specialist', () => ({
  analyzeRomanianContent: vi.fn(),
}));

vi.mock('@/lib/ai/agent/services/eligibility', () => ({
  runEligibility: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    child: vi.fn(() => ({
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    })),
  },
}));

const mockCalls = [
  {
    id: 'call-1',
    callCode: 'PNRR-1',
    titleRo: 'Digitalizare IMM',
    program: 'PNRR',
    status: 'deschis',
  },
  {
    id: 'call-2',
    callCode: 'POR-2',
    titleRo: 'Eficiență Energetică',
    program: 'POR',
    status: 'deschis',
  },
];

describe('matchGrants Migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('performs full matching cycle with eligibility and AI scoring', async () => {
    // 1. Mock eligibility to pass both calls
    (runEligibility as any).mockResolvedValue({
      score: 100,
      failCount: 0,
      results: [],
    });

    // 2. Mock Romanian analysis
    (analyzeRomanianContent as any).mockResolvedValue({ context: 'Grant Context' });

    // 3. Mock AI matching
    (aiGenerateObject as any).mockResolvedValue({
      object: {
        matches: [
          {
            callId: 'call-1',
            relevanceScore: 95,
            matchReason: 'Perfect for digitalization',
            recommendations: ['Focus on hardware'],
          },
          {
            callId: 'call-2',
            relevanceScore: 40,
            matchReason: 'Low relevance to energy',
            recommendations: ['Check other calls'],
          }
        ],
      },
      tokensUsed: 200,
      provider: 'openai',
      model: 'gpt-4o',
      tier: 'budget',
      romanianOptimized: true,
    });

    const result = await matchGrants(
      {
        projectIdea: 'Digitalizăm o firmă de consultanță',
        organization: { orgType: 'srl' },
        locale: 'ro',
      },
      mockCalls
    );

    expect(runEligibility).toHaveBeenCalledTimes(2);
    expect(analyzeRomanianContent).toHaveBeenCalled();
    expect(aiGenerateObject).toHaveBeenCalledWith(expect.objectContaining({
      taskType: 'grant_matching',
      romanianContext: 'Grant Context',
    }));

    expect(result.matches).toHaveLength(2);
    expect(result.matches[0].call.id).toBe('call-1');
    expect(result.matches[0].overallScore).toBe(97); // (100*0.4 + 95*0.6) = 40 + 57 = 97
    expect(result.romanianOptimized).toBe(true);
  });

  it('filters out ineligible calls before AI analysis', async () => {
    // Mock call-1 as fail, call-2 as pass
    (runEligibility as any).mockImplementation(async (_ctx: any, _input: any, callId: string) => {
      if (callId === 'call-1') return { failCount: 1, score: 0, results: [{ status: 'fail', message: 'Wrong org type' }] };
      return { failCount: 0, score: 100, results: [] };
    });

    (aiGenerateObject as any).mockResolvedValue({
      object: {
        matches: [
          {
            callId: 'call-2',
            relevanceScore: 80,
            matchReason: 'Good fit',
            recommendations: [],
          }
        ],
      },
      tokensUsed: 100,
    });

    const result = await matchGrants(
      {
        projectIdea: 'Test project',
        organization: { orgType: 'srl' },
        locale: 'en',
      },
      mockCalls
    );

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].call.id).toBe('call-2');
    
    // AI should only have seen call-2
    const aiCall = (aiGenerateObject as any).mock.calls[0][0];
    expect(aiCall.prompt).toContain('call-2');
    expect(aiCall.prompt).not.toContain('call-1');
  });

  it('returns empty results when no calls are viable', async () => {
    (runEligibility as any).mockResolvedValue({
      failCount: 1,
      score: 0,
      results: [],
    });

    const result = await matchGrants(
      {
        projectIdea: 'Test',
        organization: { orgType: 'srl' },
      },
      mockCalls
    );

    expect(result.matches).toHaveLength(0);
    expect(aiGenerateObject).not.toHaveBeenCalled();
  });
});

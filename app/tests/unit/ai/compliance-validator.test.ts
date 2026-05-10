import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateCompliance } from '@/lib/ai/compliance-validator';
import { aiGenerateObject } from '@/lib/ai/client';
import { analyzeRomanianContent } from '@/lib/ai/romanian-specialist';
import { runEligibilityRules } from '@/lib/rules/eligibility';
import { hybridSearch } from '@/lib/rag/pipeline';

vi.mock('@/lib/ai/client', () => ({
  aiGenerateObject: vi.fn(),
}));

vi.mock('@/lib/ai/romanian-specialist', () => ({
  analyzeRomanianContent: vi.fn(),
}));

vi.mock('@/lib/rules/eligibility', () => ({
  runEligibilityRules: vi.fn(() => ({ results: [], score: 100 })),
}));

vi.mock('@/lib/rag/pipeline', () => ({
  hybridSearch: vi.fn(() => []),
}));

vi.mock('@/lib/rules/dnsh', () => ({
  assessDNSH: vi.fn(() => ({ status: 'pass', finding: 'No harm', recommendation: '', legalReference: '', score: 100 })),
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

describe('validateCompliance Migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('performs full validation cycle with rules, RAG, and AI', async () => {
    (analyzeRomanianContent as any).mockResolvedValue({ context: 'Compliance Context' });
    (aiGenerateObject as any).mockResolvedValue({
      object: {
        checks: [
          { area: 'GDPR', status: 'pass', finding: 'Good', recommendation: '' },
        ],
        overallAssessment: 'Compliant',
        recommendations: ['Keep it up'],
      },
      tokensUsed: 150,
      provider: 'openai',
      model: 'gpt-4o',
      tier: 'budget',
      romanianOptimized: true,
    });

    const result = await validateCompliance({
      project: { title: 'Test Project' },
      organization: { orgType: 'srl' },
      locale: 'ro',
    });

    expect(runEligibilityRules).toHaveBeenCalled();
    expect(hybridSearch).toHaveBeenCalled();
    expect(analyzeRomanianContent).toHaveBeenCalled();
    expect(aiGenerateObject).toHaveBeenCalledWith(expect.objectContaining({
      taskType: 'classification',
      romanianContext: 'Compliance Context',
    }));

    expect(result.aiResults).toHaveLength(2); // GDPR + DNSH
    expect(result.overallScore).toBe(100);
    expect(result.romanianOptimized).toBe(true);
  });
});

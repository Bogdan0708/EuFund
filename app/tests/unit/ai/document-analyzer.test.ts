import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeDocument } from '@/lib/ai/document-analyzer';
import { aiGenerateObject } from '@/lib/ai/client';
import { analyzeRomanianContent } from '@/lib/ai/romanian-specialist';

vi.mock('@/lib/ai/client', () => ({
  aiGenerateObject: vi.fn(),
}));

vi.mock('@/lib/ai/romanian-specialist', () => ({
  analyzeRomanianContent: vi.fn(),
  getRomanianDocumentType: vi.fn(() => 'Test Doc Type'),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    child: vi.fn(() => ({
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    })),
    warn: vi.fn(),
  },
}));

describe('analyzeDocument Migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses Romanian specialization for non-English locales', async () => {
    (analyzeRomanianContent as any).mockResolvedValue({ context: 'Romanian Context' });
    (aiGenerateObject as any).mockResolvedValue({
      object: { 
        documentType: 'Cerere', 
        language: 'ro', 
        summary: 'Test', 
        keyFindings: [], 
        complianceGaps: [], 
        qualityScore: 90, 
        completenessScore: 85, 
        suggestions: [] 
      },
      tokensUsed: 100,
      provider: 'openai',
      model: 'gpt-4o',
      tier: 'budget',
      cached: false,
      romanianOptimized: true,
    });

    const result = await analyzeDocument({
      content: 'Conținut document în română',
      filename: 'test.pdf',
      mimeType: 'application/pdf',
      locale: 'ro',
    });

    expect(analyzeRomanianContent).toHaveBeenCalledWith(expect.objectContaining({
      context: 'document_analysis',
      documentType: 'Test Doc Type',
    }));

    expect(aiGenerateObject).toHaveBeenCalledWith(expect.objectContaining({
      taskType: 'document_analysis',
      romanianContext: 'Romanian Context',
    }));

    expect(result).toMatchObject({
      provider: 'openai',
      romanianOptimized: true,
      documentType: 'Test Doc Type',
    });
  });

  it('skips Romanian specialization for English locale', async () => {
    (aiGenerateObject as any).mockResolvedValue({
      object: { documentType: 'Proposal' },
      tokensUsed: 50,
      provider: 'openai',
      model: 'gpt-4o',
      tier: 'budget',
    });

    await analyzeDocument({
      content: 'English document content',
      filename: 'test.pdf',
      mimeType: 'application/pdf',
      locale: 'en',
    });

    expect(analyzeRomanianContent).not.toHaveBeenCalled();
    expect(aiGenerateObject).toHaveBeenCalledWith(expect.objectContaining({
      romanianContext: undefined,
    }));
  });

  it('detects PII and redacts high-severity items before AI call', async () => {
    (aiGenerateObject as any).mockResolvedValue({
      object: { documentType: 'Redacted' },
      tokensUsed: 10,
    });

    // Romanian CNP is 13 digits starting with 1 or 2
    const cnp = '1234567890123';
    const content = `User with CNP ${cnp} is here.`;

    await analyzeDocument({
      content,
      filename: 'pii.txt',
      mimeType: 'text/plain',
      locale: 'en',
    });

    const aiCall = (aiGenerateObject as any).mock.calls[0][0];
    expect(aiCall.prompt).toContain('[CNP_REDACTAT]');
    expect(aiCall.prompt).not.toContain(cnp);
  });
});

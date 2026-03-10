import { describe, expect, it } from 'vitest';
import { estimateContextTokens } from '@/lib/rag/pipeline';

describe('RAG token budgeting', () => {
  it('uses a more conservative estimate for Romanian diacritics', () => {
    const text = 'Știință, finanțări și conformitate pentru proiecte europene.';
    const estimated = estimateContextTokens(text);

    expect(estimated).toBeGreaterThanOrEqual(Math.ceil(Array.from(text).length / 4));
  });

  it('never returns less than one token for non-empty content', () => {
    expect(estimateContextTokens('a')).toBe(1);
  });
});

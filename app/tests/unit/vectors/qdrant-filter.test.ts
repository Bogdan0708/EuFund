import { describe, it, expect } from 'vitest';
import { toQdrantFilter } from '@/lib/vectors/store';

describe('toQdrantFilter', () => {
  it('returns undefined for empty or missing filter', () => {
    expect(toQdrantFilter(undefined)).toBeUndefined();
    expect(toQdrantFilter({})).toBeUndefined();
  });

  it('translates a single field into Qdrant must-match shape', () => {
    expect(toQdrantFilter({ program: 'PNRR' })).toEqual({
      must: [{ key: 'program', match: { value: 'PNRR' } }],
    });
  });

  it('translates multiple fields into ordered must entries', () => {
    expect(toQdrantFilter({ program: 'PNRR', region: 'NV' })).toEqual({
      must: [
        { key: 'program', match: { value: 'PNRR' } },
        { key: 'region', match: { value: 'NV' } },
      ],
    });
  });
});

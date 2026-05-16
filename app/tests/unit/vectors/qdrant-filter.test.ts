import { describe, it, expect } from 'vitest';
import { toQdrantFilter } from '@/lib/vectors/store';

const ORPHAN_EXCLUSION = { key: 'orphan', match: { value: true } };

describe('toQdrantFilter', () => {
  it('returns orphan must_not exclusion for empty or missing filter', () => {
    expect(toQdrantFilter(undefined)).toEqual({ must_not: [ORPHAN_EXCLUSION] });
    expect(toQdrantFilter({})).toEqual({ must_not: [ORPHAN_EXCLUSION] });
  });

  it('translates a single field into Qdrant must-match shape with orphan exclusion', () => {
    expect(toQdrantFilter({ program: 'PNRR' })).toEqual({
      must: [{ key: 'program', match: { value: 'PNRR' } }],
      must_not: [ORPHAN_EXCLUSION],
    });
  });

  it('translates multiple fields into ordered must entries with orphan exclusion', () => {
    expect(toQdrantFilter({ program: 'PNRR', region: 'NV' })).toEqual({
      must: [
        { key: 'program', match: { value: 'PNRR' } },
        { key: 'region', match: { value: 'NV' } },
      ],
      must_not: [ORPHAN_EXCLUSION],
    });
  });
});

import { describe, expect, it } from 'vitest';
import { toQdrantFilter } from '@/lib/vectors/store';

const ORPHAN_EXCLUSION = { key: 'orphan', match: { value: true } };

describe('toQdrantFilter — orphan exclusion', () => {
  it('returns an orphan must_not filter even when caller passes no filter', () => {
    expect(toQdrantFilter()).toEqual({ must_not: [ORPHAN_EXCLUSION] });
  });

  it('preserves caller-provided filters alongside the orphan exclusion', () => {
    expect(toQdrantFilter({ programCode: 'PNRR' })).toEqual({
      must: [{ key: 'programCode', match: { value: 'PNRR' } }],
      must_not: [ORPHAN_EXCLUSION],
    });
  });
});

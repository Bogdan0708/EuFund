import { describe, expect, it, vi } from 'vitest';
import {
  filterStrictPoints, canonicalizeBatch, type IngestPoint,
} from '../../scripts/lib/ingest-helpers';
import { type ResolverDb } from '../../scripts/lib/call-id-resolver';

const UUID = '11111111-1111-4111-8111-111111111111';

function db(present: Record<string, { kind: 'id' | 'code'; uuid: string; callCode: string }>): ResolverDb {
  return {
    findCallById: vi.fn(async (id) => {
      const m = Object.values(present).find((v) => v.kind === 'id' && v.uuid === id);
      return m ? { id, callCode: m.callCode } : null;
    }),
    findCallByCode: vi.fn(async (code) => {
      const m = present[code];
      return m && m.kind === 'code' ? { id: m.uuid, callCode: m.callCode } : null;
    }),
    findCallByExternalId: vi.fn(async () => null),
  };
}

describe('filterStrictPoints', () => {
  it('keeps resolvable points', async () => {
    const r = db({ 'PNRR/001': { kind: 'code', uuid: UUID, callCode: 'PNRR/001' } });
    const points: IngestPoint[] = [{ id: 1, payload: { callCode: 'PNRR/001' } } as never];
    const { kept, rejected } = await filterStrictPoints(r, points);
    expect(kept).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });
  it('rejects orphan points', async () => {
    const r = db({});
    const points: IngestPoint[] = [{ id: 2, payload: { callCode: 'unknown' } } as never];
    const { kept, rejected } = await filterStrictPoints(r, points);
    expect(kept).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].id).toBe(2);
  });
});

describe('canonicalizeBatch', () => {
  it('adds canonical snake_case keys to every resolvable point, preserving legacy keys', async () => {
    const r = db({ 'PNRR/001': { kind: 'code', uuid: UUID, callCode: 'PNRR/001' } });
    const points: IngestPoint[] = [{ id: 1, payload: { callCode: 'PNRR/001', programCode: 'PNRR' } } as never];
    const out = await canonicalizeBatch(r, points);
    expect(out[0].payload).toEqual({
      callCode: 'PNRR/001', programCode: 'PNRR',
      call_id: UUID, call_code: 'PNRR/001',
    });
  });
  it('returns the original payload unchanged for orphan points', async () => {
    const r = db({});
    const points: IngestPoint[] = [{ id: 1, payload: { callCode: 'unknown' } } as never];
    const out = await canonicalizeBatch(r, points);
    expect(out[0].payload).toEqual({ callCode: 'unknown' });
  });
});

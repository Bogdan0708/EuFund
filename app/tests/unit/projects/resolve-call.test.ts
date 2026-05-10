// app/tests/unit/projects/resolve-call.test.ts
import { describe, it, expect, vi } from 'vitest';
import { resolveCallForId } from '@/lib/projects/promotion';

vi.mock('@/lib/db/schema', () => ({
  callsForProposals: {
    id: 'calls.id',
    callCode: 'calls.call_code',
    externalId: 'calls.external_id',
    titleRo: 'calls.title_ro',
  },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c: any, v: any) => ({ kind: 'eq', c, v })),
  sql: vi.fn(),
}));

function makeTx(rowsByPredicate: Record<string, Array<{ id: string; titleRo: string | null }>>) {
  const calls: Array<{ predicateKey: string; limit: number }> = [];
  const tx = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((pred: any) => ({
          limit: vi.fn(async (n: number) => {
            const key = JSON.stringify(pred);
            calls.push({ predicateKey: key, limit: n });
            return rowsByPredicate[key] ?? [];
          }),
        })),
      })),
    })),
  } as any;
  return { tx, calls };
}

const UUID = '11111111-1111-4111-8111-111111111111';

describe('resolveCallForId', () => {
  it('matches by id when input is a UUID and a row exists (resolution=id)', async () => {
    const { tx } = makeTx({
      [JSON.stringify({ kind: 'eq', c: 'calls.id', v: UUID })]: [{ id: UUID, titleRo: 'Call A' }],
    });
    const out = await resolveCallForId(tx, UUID);
    expect(out).toEqual({ id: UUID, title: 'Call A', resolution: 'id' });
  });

  it('falls through to callCode when UUID prong misses', async () => {
    const { tx } = makeTx({
      [JSON.stringify({ kind: 'eq', c: 'calls.call_code', v: UUID })]: [
        { id: 'real-uuid', titleRo: 'Call B' },
      ],
    });
    const out = await resolveCallForId(tx, UUID);
    expect(out).toEqual({ id: 'real-uuid', title: 'Call B', resolution: 'callCode' });
  });

  it('skips id prong entirely when input is not UUID-shaped', async () => {
    const { tx, calls } = makeTx({
      [JSON.stringify({ kind: 'eq', c: 'calls.call_code', v: 'CODE-123' })]: [
        { id: 'cc-id', titleRo: 'Call C' },
      ],
    });
    const out = await resolveCallForId(tx, 'CODE-123');
    expect(out.resolution).toBe('callCode');
    const idProbeRan = calls.some((c) => c.predicateKey.includes('calls.id'));
    expect(idProbeRan).toBe(false);
  });

  it('returns externalId match when exactly one row exists (LIMIT 2)', async () => {
    const { tx, calls } = makeTx({
      [JSON.stringify({ kind: 'eq', c: 'calls.external_id', v: 'EXT-1' })]: [
        { id: 'ext-id', titleRo: 'Call D' },
      ],
    });
    const out = await resolveCallForId(tx, 'EXT-1');
    expect(out).toEqual({ id: 'ext-id', title: 'Call D', resolution: 'externalId' });
    const externalCall = calls.find((c) => c.predicateKey.includes('calls.external_id'));
    expect(externalCall?.limit).toBe(2);
  });

  it('returns unresolved when externalId matches multiple rows', async () => {
    const { tx } = makeTx({
      [JSON.stringify({ kind: 'eq', c: 'calls.external_id', v: 'EXT-DUPE' })]: [
        { id: 'a', titleRo: 'A' },
        { id: 'b', titleRo: 'B' },
      ],
    });
    const out = await resolveCallForId(tx, 'EXT-DUPE');
    expect(out).toEqual({ id: null, title: null, resolution: 'unresolved' });
  });

  it('returns unresolved when no prong matches', async () => {
    const { tx } = makeTx({});
    const out = await resolveCallForId(tx, 'UNKNOWN');
    expect(out).toEqual({ id: null, title: null, resolution: 'unresolved' });
  });
});

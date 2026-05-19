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
  discoveredCalls: {
    callId: 'discovered.call_id',
    contentHash: 'discovered.content_hash',
    title: 'discovered.title',
  },
  callKnowledge: {
    callId: 'knowledge.call_id',
    callTitle: 'knowledge.call_title',
    normalized: 'knowledge.normalized',
    canonicalCallId: 'knowledge.canonical_call_id',
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

  it('resolves a SHA-256 content hash through discovered_calls.call_id', async () => {
    const hash = 'a'.repeat(64);
    const { tx } = makeTx({
      [JSON.stringify({ kind: 'eq', c: 'discovered.content_hash', v: hash })]: [
        { callId: UUID, title: 'Discovery title' },
      ] as any,
      [JSON.stringify({ kind: 'eq', c: 'calls.id', v: UUID })]: [
        { id: UUID, titleRo: 'Canonical title' },
      ],
    });

    const out = await resolveCallForId(tx, hash);

    expect(out).toEqual({ id: UUID, title: 'Canonical title', resolution: 'discoveredContentHash' });
  });

  it('continues to call_knowledge.canonical_call_id when discovered_calls has a title but no callId', async () => {
    // Regression: discovered_calls rows can carry a non-null title while their
    // callId is still null (pre-import / pending state). The old code
    // short-circuited with the discovered title and never consulted
    // call_knowledge — which means a backfilled canonical FK on the matching
    // call_knowledge row was silently ignored, leaving the project unhealed.
    const hash = 'f'.repeat(64);
    const { tx } = makeTx({
      [JSON.stringify({ kind: 'eq', c: 'discovered.content_hash', v: hash })]: [
        { callId: null, title: 'Pending discovered title' },
      ] as any,
      [JSON.stringify({ kind: 'eq', c: 'knowledge.call_id', v: hash })]: [
        { canonicalCallId: UUID, callTitle: 'Knowledge title', normalized: {} },
      ] as any,
      [JSON.stringify({ kind: 'eq', c: 'calls.id', v: UUID })]: [
        { id: UUID, titleRo: 'Canonical title' },
      ],
    });

    const out = await resolveCallForId(tx, hash);

    expect(out).toEqual({ id: UUID, title: 'Canonical title', resolution: 'callKnowledge' });
  });

  it('falls back to discovered_calls.title only after every id-bearing path misses', async () => {
    // Symmetric guard: when nothing resolves to a real id, the discovered title
    // is still preferable to a null-titled unresolved result so the UI has
    // something to render.
    const hash = '1'.repeat(64);
    const { tx } = makeTx({
      [JSON.stringify({ kind: 'eq', c: 'discovered.content_hash', v: hash })]: [
        { callId: null, title: 'Last-resort discovered title' },
      ] as any,
      // No call_knowledge row exists for this hash.
    });

    const out = await resolveCallForId(tx, hash);

    expect(out).toEqual({ id: null, title: 'Last-resort discovered title', resolution: 'unresolved' });
  });

  it('prefers call_knowledge.canonical_call_id (the M1 FK) over normalized alias keys', async () => {
    // Regression: the M1 backfill writes the canonical UUID to
    // call_knowledge.canonical_call_id. Promotion previously only inspected
    // `normalized` aliases (callCode/externalId/...), so backfilled rows
    // whose normalized payload doesn't happen to carry an alias key — the
    // steady state post-backfill — silently stayed unresolved.
    const hash = 'd'.repeat(64);
    const { tx, calls } = makeTx({
      [JSON.stringify({ kind: 'eq', c: 'knowledge.call_id', v: hash })]: [
        { canonicalCallId: UUID, callTitle: 'Knowledge title', normalized: { requiredSections: ['x'] } },
      ] as any,
      [JSON.stringify({ kind: 'eq', c: 'calls.id', v: UUID })]: [
        { id: UUID, titleRo: 'Canonical title' },
      ],
    });

    const out = await resolveCallForId(tx, hash);

    expect(out).toEqual({ id: UUID, title: 'Canonical title', resolution: 'callKnowledge' });

    // Sanity check: exactly one probe against calls.id, against the canonical
    // UUID pulled from the knowledge row (the input is a SHA256, so the initial
    // direct-probe path skips the UUID prong entirely — any calls.id probe in
    // this call tree had to come from the canonical_call_id branch).
    const idProbes = calls.filter((c) => c.predicateKey.includes('"c":"calls.id"'));
    expect(idProbes).toHaveLength(1);
    expect(idProbes[0].predicateKey).toContain(`"v":"${UUID}"`);
  });

  it('falls back to normalized aliases when canonical_call_id is null (legacy un-backfilled row)', async () => {
    const hash = 'e'.repeat(64);
    const { tx } = makeTx({
      [JSON.stringify({ kind: 'eq', c: 'knowledge.call_id', v: hash })]: [
        { canonicalCallId: null, callTitle: 'Legacy title', normalized: { callCode: 'LEGACY-CODE' } },
      ] as any,
      [JSON.stringify({ kind: 'eq', c: 'calls.call_code', v: 'LEGACY-CODE' })]: [
        { id: 'legacy-uuid', titleRo: 'Legacy resolved title' },
      ],
    });

    const out = await resolveCallForId(tx, hash);

    expect(out).toEqual({ id: 'legacy-uuid', title: 'Legacy resolved title', resolution: 'callKnowledge' });
  });

  it('resolves a call_knowledge row through a stashed canonical call code', async () => {
    const hash = 'b'.repeat(64);
    const { tx } = makeTx({
      [JSON.stringify({ kind: 'eq', c: 'knowledge.call_id', v: hash })]: [
        { callTitle: 'Knowledge title', normalized: { callCode: 'CODE-123' } },
      ] as any,
      [JSON.stringify({ kind: 'eq', c: 'calls.call_code', v: 'CODE-123' })]: [
        { id: 'resolved-from-code', titleRo: 'Resolved title' },
      ],
    });

    const out = await resolveCallForId(tx, hash);

    expect(out).toEqual({ id: 'resolved-from-code', title: 'Resolved title', resolution: 'callKnowledge' });
  });

  it('keeps unresolved call_knowledge rows title-bearing when no canonical alias exists', async () => {
    const hash = 'c'.repeat(64);
    const { tx } = makeTx({
      [JSON.stringify({ kind: 'eq', c: 'knowledge.call_id', v: hash })]: [
        { callTitle: 'Human readable call title', normalized: {} },
      ] as any,
    });

    const out = await resolveCallForId(tx, hash);

    expect(out).toEqual({ id: null, title: 'Human readable call title', resolution: 'unresolved' });
  });
});

import { describe, expect, it } from 'vitest';
import {
  selectWinner, partitionByCanonicalId, type Row,
} from '../../scripts/backfill-call-knowledge-ids';

function row(over: Partial<Row>): Row {
  return {
    id: 'r1', callId: 'PNRR/001', canonicalCallId: null,
    structureConfidence: 0.5, contentExtractedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

describe('selectWinner', () => {
  it('keeps row with highest structure_confidence', () => {
    const a = row({ id: 'a', structureConfidence: 0.7 });
    const b = row({ id: 'b', structureConfidence: 0.9 });
    expect(selectWinner([a, b]).id).toBe('b');
  });
  it('breaks ties by latest content_extracted_at', () => {
    const a = row({ id: 'a', structureConfidence: 0.8, contentExtractedAt: new Date('2026-01-01') });
    const b = row({ id: 'b', structureConfidence: 0.8, contentExtractedAt: new Date('2026-03-01') });
    expect(selectWinner([a, b]).id).toBe('b');
  });
  it('returns the single row when no group', () => {
    expect(selectWinner([row({ id: 'a' })]).id).toBe('a');
  });
});

describe('partitionByCanonicalId', () => {
  it('groups winners by resolved UUID, lists losers and unresolved separately', () => {
    const r1 = row({ id: 'r1', structureConfidence: 0.9 });
    const r2 = row({ id: 'r2', structureConfidence: 0.5 });
    const r3 = row({ id: 'r3', structureConfidence: 0.6 });
    const resolutions = new Map<string, string>([['r1', 'UUID-A'], ['r2', 'UUID-A'], ['r3', 'UUID-B']]);
    const { winners, rejected, unresolved } = partitionByCanonicalId([r1, r2, r3], resolutions);
    expect(winners.map((w) => w.id).sort()).toEqual(['r1', 'r3']);
    expect(rejected.map((r) => r.id)).toEqual(['r2']);
    expect(unresolved).toHaveLength(0);
  });
  it('separates unresolved rows', () => {
    const r1 = row({ id: 'r1' });
    const { winners, rejected, unresolved } = partitionByCanonicalId([r1], new Map());
    expect(winners).toHaveLength(0);
    expect(rejected).toHaveLength(0);
    expect(unresolved.map((r) => r.id)).toEqual(['r1']);
  });
});

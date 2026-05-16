// Side-effect-free helpers for bulk-ingest --strict + canonicalization. Lives in a
// separate module so Vitest can import without triggering main() in
// bulk-ingest-rag-knowledge.ts.

import { resolveCallId, canonicalizePayload, type ResolverDb } from './call-id-resolver';

export interface IngestPoint {
  id: number | string;
  payload: Record<string, unknown>;
  vector?: number[];
}

export async function filterStrictPoints(
  db: ResolverDb,
  points: IngestPoint[],
): Promise<{ kept: IngestPoint[]; rejected: IngestPoint[] }> {
  const kept: IngestPoint[] = [];
  const rejected: IngestPoint[] = [];
  for (const p of points) {
    const r = await resolveCallId(db, p.payload);
    if (r.kind === 'orphan') rejected.push(p);
    else kept.push(p);
  }
  return { kept, rejected };
}

export async function canonicalizeBatch(
  db: ResolverDb,
  points: IngestPoint[],
): Promise<IngestPoint[]> {
  const out: IngestPoint[] = [];
  for (const p of points) {
    const r = await resolveCallId(db, p.payload);
    out.push({ ...p, payload: canonicalizePayload(p.payload, r) });
  }
  return out;
}

#!/usr/bin/env npx tsx
// M1: Read-only audit. Scrolls every point in the configured Qdrant collection,
// classifies it via the shared resolver, and writes a JSON artifact.
//
// Output shape:
//   {
//     summary: { ... percentages, counts, orphanTagging: { tagged, untagged } ... },
//     samples: { resolved: [...], resolvable_by_code: [...], resolvable_by_external_id: [...], orphan: [...] },
//                                                                          // 10-cap per bucket for human inspection
//     resolutions: [{ pointId, call_id, call_code, kind }, ...],             // EVERY resolvable point, preserving ID type
//     orphanIds: [ pointId, pointId, ... ]                                   // EVERY orphan, for patcher
//   }

import * as fs from 'fs';
import * as path from 'path';
import postgres from 'postgres';
import { QdrantClient } from './lib/qdrant-client';
import { resolveCallId, type ResolverDb, type Resolution } from './lib/call-id-resolver';

const COLLECTION = process.env.VECTOR_COLLECTION || 'eu_legislation';
const OUT_DIR = path.resolve(__dirname, 'classification-output');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
}

function buildResolverDb(sql: postgres.Sql): ResolverDb {
  return {
    findCallById: async (id) => {
      const r = await sql`SELECT id, call_code FROM calls_for_proposals WHERE id = ${id}::uuid LIMIT 1`;
      return r[0] ? { id: r[0].id, callCode: r[0].call_code } : null;
    },
    findCallByCode: async (code) => {
      const r = await sql`SELECT id, call_code FROM calls_for_proposals WHERE call_code = ${code} LIMIT 1`;
      return r[0] ? { id: r[0].id, callCode: r[0].call_code } : null;
    },
    findCallByExternalId: async (ext) => {
      // Ambiguity-safe: LIMIT 2 and only resolve if exactly one row matches.
      const r = await sql`SELECT id, call_code FROM calls_for_proposals WHERE external_id = ${ext} LIMIT 2`;
      if (r.length !== 1) return null;
      return { id: r[0].id, callCode: r[0].call_code };
    },
  };
}

async function main() {
  const sample = arg('--sample') ? parseInt(arg('--sample')!, 10) : null;
  if (!process.env.QDRANT_URL) throw new Error('QDRANT_URL not set');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');

  const sql = postgres(process.env.DATABASE_URL, { max: 4 });
  const client = new QdrantClient(process.env.QDRANT_URL, COLLECTION, process.env.QDRANT_API_KEY);
  const db = buildResolverDb(sql);

  const total = await client.getCount();
  console.log(`collection=${COLLECTION} total=${total} sample=${sample ?? 'all'}`);

  const counts: Record<Resolution['kind'], number> = {
    resolved: 0, resolvable_by_code: 0, resolvable_by_external_id: 0, orphan: 0,
  };
  const samples: Record<Resolution['kind'], Array<{ id: string | number; payload: Record<string, unknown> }>> = {
    resolved: [], resolvable_by_code: [], resolvable_by_external_id: [], orphan: [],
  };
  const resolutions: Array<{ pointId: string | number; call_id: string; call_code: string | null; kind: Resolution['kind'] }> = [];
  const orphanIds: Array<string | number> = [];
  let orphanTagged = 0;
  let orphanUntagged = 0;

  let scanned = 0;
  for await (const point of client.scrollAll({ batchSize: 256 })) {
    scanned++;
    const payload = (point.payload ?? {}) as Record<string, unknown>;
    const r = await resolveCallId(db, payload);
    counts[r.kind]++;
    if (samples[r.kind].length < 10) samples[r.kind].push({ id: point.id, payload });
    if (r.kind === 'orphan') {
      orphanIds.push(point.id);                                     // FULL list, not capped
      if (payload.orphan === true) orphanTagged++;
      else orphanUntagged++;
    } else {
      resolutions.push({ pointId: point.id, call_id: r.callId, call_code: r.callCode, kind: r.kind });
    }
    if (scanned % 500 === 0) process.stdout.write(`scanned=${scanned}\r`);
    if (sample !== null && scanned >= sample) break;
  }

  const totalClassified = counts.resolved + counts.resolvable_by_code + counts.resolvable_by_external_id + counts.orphan;
  const pct = (n: number) => totalClassified === 0 ? 0 : (n / totalClassified * 100).toFixed(2);
  const summary = {
    timestamp: new Date().toISOString(),
    collection: COLLECTION,
    totalInCollection: total,
    scanned: totalClassified,
    counts,
    orphanTagging: {
      tagged: orphanTagged,
      untagged: orphanUntagged,
    },
    percentages: {
      resolved: pct(counts.resolved),
      resolvable_by_code: pct(counts.resolvable_by_code),
      resolvable_by_external_id: pct(counts.resolvable_by_external_id),
      orphan: pct(counts.orphan),
      total_resolvable: pct(counts.resolved + counts.resolvable_by_code + counts.resolvable_by_external_id),
    },
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = summary.timestamp.replace(/[:.]/g, '-');
  const outPath = path.join(OUT_DIR, `call-identity-audit-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ summary, samples, resolutions, orphanIds }, null, 2));

  console.log(`\n=== summary ===`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nAudit artifact: ${outPath}`);
  console.log(`Orphan IDs: ${orphanIds.length} (full list in artifact)`);
  await sql.end({ timeout: 2 });
}

if (require.main === module) {
  main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
}

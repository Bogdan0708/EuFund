#!/usr/bin/env npx tsx
// M1: populate call_knowledge.canonical_call_id + dedupe.
// Backup order:
//   1. FULL table dump to GCS (every row, pre-state).
//   2. Rejected-duplicate dump to GCS (subset, pre-delete).
// Then in one transaction: UPDATE winners SET canonical_call_id; DELETE rejected.
// Run AFTER migration 0042 (column exists) and BEFORE migration 0043 (unique index).
import * as fs from 'fs';
import { execSync } from 'child_process';
import postgres from 'postgres';
import { resolveCallId, type ResolverDb } from './lib/call-id-resolver';

export interface Row {
  id: string;
  callId: string;
  canonicalCallId: string | null;
  structureConfidence: number;
  contentExtractedAt: Date;
}

export function selectWinner(group: Row[]): Row {
  return group.reduce((best, r) => {
    if (r.structureConfidence > best.structureConfidence) return r;
    if (r.structureConfidence < best.structureConfidence) return best;
    return r.contentExtractedAt > best.contentExtractedAt ? r : best;
  });
}

export function partitionByCanonicalId(
  rows: Row[],
  resolutions: Map<string, string>,
): { winners: Row[]; rejected: Row[]; unresolved: Row[] } {
  const groups = new Map<string, Row[]>();
  const unresolved: Row[] = [];
  for (const r of rows) {
    const uuid = resolutions.get(r.id);
    if (!uuid) { unresolved.push(r); continue; }
    const g = groups.get(uuid) ?? [];
    g.push(r);
    groups.set(uuid, g);
  }
  const winners: Row[] = [];
  const rejected: Row[] = [];
  for (const [, group] of groups) {
    const w = selectWinner(group);
    winners.push(w);
    for (const r of group) if (r.id !== w.id) rejected.push(r);
  }
  return { winners, rejected, unresolved };
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
      const r = await sql`SELECT id, call_code FROM calls_for_proposals WHERE external_id = ${ext} LIMIT 2`;
      if (r.length !== 1) return null;
      return { id: r[0].id, callCode: r[0].call_code };
    },
  };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const confirm = process.argv.includes('--confirm');
  if (!dryRun && !confirm) { console.error('Pass --dry-run or --confirm'); process.exit(2); }
  if (dryRun && confirm)   { console.error('Pass exactly one'); process.exit(2); }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');
  const gcsBucket = process.env.GCS_BUCKET || 'fondeu-platform-storage';

  const sql = postgres(process.env.DATABASE_URL, { max: 4 });
  const db = buildResolverDb(sql);

  // 1. Load every call_knowledge row + extra columns for the full backup.
  const rowsRaw = await sql`
    SELECT id, call_id, canonical_call_id, program, call_title, normalized, status,
           structure_confidence, freshness_confidence, source_docs, field_provenance,
           content_extracted_at, freshness_checked_at, created_at, updated_at
      FROM call_knowledge
  `;
  const rows: Row[] = rowsRaw.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    callId: r.call_id as string,
    canonicalCallId: (r.canonical_call_id as string | null) ?? null,
    structureConfidence: Number(r.structure_confidence),
    contentExtractedAt: new Date(r.content_extracted_at as string),
  }));
  console.log(`call_knowledge rows: ${rows.length}`);

  // 2. Resolve each row's text call_id.
  const resolutions = new Map<string, string>();
  for (const r of rows) {
    const resolution = await resolveCallId(db, { call_id: r.callId, call_code: r.callId });
    if (resolution.kind !== 'orphan') resolutions.set(r.id, resolution.callId);
  }

  // 3. Partition + select winners.
  const { winners, rejected, unresolved } = partitionByCanonicalId(rows, resolutions);
  console.log(`winners=${winners.length} rejected_duplicates=${rejected.length} unresolved=${unresolved.length}`);

  if (dryRun) {
    console.error('\n=== summary (DRY-RUN) ===');
    console.error(`would set canonical_call_id on:                  ${winners.length} rows`);
    console.error(`would delete duplicate rows (post-GCS-backup):   ${rejected.length}`);
    console.error(`would leave unresolved (canonical_call_id=NULL): ${unresolved.length}`);
    await sql.end({ timeout: 2 });
    return;
  }

  // 4. FULL TABLE BACKUP to GCS — every row, pre-mutation.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fullBackupPath = `/tmp/call-knowledge-full-${stamp}.jsonl`;
  fs.writeFileSync(
    fullBackupPath,
    rowsRaw.map((r) => JSON.stringify(r)).join('\n'),
  );
  const fullGcs = `gs://${gcsBucket}/operator-audits/m1/call-knowledge-full-${stamp}.jsonl`;
  execSync(`gcloud storage cp ${fullBackupPath} ${fullGcs}`, { stdio: 'inherit' });
  console.log(`full-table backup (${rows.length} rows) → ${fullGcs}`);

  // 5. Rejected-duplicates backup to GCS — pre-delete.
  const rejectedRaw = rowsRaw.filter((r) => rejected.some((rj) => rj.id === r.id));
  const rejectedBackupPath = `/tmp/call-knowledge-rejected-${stamp}.jsonl`;
  fs.writeFileSync(
    rejectedBackupPath,
    rejectedRaw.map((r) => JSON.stringify(r)).join('\n'),
  );
  const rejectedGcs = `gs://${gcsBucket}/operator-audits/m1/call-knowledge-rejected-${stamp}.jsonl`;
  execSync(`gcloud storage cp ${rejectedBackupPath} ${rejectedGcs}`, { stdio: 'inherit' });
  console.log(`rejected-rows backup (${rejected.length} rows) → ${rejectedGcs}`);

  // 6. Apply in one transaction.
  // Cast: postgres 3.x Omit<Sql,...> in TransactionSql drops the call signature
  // in TS even though the tagged template works at runtime.
  await sql.begin(async (txn) => {
    const tx = txn as unknown as postgres.Sql;
    for (const w of winners) {
      const uuid = resolutions.get(w.id)!;
      await tx`UPDATE call_knowledge SET canonical_call_id = ${uuid}::uuid, updated_at = NOW() WHERE id = ${w.id}::uuid`;
    }
    if (rejected.length > 0) {
      const ids = rejected.map((r) => r.id);
      await tx`DELETE FROM call_knowledge WHERE id = ANY(${ids}::uuid[])`;
    }
  });
  console.log(`updated=${winners.length} deleted=${rejected.length}`);
  await sql.end({ timeout: 2 });
}

if (require.main === module) {
  main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
}

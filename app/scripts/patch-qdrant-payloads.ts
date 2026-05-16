#!/usr/bin/env npx tsx
// M1: Consumes the audit artifact (full orphanIds + full resolutions list) and
// applies canonical payloads:
//   - Every resolvable_by_* point gets { call_id, call_code }.
//   - Every `resolved` point gets a top-up so call_code is present even if the
//     live payload was missing it (audit only sees what it scrolled).
//   - Every orphan in audit.orphanIds gets { orphan: true }.
// setPayload is additive — re-runs are no-ops.
import * as fs from 'fs';
import { QdrantClient } from './lib/qdrant-client';

const COLLECTION = process.env.VECTOR_COLLECTION || 'eu_legislation';

export interface AuditArtifact {
  summary: { timestamp: string; counts: Record<string, number> };
  samples: Record<string, Array<{ id: string | number; payload: Record<string, unknown> }>>;
  resolutions: Array<{ pointId: string | number; call_id: string; call_code: string | null; kind: string }>;
  orphanIds: Array<string | number>;
}

export interface PatchEntry {
  pointId: string | number;
  payload: Record<string, unknown>;
}

export interface PatchPlan {
  patches: PatchEntry[];
  orphanTags: PatchEntry[];
}

export function buildPatchPlan(audit: AuditArtifact): PatchPlan {
  const patches: PatchEntry[] = audit.resolutions.map((r) => {
    const payload: Record<string, unknown> = { call_id: r.call_id };
    if (r.call_code) payload.call_code = r.call_code;
    return { pointId: r.pointId, payload };
  });
  const orphanTags: PatchEntry[] = audit.orphanIds.map((id) => ({
    pointId: id,
    payload: { orphan: true },
  }));
  return { patches, orphanTags };
}

export interface PatchClient {
  setPayload(pointIds: Array<string | number>, payload: Record<string, unknown>): Promise<void>;
}

export async function applyPatchPlan(
  client: PatchClient,
  plan: PatchPlan,
  opts: { dryRun: boolean },
): Promise<{ patched: number; tagged: number; skipped: number }> {
  if (opts.dryRun) {
    return { patched: 0, tagged: 0, skipped: plan.patches.length + plan.orphanTags.length };
  }
  let patched = 0;
  for (const entry of plan.patches) {
    await client.setPayload([entry.pointId], entry.payload);
    patched++;
  }
  let tagged = 0;
  for (const entry of plan.orphanTags) {
    await client.setPayload([entry.pointId], entry.payload);
    tagged++;
  }
  return { patched, tagged, skipped: 0 };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
}

async function main() {
  const auditPath = arg('--audit');
  const dryRun = process.argv.includes('--dry-run');
  const confirm = process.argv.includes('--confirm');
  if (!auditPath) { console.error('--audit <path> required'); process.exit(2); }
  if (!dryRun && !confirm) { console.error('Pass --dry-run or --confirm'); process.exit(2); }
  if (dryRun && confirm) { console.error('Pass exactly one of --dry-run / --confirm'); process.exit(2); }
  if (!process.env.QDRANT_URL) throw new Error('QDRANT_URL not set');

  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8')) as AuditArtifact;
  const plan = buildPatchPlan(audit);
  console.log(`audit=${auditPath} patches=${plan.patches.length} orphanTags=${plan.orphanTags.length} mode=${dryRun ? 'DRY-RUN' : 'CONFIRM'}`);

  const client = new QdrantClient(process.env.QDRANT_URL, COLLECTION, process.env.QDRANT_API_KEY);
  const result = await applyPatchPlan(client, plan, { dryRun });
  console.log(`patched=${result.patched} tagged=${result.tagged} skipped=${result.skipped}`);
}

if (require.main === module) {
  main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
}

#!/usr/bin/env npx tsx
// ═══════════════════════════════════════════════════════════════════════
// Session-to-Project Backfill (operator-driven, dry-run by default)
// ═══════════════════════════════════════════════════════════════════════
//
// Usage:
//   cd app
//   # Dry-run (default; no DB writes — but does take row locks briefly)
//   npx tsx --env-file=.env.local scripts/backfill-session-projects.ts
//
//   # Apply (commits changes for each promotable session)
//   npx tsx --env-file=.env.local scripts/backfill-session-projects.ts --confirm
//
//   # Limit to N rows (staged rollout)
//   npx tsx --env-file=.env.local scripts/backfill-session-projects.ts --confirm --limit 5
//
// IMPORTANT — dry-run mechanics:
// The script invokes the same ensureProjectForSession() that the live
// trigger sites use. In dry-run mode the helper opens a transaction,
// runs every step (including Personal Workspace org creation for users
// with zero memberships), then rolls back via DryRunRollback. Operators
// will NOT see audit-log entries or project_promotion_total metric
// increments after a dry-run — this is correct behavior, not a silent
// failure.

// SAFE TO IMPORT: this module has no top-level side effects. All env
// reads, argv parsing, DB connections, and the main loop run only when
// main() is invoked from the bottom-of-file guard. This makes processRow
// importable from the unit test without firing process.exit() or
// connecting to a database at import time.

import { fileURLToPath } from 'url';
import postgres from 'postgres';
import { ensureProjectForSession } from '../src/lib/projects/promotion';
import type { ServiceContext } from '../src/lib/ai/agent/services/types';

export interface CandidateRow {
  id: string;
  user_id: string;
  selected_call_id: string;
  user_exists: boolean;
}

export interface Tally {
  promoted: number;
  alreadyLinked: number;
  syncedCall: number;
  skippedNoSelectedCall: number;
  skippedMissingUser: number;
  failed: number;
}

interface ProcessOpts { confirm: boolean }

export async function processRow(
  row: CandidateRow,
  opts: ProcessOpts,
  tally: Tally,
): Promise<boolean> {
  if (!row.user_exists) {
    tally.skippedMissingUser++;
    console.log(`SKIP missing-user  | ${row.id} | user=${row.user_id}`);
    return false;
  }

  const ctx: ServiceContext = {
    userId: row.user_id,
    sessionId: row.id,
    requestId: crypto.randomUUID(),
    now: new Date(),
  };

  try {
    const result = await ensureProjectForSession(ctx, row.id, { dryRun: !opts.confirm });
    if (result.promoted) {
      if (result.created) {
        tally.promoted++;
        console.log(`PROMOTE            | ${row.id} | call=${row.selected_call_id} | proj=${result.projectId} | resolution=${result.selectedCallResolution} | titleSource=${result.titleSource}`);
      } else if ((result as any).synced === true) {
        tally.syncedCall++;
        console.log(`SYNC               | ${row.id} | call=${row.selected_call_id} | proj=${result.projectId}`);
      } else {
        tally.alreadyLinked++;
        console.log(`NOOP already-linked| ${row.id} | proj=${result.projectId}`);
      }
      return false;
    }
    if (result.reason === 'NO_SELECTED_CALL') {
      tally.skippedNoSelectedCall++;
      console.log(`SKIP no-call       | ${row.id}`);
      return false;
    }
    if (result.reason === 'USER_NOT_FOUND') {
      tally.skippedMissingUser++;
      console.log(`SKIP missing-user  | ${row.id}`);
      return false;
    }
    tally.failed++;
    console.log(`FAIL ${result.reason} | ${row.id}`);
    return true;
  } catch (err) {
    tally.failed++;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`ERROR              | ${row.id} | ${msg}`);
    return true;
  }
}

async function main() {
  // env + argv parsing inside main() so the module is import-safe
  if (!process.env.DATABASE_URL) {
    console.error('error: DATABASE_URL must be set');
    process.exit(1);
  }
  const CONFIRM = process.argv.includes('--confirm');
  const limitIdx = process.argv.indexOf('--limit');
  const LIMIT: number | null = limitIdx >= 0 && process.argv[limitIdx + 1]
    ? parseInt(process.argv[limitIdx + 1], 10)
    : null;

  const sqlClient = postgres(process.env.DATABASE_URL!, { max: 1 });

  const candidates = await sqlClient<CandidateRow[]>`
    SELECT s.id, s.user_id, s.selected_call_id,
           (u.id IS NOT NULL) AS user_exists
    FROM agent_sessions s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.project_id IS NULL AND s.selected_call_id IS NOT NULL
    ORDER BY s.created_at
    ${LIMIT !== null ? sqlClient`LIMIT ${LIMIT}` : sqlClient``}
  `;

  console.log(`mode: ${CONFIRM ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`candidates: ${candidates.length}`);
  console.log('');

  const tally: Tally = {
    promoted: 0, alreadyLinked: 0, syncedCall: 0,
    skippedNoSelectedCall: 0, skippedMissingUser: 0, failed: 0,
  };

  let anyFailure = false;
  for (const row of candidates) {
    const failed = await processRow(row, { confirm: CONFIRM }, tally);
    if (failed) anyFailure = true;
  }

  console.log('');
  console.log('summary:');
  console.log(`  promoted             : ${tally.promoted}`);
  console.log(`  alreadyLinked        : ${tally.alreadyLinked}`);
  console.log(`  syncedCall           : ${tally.syncedCall}`);
  console.log(`  skippedNoSelectedCall: ${tally.skippedNoSelectedCall}`);
  console.log(`  skippedMissingUser   : ${tally.skippedMissingUser}`);
  console.log(`  failed               : ${tally.failed}`);

  await sqlClient.end();
  process.exit(anyFailure ? 1 : 0);
}

// Main guard: only run main() when this file is invoked directly via
// `npx tsx scripts/backfill-session-projects.ts`, not when imported
// from a test. import.meta.url comparison is the standard ESM idiom.
if (import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('fatal:', err);
    process.exit(1);
  });
}

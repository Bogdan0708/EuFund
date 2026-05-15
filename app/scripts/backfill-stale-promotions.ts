// scripts/backfill-stale-promotions.ts
//
// One-shot backfill: promote agent sessions that committed to a funding call
// (selected_call_id IS NOT NULL) but never got a project row (project_id IS
// NULL) because of the pre-0040 schema drift on projects.completion_status.
// Drives the same code path the runtime would have driven if the INSERT had
// not failed — ensureProjectForSession — so org auto-pick, call resync, and
// audit logging behave identically to a "real" agent-driven promotion.
//
// SCOPE: the unfiltered candidate query targets EVERY session matching
// `selected_call_id IS NOT NULL AND project_id IS NULL`, regardless of
// status or age. That includes sessions that were `completed`/`abandoned`
// long before the incident. Use the audit script's status/phase/age
// breakdown to pick a narrower slice, then pass `--status=…`, `--phase=…`,
// `--since=YYYY-MM-DD`, or one/more `--session-id=<uuid>` flags to scope
// the run. Filters AND together. `--exclude-status=…` and
// `--exclude-phase=…` are also supported.
//
// DRY-RUN NOTE: dry-run is exact for the fresh-promotion branch (Branch B in
// promotion.ts:283-348), which is the only branch our candidate query
// (project_id IS NULL) can hit. If another writer races a project_id onto a
// row between our scan and the service call, the service falls into Branch A
// and may UPDATE project metadata before returning — Branch A does NOT honor
// `opts.dryRun`. To minimize this window, the script re-reads each row's
// project_id immediately before the call and skips it as `raced` if it has
// since been set. Residual race risk is bounded by the gap between that
// re-read and the SELECT FOR UPDATE inside the service.
//
// SAFETY: aborts if `projects.completion_status` does not exist in prod
// (migration 0040 not applied). The runtime promotion is still broken
// in that state, so backfilling would re-hit the same failure.
//
// Usage:
//   cd app
//   npx tsx scripts/backfill-stale-promotions.ts --dry-run
//   npx tsx scripts/backfill-stale-promotions.ts --dry-run --status=active --since=2026-04-14
//   RESULTS_FILE=/tmp/backfill.jsonl npx tsx scripts/backfill-stale-promotions.ts --confirm --status=active
//
// Re-runs are no-ops: rows whose project_id has since been set fall out of
// the candidate query, and ensureProjectForSession's Branch A short-circuits
// on already-linked sessions if any slip through.

import { db } from '@/lib/db'
import { agentSessions } from '@/lib/db/schema'
import { ensureProjectForSession } from '@/lib/projects/promotion'
import type { ServiceContext } from '@/lib/ai/agent/services/types'
import type { PromotionResult } from '@/lib/projects/promotion'
import { and, eq, gte, inArray, isNull, isNotNull, notInArray, sql } from 'drizzle-orm'
import { logger } from '@/lib/logger'
import { randomUUID } from 'crypto'
import * as fs from 'fs'

const BATCH_SIZE = 50

type SessionStatus = 'active' | 'paused' | 'completed' | 'abandoned' | 'error'
type SessionPhase = 'discovery' | 'research' | 'structuring' | 'drafting' | 'review'
const ALL_STATUSES: SessionStatus[] = ['active', 'paused', 'completed', 'abandoned', 'error']
const ALL_PHASES: SessionPhase[] = ['discovery', 'research', 'structuring', 'drafting', 'review']

interface CLIFlags {
  dryRun: boolean
  confirm: boolean
  status: SessionStatus[] | null
  excludeStatus: SessionStatus[]
  phase: SessionPhase[] | null
  excludePhase: SessionPhase[]
  since: Date | null
  sessionIds: string[]
  maxRows: number | null
}

interface RowResult {
  sessionId: string
  userId: string
  outcome:
    | 'promoted_new'
    | 'promoted_synced'
    | 'already_linked'
    | 'resync_unresolved'
    | 'not_promoted'
    | 'raced'
    | 'error'
  reason?: string
  projectId?: string
  errorMessage?: string
}

function parseFlags(argv: string[]): CLIFlags {
  const flags: CLIFlags = {
    dryRun: false,
    confirm: false,
    status: null,
    excludeStatus: [],
    phase: null,
    excludePhase: [],
    since: null,
    sessionIds: [],
    maxRows: null,
  }
  const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
  const assertStatus = (v: string): SessionStatus => {
    if (!(ALL_STATUSES as string[]).includes(v)) throw new Error(`invalid status "${v}"`)
    return v as SessionStatus
  }
  const assertPhase = (v: string): SessionPhase => {
    if (!(ALL_PHASES as string[]).includes(v)) throw new Error(`invalid phase "${v}"`)
    return v as SessionPhase
  }
  for (const arg of argv) {
    if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--confirm') flags.confirm = true
    else if (arg.startsWith('--status=')) flags.status = splitList(arg.slice(9)).map(assertStatus)
    else if (arg.startsWith('--exclude-status=')) flags.excludeStatus = splitList(arg.slice(17)).map(assertStatus)
    else if (arg.startsWith('--phase=')) flags.phase = splitList(arg.slice(8)).map(assertPhase)
    else if (arg.startsWith('--exclude-phase=')) flags.excludePhase = splitList(arg.slice(16)).map(assertPhase)
    else if (arg.startsWith('--since=')) {
      const d = new Date(arg.slice(8))
      if (isNaN(d.getTime())) throw new Error(`invalid --since date "${arg.slice(8)}"`)
      flags.since = d
    }
    else if (arg.startsWith('--session-id=')) flags.sessionIds.push(arg.slice(13))
    else if (arg.startsWith('--max-rows=')) {
      const n = Number(arg.slice(11))
      if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid --max-rows "${arg.slice(11)}"`)
      flags.maxRows = Math.floor(n)
    }
    else throw new Error(`unknown flag: ${arg}`)
  }
  return flags
}

function classify(r: PromotionResult): { outcome: RowResult['outcome']; reason?: string; projectId?: string } {
  if (!r.promoted) {
    return { outcome: 'not_promoted', reason: r.reason }
  }
  if (r.created) return { outcome: 'promoted_new', projectId: r.projectId }
  if (r.synced) return { outcome: 'promoted_synced', projectId: r.projectId }
  if (r.resyncUnresolved) return { outcome: 'resync_unresolved', projectId: r.projectId }
  return { outcome: 'already_linked', projectId: r.projectId }
}

async function ensureMigrationApplied(): Promise<void> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name='projects'
        AND column_name='completion_status'
    ) AS has_column
  `)
  // postgres-js returns an array of rows with shape { has_column: boolean }
  const row = (result as unknown as Array<{ has_column: boolean }>)[0]
  if (!row?.has_column) {
    throw new Error(
      'projects.completion_status missing — migration 0040 not applied. Refusing to run.',
    )
  }
}

async function main() {
  let flags: CLIFlags
  try {
    flags = parseFlags(process.argv.slice(2))
  } catch (err) {
    console.error(`Argument error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(2)
  }
  if (!flags.dryRun && !flags.confirm) {
    console.error('Refusing to run without --dry-run or --confirm')
    process.exit(2)
  }
  if (flags.dryRun && flags.confirm) {
    console.error('Pass exactly one of --dry-run or --confirm')
    process.exit(2)
  }

  await ensureMigrationApplied()

  const runId = randomUUID()
  const log = logger.child({ component: 'backfill-stale-promotions', runId, dryRun: flags.dryRun })
  log.info({
    batchSize: BATCH_SIZE,
    filters: {
      status: flags.status,
      excludeStatus: flags.excludeStatus,
      phase: flags.phase,
      excludePhase: flags.excludePhase,
      since: flags.since?.toISOString() ?? null,
      sessionIds: flags.sessionIds.length || undefined,
      maxRows: flags.maxRows,
    },
  }, 'start')

  const resultsFile = process.env.RESULTS_FILE
  const fileStream = resultsFile ? fs.createWriteStream(resultsFile, { flags: 'w' }) : null

  const counts: Record<RowResult['outcome'], number> = {
    promoted_new: 0,
    promoted_synced: 0,
    already_linked: 0,
    resync_unresolved: 0,
    not_promoted: 0,
    raced: 0,
    error: 0,
  }
  let scanned = 0
  let lastId: string | null = null

  outer: while (true) {
    const whereParts = [
      isNotNull(agentSessions.selectedCallId),
      isNull(agentSessions.projectId),
    ]
    if (flags.status) whereParts.push(inArray(agentSessions.status, flags.status))
    if (flags.excludeStatus.length) whereParts.push(notInArray(agentSessions.status, flags.excludeStatus))
    if (flags.phase) whereParts.push(inArray(agentSessions.currentPhase, flags.phase))
    if (flags.excludePhase.length) whereParts.push(notInArray(agentSessions.currentPhase, flags.excludePhase))
    if (flags.since) whereParts.push(gte(agentSessions.updatedAt, flags.since))
    if (flags.sessionIds.length) whereParts.push(inArray(agentSessions.id, flags.sessionIds))
    if (lastId) whereParts.push(sql`${agentSessions.id} > ${lastId}`)

    const rows = await db
      .select({
        id: agentSessions.id,
        userId: agentSessions.userId,
      })
      .from(agentSessions)
      .where(and(...whereParts))
      .orderBy(agentSessions.id)
      .limit(BATCH_SIZE)

    if (rows.length === 0) break

    for (const row of rows) {
      scanned++
      lastId = row.id
      if (flags.maxRows && scanned > flags.maxRows) {
        scanned-- // we didn't actually process this row
        break outer
      }

      // Tight pre-check to minimize the Branch A race window in dry-run mode.
      // The service still re-locks via SELECT FOR UPDATE inside the txn, so this
      // doesn't eliminate the race — it just shrinks it.
      const fresh = await db
        .select({ projectId: agentSessions.projectId })
        .from(agentSessions)
        .where(eq(agentSessions.id, row.id))
        .limit(1)
      if (fresh[0]?.projectId) {
        const out: RowResult = {
          sessionId: row.id,
          userId: row.userId,
          outcome: 'raced',
          projectId: fresh[0].projectId,
        }
        counts.raced++
        const line = JSON.stringify(out)
        console.log(line)
        if (fileStream) fileStream.write(line + '\n')
        continue
      }

      const ctx: ServiceContext = {
        userId: row.userId,
        requestId: `backfill-stale-promotions:${runId}:${row.id}`,
        now: new Date(),
      }

      let outcome: RowResult
      try {
        const result = await ensureProjectForSession(ctx, row.id, { dryRun: flags.dryRun })
        const c = classify(result)
        outcome = { sessionId: row.id, userId: row.userId, ...c }
      } catch (err) {
        outcome = {
          sessionId: row.id,
          userId: row.userId,
          outcome: 'error',
          errorMessage: err instanceof Error ? err.message : String(err),
        }
      }

      counts[outcome.outcome]++
      const line = JSON.stringify(outcome)
      console.log(line)
      if (fileStream) fileStream.write(line + '\n')

      if (outcome.outcome === 'error') {
        log.warn({ sessionId: outcome.sessionId, error: outcome.errorMessage }, 'row failed')
      }
    }
  }

  if (fileStream) {
    await new Promise<void>((resolve, reject) =>
      fileStream.end((err: unknown) => (err ? reject(err) : resolve())),
    )
  }

  log.info({ scanned, ...counts }, flags.dryRun ? 'dry-run complete' : 'backfill complete')
  console.error(
    `\n=== summary (${flags.dryRun ? 'DRY-RUN' : 'COMMITTED'}) ===\n` +
      `scanned:            ${scanned}\n` +
      `promoted_new:       ${counts.promoted_new}\n` +
      `promoted_synced:    ${counts.promoted_synced}\n` +
      `already_linked:     ${counts.already_linked}\n` +
      `resync_unresolved:  ${counts.resync_unresolved}\n` +
      `not_promoted:       ${counts.not_promoted}\n` +
      `raced:              ${counts.raced}\n` +
      `error:              ${counts.error}\n`,
  )

  process.exit(counts.error > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})

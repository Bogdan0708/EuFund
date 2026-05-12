// scripts/backfill-session-outline.ts
//
// Idempotent backfill: populates agent_sessions.outline for sessions that
// already have a blueprint but no outline. Runs once post-deploy of PR 1.
// Re-runs are no-ops (WHERE clause filters out populated rows).
//
// Usage:
//   npx tsx scripts/backfill-session-outline.ts --dry-run
//   npx tsx scripts/backfill-session-outline.ts --confirm

import { db } from '@/lib/db'
import { agentSessions } from '@/lib/db/schema'
import { outlineFromBlueprint } from '@/lib/ai/agent/services/blueprint'
import type { CallBlueprint } from '@/lib/ai/agent/types'
import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm'
import { logger } from '@/lib/logger'

const BATCH_SIZE = 100

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const confirm = args.includes('--confirm')
  if (!dryRun && !confirm) {
    console.error('Refusing to run without --dry-run or --confirm')
    process.exit(2)
  }

  const log = logger.child({ component: 'backfill-session-outline', dryRun })
  log.info({ batchSize: BATCH_SIZE }, 'start')

  let scanned = 0
  let updated = 0
  let wouldUpdate = 0
  let failed = 0
  let lastId: string | null = null

  // Pagination by id is RLS-friendly and stable under concurrent inserts.
  while (true) {
    const rows = await db
      .select({
        id: agentSessions.id,
        blueprint: agentSessions.blueprint,
      })
      .from(agentSessions)
      .where(and(
        isNotNull(agentSessions.blueprint),
        isNull(agentSessions.outline),
        ...(lastId ? [sql`${agentSessions.id} > ${lastId}`] : []),
      ))
      .orderBy(agentSessions.id)
      .limit(BATCH_SIZE)

    if (rows.length === 0) break

    for (const row of rows) {
      scanned++
      if (!row.blueprint) continue
      try {
        const outline = outlineFromBlueprint(row.blueprint as CallBlueprint)
        if (outline.length === 0) {
          log.warn({ sessionId: row.id }, 'blueprint produced empty outline; skipping')
          continue
        }
        if (!dryRun) {
          await db.update(agentSessions)
            .set({ outline: outline as never, updatedAt: new Date() })
            .where(eq(agentSessions.id, row.id))
          updated++
        } else {
          wouldUpdate++
        }
      } catch (err) {
        failed++
        log.warn(
          { sessionId: row.id, error: err instanceof Error ? err.message : String(err) },
          'outline_materialization_failed; skipping row',
        )
      }
    }
    lastId = rows[rows.length - 1].id
    log.info({ scanned, updated, wouldUpdate, failed, lastId }, 'progress')
  }

  log.info({ scanned, updated, wouldUpdate, failed, dryRun }, 'done')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

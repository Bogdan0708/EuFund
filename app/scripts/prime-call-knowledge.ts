#!/usr/bin/env npx tsx
// Pre-populates the call_knowledge table with known funding calls.
// Primes the cache so resolve_call gets fast hits on first run.
//
// Usage:
//   cd app
//   npx tsx --env-file=.env.local scripts/prime-call-knowledge.ts --dry-run
//   npx tsx --env-file=.env.local scripts/prime-call-knowledge.ts --confirm

import 'dotenv/config'
import { db } from '../src/lib/db'
import { callKnowledge } from '../src/lib/db/schema'
import { eq } from 'drizzle-orm'

// ── Known funding programs and their calls ──────────────────────────────────
// These are the core programs tracked in the knowledge base.
// Add new calls here as they are identified.

interface CallSeed {
  callId: string
  program: string
  callTitle: string
  normalized: Record<string, unknown>
}

const KNOWN_CALLS: CallSeed[] = [
  // PNRR
  { callId: 'PNRR-C10-I1', program: 'PNRR', callTitle: 'Fondul Local - Componenta 10', normalized: {} },
  { callId: 'PNRR-C11-I1', program: 'PNRR', callTitle: 'Tranzitia verde - Energie', normalized: {} },
  { callId: 'PNRR-C11-I2', program: 'PNRR', callTitle: 'Tranzitia verde - Transport', normalized: {} },
  { callId: 'PNRR-C9-I1',  program: 'PNRR', callTitle: 'Suport pentru sectorul privat, cercetare, dezvoltare si inovare', normalized: {} },
  { callId: 'PNRR-C7-I1',  program: 'PNRR', callTitle: 'Transformare digitala', normalized: {} },
  // PEO
  { callId: 'PEO-OS-4.1', program: 'PEO', callTitle: 'Educatie si competente', normalized: {} },
  { callId: 'PEO-OS-4.2', program: 'PEO', callTitle: 'Ocupare si mobilitate', normalized: {} },
  // POCIDIF
  { callId: 'POCIDIF-AP1', program: 'POCIDIF', callTitle: 'Competitivitate prin digitalizare', normalized: {} },
  { callId: 'POCIDIF-AP2', program: 'POCIDIF', callTitle: 'CDI si transfer tehnologic', normalized: {} },
  // POTJ
  { callId: 'POTJ-AP1', program: 'POTJ', callTitle: 'Tranzitie justa - Valea Jiului', normalized: {} },
  { callId: 'POTJ-AP2', program: 'POTJ', callTitle: 'Tranzitie justa - Gorj/Dolj', normalized: {} },
  // Regional programs
  { callId: 'PR-NE-AP1', program: 'PR Nord-Est', callTitle: 'Dezvoltare urbana Nord-Est', normalized: {} },
  { callId: 'PR-SV-AP1', program: 'PR Sud-Vest', callTitle: 'Dezvoltare urbana Sud-Vest', normalized: {} },
]

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const isDryRun = process.argv.includes('--dry-run')
  const isConfirm = process.argv.includes('--confirm')

  if (!isDryRun && !isConfirm) {
    console.error('Usage: npx tsx scripts/prime-call-knowledge.ts [--dry-run | --confirm]')
    process.exit(1)
  }

  console.log(`\nPrime call_knowledge -- ${isDryRun ? 'DRY RUN' : 'LIVE'}\n`)
  console.log(`Total calls to check: ${KNOWN_CALLS.length}`)

  let inserted = 0
  let skipped = 0

  for (const call of KNOWN_CALLS) {
    const [existing] = await db
      .select({ id: callKnowledge.id, status: callKnowledge.status })
      .from(callKnowledge)
      .where(eq(callKnowledge.callId, call.callId))
      .limit(1)

    if (existing) {
      console.log(`  SKIP  ${call.callId} — already exists (status: ${existing.status})`)
      skipped++
      continue
    }

    if (isDryRun) {
      console.log(`  DRY   ${call.callId} — would insert (${call.program}: ${call.callTitle})`)
      inserted++
      continue
    }

    await db.insert(callKnowledge).values({
      callId: call.callId,
      program: call.program,
      callTitle: call.callTitle,
      normalized: call.normalized,
      status: 'primed',
      extractedFrom: 'seed_script',
      structureConfidence: 0,
      freshnessConfidence: 0,
      sourceDocs: [],
      fieldProvenance: {},
    })

    console.log(`  OK    ${call.callId} — inserted (${call.program}: ${call.callTitle})`)
    inserted++
  }

  console.log(`\nDone: ${inserted} inserted, ${skipped} skipped`)
  process.exit(0)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})

// Smoke 06 — compaction continuity (manual-assisted, long-running).
//
// Premise: managed runtime READS system_summary rows but does NOT
// write them (see `app/src/lib/ai/agent/managed/history.ts`). To
// validate that the managed path picks up a summary, the session's
// summary row must first be written by V3. The smoke therefore has
// three phases with operator-driven flag toggles:
//
//   1. Flag OFF. Drive >= COMPACTION_TURNS turns through V3 so V3's
//      compaction writer produces a system_summary row.
//   2. Operator verifies via DB that system_summary exists (or
//      session.messageSummary is populated).
//   3. Flag ON. Submit one final managed turn that references early
//      context. The managed prompt should include the summary block
//      (Task 4) and the model should answer coherently without
//      re-asking for restated context.
//
// Because managed is read-only and does not bump stateVersion, the
// smoke reads the live stateVersion between turns from the operator
// via PILOT_SESSION_JSON — the operator refreshes the value before
// invoking phase 3. (No live state-read endpoint exposed.)
import { postAgent, uuid, report, drainSSE, prompt } from './lib'

const COMPACTION_TURNS = 22 // > V3 compaction threshold (~20) with margin

async function runTurn(sessionId: string, text: string, stateVersion: number): Promise<Response> {
  return postAgent({
    sessionId,
    locale: 'ro',
    message: text,
    requestId: uuid(),
    stateVersion,
  })
}

async function main(): Promise<void> {
  const raw = process.env.PILOT_SESSION_JSON
  if (!raw) {
    throw new Error('set PILOT_SESSION_JSON={"sessionId":"...","stateVersion":N}')
  }
  const seeded = JSON.parse(raw) as { sessionId: string; stateVersion: number }
  const { sessionId } = seeded
  let stateVersion = seeded.stateVersion

  // ── Phase 1 — V3 warmup to generate a system_summary row.
  await prompt(
    'Phase 1: set managed_agent_enabled=false (or unset MANAGED_RUNTIME_ENABLED on fondeu-pilot) so the drive turns route through V3. Confirm the target user will hit V3. Press Enter to start the drive.',
  )
  for (let i = 0; i < COMPACTION_TURNS; i++) {
    const res = await runTurn(sessionId, `Compaction drive turn ${i + 1}.`, stateVersion)
    if (res.status !== 200) {
      throw new Error(`turn ${i + 1} expected 200, got ${res.status}: ${await res.text()}`)
    }
    await drainSSE(res)
    // V3 DOES bump stateVersion on write turns, so this increment is
    // real. If V3 behavior changes, refresh stateVersion from the DB
    // between batches instead.
    stateVersion += 1
  }

  // ── Phase 2 — operator verifies a summary exists.
  await prompt(
    `Phase 2: verify a summary exists for session ${sessionId}. Either agent_messages has messageType='system_summary', OR agent_sessions.messageSummary is populated. Refresh stateVersion to match the live DB value, put it in PILOT_SESSION_JSON, and press Enter to continue.`,
  )
  const refreshed = JSON.parse(process.env.PILOT_SESSION_JSON ?? '{}') as {
    sessionId?: string
    stateVersion?: number
  }
  if (typeof refreshed.stateVersion !== 'number') {
    throw new Error('PILOT_SESSION_JSON.stateVersion missing after refresh')
  }
  stateVersion = refreshed.stateVersion

  // ── Phase 3 — flag ON, final managed turn.
  await prompt(
    'Phase 3: re-enable managed_agent_enabled (and MANAGED_RUNTIME_ENABLED if you unset it). Press Enter to submit the validation turn.',
  )
  const final = await runTurn(
    sessionId,
    'În mesajul nostru de început am vorbit despre un anumit domeniu. Care era?',
    stateVersion,
  )
  if (final.status !== 200) {
    throw new Error(`final turn expected 200, got ${final.status}: ${await final.text()}`)
  }
  await drainSSE(final)

  report('06-compaction-continuity', 'pass', {
    sessionId,
    turnsDriven: COMPACTION_TURNS,
    note:
      'Operator should review the final turn output for coherent summary-based reference. Managed path rendered a <conversation_summary> block if the summary row existed.',
  })
}

main().catch((e) => {
  report('06-compaction-continuity', 'fail', { error: e instanceof Error ? e.message : String(e) })
  process.exit(1)
})

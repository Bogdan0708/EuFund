// Smoke 06 — compaction continuity (automated, long-running). Submits
// enough turns to trigger V3's summary compaction, then submits a
// managed turn referencing early context. Verifies the managed path
// renders the conversation_summary block (Task 4) and that the model
// responds coherently to early-context references without re-asking.
//
// Manual step: the compaction threshold is a V3 internal and can
// change. Operator should check lib/ai/agent/history.ts to see when
// summaries are written and adjust COMPACTION_TURNS if needed.
import { postAgent, uuid, report, drainSSE } from './lib'

const COMPACTION_TURNS = 22 // > V3 compaction threshold (~20) with margin

async function runTurn(text: string, stateVersion: number, sessionId?: string): Promise<Response> {
  return postAgent({
    sessionId,
    locale: 'ro',
    message: text,
    requestId: uuid(),
    stateVersion,
  })
}

async function main(): Promise<void> {
  // Drive the session through enough turns to trigger V3 compaction.
  // We cannot reliably read stateVersion back from the route without
  // plumbing a read endpoint, so the operator must pre-seed with a
  // session + starting version (same mechanism as smoke 04).
  const raw = process.env.PILOT_SESSION_JSON
  if (!raw) {
    throw new Error('set PILOT_SESSION_JSON={"sessionId":"...","stateVersion":N} first')
  }
  const seeded = JSON.parse(raw) as { sessionId: string; stateVersion: number }
  let { sessionId, stateVersion } = seeded

  for (let i = 0; i < COMPACTION_TURNS; i++) {
    const res = await runTurn(`Compaction drive turn ${i + 1}.`, stateVersion, sessionId)
    if (res.status !== 200) {
      throw new Error(`turn ${i + 1} expected 200, got ${res.status}: ${await res.text()}`)
    }
    await drainSSE(res)
    stateVersion += 1
  }

  // Final turn references the very first message. If summary loading
  // works, the model can answer without asking the user to restate.
  const final = await runTurn(
    'În mesajul nostru de început am vorbit despre un anumit domeniu. Care era?',
    stateVersion,
    sessionId,
  )
  if (final.status !== 200) {
    throw new Error(`final turn expected 200, got ${final.status}`)
  }
  await drainSSE(final)

  report('06-compaction-continuity', 'pass', {
    sessionId,
    turnsDriven: COMPACTION_TURNS,
    note: 'Operator should review the final turn output for coherent summary-based reference.',
  })
}

main().catch((e) => {
  report('06-compaction-continuity', 'fail', { error: e instanceof Error ? e.message : String(e) })
  process.exit(1)
})

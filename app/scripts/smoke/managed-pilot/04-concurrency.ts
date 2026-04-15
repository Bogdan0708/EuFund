// Smoke 04 — concurrency (automated). Fires two parallel managed POSTs
// with the same stateVersion + distinct requestIds. The pilot's
// optimistic precondition (Task 6) should admit exactly one; the other
// arrives with stale state (because the first commits a new version)
// and receives 409 stale_state_version.
//
// Note: this is a race — if both requests pass the precondition and
// both attempt to claim distinct requestIds, you'll get two 200s and
// both writes succeed in sequence. For the pilot smoke we assert the
// spec-intended outcome (one 200, one 409) and tolerate two-200 on the
// rare scheduling win by failing loud so the operator can investigate.
import { env, postAgent, uuid, report } from './lib'

async function currentStateVersion(): Promise<{ sessionId: string; stateVersion: number }> {
  // The pilot exposes session state via GET /api/ai/agent/[sessionId]/state
  // (V3-era handler). If that's absent, the operator must pre-seed a
  // session via the dashboard and paste its {sessionId, stateVersion}
  // into PILOT_SESSION_JSON.
  const raw = process.env.PILOT_SESSION_JSON
  if (!raw) {
    throw new Error(
      'set PILOT_SESSION_JSON={"sessionId":"...","stateVersion":N} — no live state-read endpoint plumbed yet',
    )
  }
  const parsed = JSON.parse(raw) as { sessionId: string; stateVersion: number }
  return parsed
}

async function main(): Promise<void> {
  env('PILOT_URL') // validate env early
  const { sessionId, stateVersion } = await currentStateVersion()

  const a = postAgent({
    sessionId,
    locale: 'ro',
    message: 'Concurrency smoke A.',
    requestId: uuid(),
    stateVersion,
  })
  const b = postAgent({
    sessionId,
    locale: 'ro',
    message: 'Concurrency smoke B.',
    requestId: uuid(),
    stateVersion,
  })
  const [ra, rb] = await Promise.all([a, b])
  const codes = [ra.status, rb.status].sort()

  if (codes[0] !== 200 || codes[1] !== 409) {
    throw new Error(`expected [200, 409], got ${codes.join(',')}`)
  }
  const loser = ra.status === 409 ? ra : rb
  const json = (await loser.json()) as { error?: { code?: string } }
  if (json.error?.code !== 'stale_state_version') {
    throw new Error(`loser error code was ${json.error?.code}, expected stale_state_version`)
  }
  report('04-concurrency', 'pass', { codes })
}

main().catch((e) => {
  report('04-concurrency', 'fail', { error: e instanceof Error ? e.message : String(e) })
  process.exit(1)
})

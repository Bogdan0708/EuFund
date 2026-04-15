// Smoke 04 — concurrency (automated). Fires two parallel managed POSTs
// with identical (sessionId, requestId). The agent_turns UNIQUE
// (session_id, request_id) constraint should admit exactly one claim;
// the other raises PG 23505, which the route maps to HTTP 409
// conflict_request_id as clean JSON.
//
// Note on the premise: stateVersion is NOT the concurrency primitive
// here. The managed runtime is read-only (Phase 2) and never bumps
// stateVersion, so two distinct-requestId parallel POSTs would both
// pass the precondition and both succeed. The real atomic boundary
// for managed turns is the pre-stream turn-claim (Task 7), which is
// what this smoke exercises.
import { env, postAgent, uuid, report } from './lib'

async function main(): Promise<void> {
  env('PILOT_URL')
  const raw = process.env.PILOT_SESSION_JSON
  if (!raw) {
    throw new Error('set PILOT_SESSION_JSON={"sessionId":"...","stateVersion":N}')
  }
  const { sessionId, stateVersion } = JSON.parse(raw) as {
    sessionId: string
    stateVersion: number
  }

  const requestId = uuid()
  const a = postAgent({
    sessionId,
    locale: 'ro',
    message: 'Concurrency smoke — attempt A.',
    requestId,
    stateVersion,
  })
  const b = postAgent({
    sessionId,
    locale: 'ro',
    message: 'Concurrency smoke — attempt B.',
    requestId,
    stateVersion,
  })
  const [ra, rb] = await Promise.all([a, b])
  const codes = [ra.status, rb.status].sort()

  if (codes[0] !== 200 || codes[1] !== 409) {
    throw new Error(`expected [200, 409], got ${codes.join(',')}`)
  }
  const loser = ra.status === 409 ? ra : rb
  const contentType = loser.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error(`loser content-type must be JSON (never SSE), got ${contentType}`)
  }
  const json = (await loser.json()) as { error?: { code?: string } }
  if (json.error?.code !== 'conflict_request_id') {
    throw new Error(`loser error code was ${json.error?.code}, expected conflict_request_id`)
  }

  report('04-concurrency', 'pass', { codes, sessionId, requestId })
}

main().catch((e) => {
  report('04-concurrency', 'fail', { error: e instanceof Error ? e.message : String(e) })
  process.exit(1)
})

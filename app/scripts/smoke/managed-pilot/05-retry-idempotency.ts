// Smoke 05 — retry idempotency (automated). Submits a managed turn
// with (sessionId=S, requestId=A), lets it complete. Submits another
// turn with the same (S, A). Expects HTTP 409 conflict_request_id
// as clean JSON (never SSE). Operator spot-checks the DB to confirm
// exactly one agent_turns row for that (sessionId, requestId) pair
// and that it has child agent_messages (not the stale-empty branch).
//
// The uniqueness boundary on agent_turns is (session_id, request_id),
// not global request_id, so BOTH requests must target the same
// sessionId. Operator seeds PILOT_SESSION_JSON={"sessionId":...,
// "stateVersion":N} the same way smokes 04 and 06 do.
import { env, postAgent, uuid, report, drainSSE } from './lib'

async function main(): Promise<void> {
  env('PILOT_URL')
  const raw = process.env.PILOT_SESSION_JSON
  if (!raw) {
    throw new Error(
      'set PILOT_SESSION_JSON={"sessionId":"...","stateVersion":N} — smoke 05 needs both POSTs to target the same session',
    )
  }
  const { sessionId, stateVersion } = JSON.parse(raw) as { sessionId: string; stateVersion: number }
  const requestId = uuid()

  const first = await postAgent({
    sessionId,
    locale: 'ro',
    message: 'Retry-idempotency smoke — first attempt.',
    requestId,
    stateVersion,
  })
  if (first.status !== 200) {
    throw new Error(`first attempt expected 200, got ${first.status}: ${await first.text()}`)
  }
  await drainSSE(first)

  const retry = await postAgent({
    sessionId,
    locale: 'ro',
    message: 'Retry-idempotency smoke — retry attempt.',
    requestId,
    stateVersion,
  })
  if (retry.status !== 409) {
    throw new Error(`retry expected 409, got ${retry.status}: ${await retry.text()}`)
  }
  const contentType = retry.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error(`retry content-type must be JSON (never SSE), got ${contentType}`)
  }
  const json = (await retry.json()) as { error?: { code?: string } }
  if (json.error?.code !== 'conflict_request_id') {
    throw new Error(`retry error code was ${json.error?.code}, expected conflict_request_id`)
  }

  report('05-retry-idempotency', 'pass', {
    sessionId,
    requestId,
    note: 'Operator should verify exactly one agent_turns row for (sessionId, requestId).',
  })
}

main().catch((e) => {
  report('05-retry-idempotency', 'fail', { error: e instanceof Error ? e.message : String(e) })
  process.exit(1)
})

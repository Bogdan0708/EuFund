// Smoke 05 — retry idempotency (automated). Submits a managed turn
// with requestId=A, lets it complete. Submits another turn with the
// same requestId=A. Expects HTTP 409 conflict_request_id as clean
// JSON (never SSE). Operator spot-checks the DB to confirm exactly
// one agent_turns row for that requestId and that it has child
// agent_messages (not the stale-empty branch).
import { postAgent, uuid, report, drainSSE } from './lib'

async function main(): Promise<void> {
  const requestId = uuid()

  const first = await postAgent({
    locale: 'ro',
    message: 'Retry-idempotency smoke — first attempt.',
    requestId,
    stateVersion: 0,
  })
  if (first.status !== 200) {
    throw new Error(`first attempt expected 200, got ${first.status}: ${await first.text()}`)
  }
  await drainSSE(first)

  const retry = await postAgent({
    locale: 'ro',
    message: 'Retry-idempotency smoke — retry attempt.',
    requestId,
    stateVersion: 0,
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
    requestId,
    note: 'Operator should verify exactly one agent_turns row for this requestId.',
  })
}

main().catch((e) => {
  report('05-retry-idempotency', 'fail', { error: e instanceof Error ? e.message : String(e) })
  process.exit(1)
})

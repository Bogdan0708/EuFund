// Smoke 01 — happy path. Submits a fresh managed turn and asserts the
// route streamed an SSE response. Does not verify DB state; that lives
// in the reconciliation queries.
import { postAgent, uuid, report } from './lib'

async function main(): Promise<void> {
  const requestId = uuid()
  const res = await postAgent({
    locale: 'ro',
    message: 'Sunt interesat de un proiect de cercetare aplicată în domeniul energiei.',
    requestId,
    stateVersion: 0,
  })
  if (res.status !== 200) {
    throw new Error(`expected 200, got ${res.status}: ${await res.text()}`)
  }
  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    throw new Error(`expected SSE content-type, got ${contentType}`)
  }
  const text = await res.text()
  if (!/^data:\s/m.test(text)) throw new Error('no SSE data lines in response')
  report('01-happy-path', 'pass', { requestId })
}

main().catch((e) => {
  report('01-happy-path', 'fail', { error: e instanceof Error ? e.message : String(e) })
  process.exit(1)
})

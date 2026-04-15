// Smoke 02 — kill-switch (manual-assisted, two-part). Proves both
// kill paths work: (a) DB flag toggle propagates in ≤2s thanks to
// bypassCache:true; (b) unsetting MANAGED_RUNTIME_ENABLED on the
// pilot service and redeploying also degrades managed traffic to V3.
//
// The script does not verify DB rows directly — the operator runs
// the runtime_mode query from the observability runbook at each step
// and confirms the latest agent_messages row shows runtime_mode='v3'.
import { postAgent, uuid, report, prompt } from './lib'

async function submitAndAssertOK(): Promise<string> {
  const requestId = uuid()
  const res = await postAgent({
    locale: 'ro',
    message: 'Ping turn for kill-switch smoke.',
    requestId,
    stateVersion: 0,
  })
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${await res.text()}`)
  await res.text()
  return requestId
}

async function main(): Promise<void> {
  // Part 0 — sanity. Confirm managed is live.
  const baselineReq = await submitAndAssertOK()

  // Part A — DB flag toggle.
  await prompt(
    'Disable the managed_agent_enabled flag in the admin UI (or PATCH the DB row). Wait 2+ seconds, then press Enter.',
  )
  const flagOffReq = await submitAndAssertOK()

  // Part B — env gate.
  await prompt(
    'Unset MANAGED_RUNTIME_ENABLED on the fondeu-pilot service and redeploy. Once the new revision is serving traffic, press Enter.',
  )
  const envOffReq = await submitAndAssertOK()

  report('02-kill-switch', 'pass', {
    baselineRequestId: baselineReq,
    flagOffRequestId: flagOffReq,
    envOffRequestId: envOffReq,
    note: 'Operator must verify the runtime_mode of the latest agent_messages row for flagOff + envOff shows v3.',
  })
}

main().catch((e) => {
  report('02-kill-switch', 'fail', { error: e instanceof Error ? e.message : String(e) })
  process.exit(1)
})

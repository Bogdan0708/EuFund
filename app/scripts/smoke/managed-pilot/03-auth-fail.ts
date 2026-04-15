// Smoke 03 — auth-setup failure (manual-assisted). Operator unsets
// ANTHROPIC_API_KEY on the pilot and redeploys. Script submits a turn
// and expects HTTP 200 from V3 fallback; operator verifies the DB
// recorded degraded_reason='auth_setup_failure' on the session.
import { postAgent, uuid, report, prompt } from './lib'

async function main(): Promise<void> {
  await prompt(
    'Unset ANTHROPIC_API_KEY (or pointing secret binding) on fondeu-pilot and redeploy. When the new revision is serving, press Enter.',
  )

  const requestId = uuid()
  const res = await postAgent({
    locale: 'ro',
    message: 'Auth-fail smoke turn.',
    requestId,
    stateVersion: 0,
  })
  if (res.status !== 200) {
    throw new Error(`expected 200 (V3 fallback), got ${res.status}: ${await res.text()}`)
  }
  await res.text()

  report('03-auth-fail', 'pass', {
    requestId,
    note:
      "Operator must verify application_agent_sessions.degraded_reason='auth_setup_failure' for this session.",
  })
}

main().catch((e) => {
  report('03-auth-fail', 'fail', { error: e instanceof Error ? e.message : String(e) })
  process.exit(1)
})

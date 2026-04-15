# Managed Pilot Smoke Suite

Six tests, mixing automated and manual-assisted. All six must pass
before enabling `managed_agent_enabled` for the target userId on
production. Drill-triggered 409s from smokes 04 and 05 are excluded
from the pilot exit criterion "zero unexpected server-caused 409s".

| # | Script | Mode |
|---|---|---|
| 01 | `01-happy-path.ts` | automated |
| 02 | `02-kill-switch.ts` | manual-assisted (operator flips flag, then unsets env + redeploys) |
| 03 | `03-auth-fail.ts` | manual-assisted (operator unsets `ANTHROPIC_API_KEY` + redeploys) |
| 04 | `04-concurrency.ts` | automated |
| 05 | `05-retry-idempotency.ts` | automated |
| 06 | `06-compaction-continuity.ts` | automated (long-running, exercises compaction) |

"Manual-assisted" scripts print explicit operator prompts and exit
non-zero if the prerequisite action isn't performed within a timeout.

## Setup

```bash
export PILOT_URL="https://fondeu-pilot-....run.app"
export PILOT_SESSION_COOKIE="authjs.session-token=..."
export TARGET_USER_ID="..."
export DATABASE_URL="postgres://..."
# Smokes 04 and 06 require a pre-seeded session:
export PILOT_SESSION_JSON='{"sessionId":"...","stateVersion":N}'
```

## Run

```bash
cd app
npx tsx scripts/smoke/managed-pilot/01-happy-path.ts
npx tsx scripts/smoke/managed-pilot/02-kill-switch.ts      # interactive — follow prompts
npx tsx scripts/smoke/managed-pilot/03-auth-fail.ts        # interactive — follow prompts
npx tsx scripts/smoke/managed-pilot/04-concurrency.ts
npx tsx scripts/smoke/managed-pilot/05-retry-idempotency.ts
npx tsx scripts/smoke/managed-pilot/06-compaction-continuity.ts
```

## Pass criteria

Each script prints `"status":"pass"` JSON and exits 0. Any failure
aborts the pilot rollout until resolved. Manual-assisted smokes
print notes that the operator must verify by running the relevant
reconciliation queries from
`docs/superpowers/runbooks/managed-pilot-observability.md`.

## Drill-triggered 409s

Smokes 04 and 05 deliberately provoke 409 responses. These do NOT
count against the pilot exit criterion "zero unexpected server-caused
409s."

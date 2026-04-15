# Managed Pilot Observability

Operator guide for the Claude Managed Agents pilot runtime. Covers the
per-turn structured log, the daily reconciliation queries (run as cron
against the production DB), and the dashboards that oncall watches
during the pilot window.

## Structured turn log

`runManagedTurn` emits one JSON log line per turn on the
`managed-runtime` logger channel:

| Field            | Type                                         | Purpose                                                                 |
|------------------|----------------------------------------------|-------------------------------------------------------------------------|
| `event`          | `"managed_turn_complete"`                    | Fixed marker so log pipelines can filter the signal.                   |
| `sessionId`      | uuid                                         | Session the turn belongs to.                                           |
| `turnId`         | uuid                                         | `agent_turns.id` (pre-stream claim row).                               |
| `requestId`      | string                                       | Client-generated per-POST id.                                          |
| `iterations`     | number                                       | Tool iterations in the turn (cap = 8).                                 |
| `toolCount`      | number                                       | Tool invocations executed.                                             |
| `durationMs`     | number                                       | Wall-clock time from turn start to emit `done`.                        |
| `outcome`        | `"completed" \| "no_output"`                 | `completed` if a durable output persisted; `no_output` otherwise.      |
| `degradedReason` | `DegradedReason \| null`                     | Populated only on error paths — see `circuit-breaker.ts`.              |
| `model`          | string \| null                               | Anthropic model id reported by the stream, if any.                     |

Pre-stream failures (auth-setup, route-level 400/409) are logged by
`api-agent` rather than `managed-runtime` — they never reach the
runtime.

## Reconciliation queries

All queries run against the production Cloud SQL database. Schedule
them once a day via cron; alert when the thresholds below trip.

### Duplicate user turns per turn_id — MUST return zero rows

```sql
SELECT turn_id, count(*)
FROM agent_messages
WHERE role = 'user' AND turn_id IS NOT NULL
GROUP BY turn_id
HAVING count(*) > 1;
```

If any rows return, the deferred-persistence invariant is broken. Page
the managed-pilot owner.

### Abandoned turns — alert at >5/day

```sql
SELECT id, session_id, request_id, started_at
FROM agent_turns
WHERE completed_at IS NULL
  AND started_at < now() - interval '1 hour'
ORDER BY started_at DESC;
```

Expected cadence: 0–1/day. `deleteEmptyTurn` should clean up
pre-output failures; anything left here is a pre-output failure
whose cleanup itself failed. >5/day is the abort trigger for the
pilot.

### Managed P95 latency (24h)

```sql
SELECT percentile_cont(0.95) WITHIN GROUP (
  ORDER BY EXTRACT(EPOCH FROM completed_at - started_at) * 1000
)
FROM agent_turns
WHERE runtime_mode = 'managed'
  AND completed_at IS NOT NULL
  AND started_at > now() - interval '24 hours';
```

Compare against the V3 baseline below. Pilot abort trigger: managed
P95 > 2× V3 P95 sustained ≥1h.

### V3 baseline P95 latency

Derive from Cloud Run access logs filtered to `POST /api/ai/agent` on
the main service (`fondeu-platform`). Report the 24h P95 of request
duration. V3 runtime code is intentionally untouched by the pilot, so
the DB does not carry a directly-comparable `agent_turns` row for V3
turns — the access-log derivation is authoritative.

### Conflict counter (observational)

At present there is no dedicated structured log for route-level 409
responses — the route relies on the standard Next.js request log
plus the pilot Cloud Run access log. Derive the conflict count from
the Cloud Run access log filter `status:409 path:/api/ai/agent` over
24h. If a dedicated `managed_route_conflict_request_id` log event is
wanted, add it in a follow-up PR (route.ts near the
`conflict_request_id` branch) and update this section.

Expected baseline: near zero with the fresh-per-POST `useAgent`
client. A spike points to a client that reuses requestIds.

## Dashboards

Two dashboards in the ops console:

### Pilot health (oncall)

- Request count by runtime (`managed` vs `v3`), derived from
  `agent_turns.runtime_mode` for managed and Cloud Run access logs
  for the combined baseline.
- Success rate (managed): `completed / (completed + error)`, derived
  from the `managed_turn_complete` structured log's `outcome` field.
- Fallback rate: managed-eligible requests that ended up on V3 —
  derived from the ratio of `agent_turns runtime_mode='v3'` to total
  requests on the pilot service.
- Managed P95 vs V3 P95 latency (queries above).

Breaker state is currently per-process in-memory
(`app/src/lib/ai/agent/managed/circuit-breaker.ts`) and not emitted
as a metric or log signal. If oncall wants a breaker gauge, add a
transition log in the breaker module and a metric exporter as a
follow-up. For the pilot window, breaker state is observed
indirectly via the fallback-rate gauge: a sustained spike in V3
traffic on `fondeu-pilot` means the breaker opened.

### Audit (daily review)

- Duplicate-turn-per-turn-id count (expected: 0).
- 400 / 409 counts by error code (`missing_state_version`,
  `stale_state_version`, `missing_request_id`, `conflict_request_id`).
- Abandoned-turn count (expected: <5/day).
- Kill-switch propagation incidents (flag toggled + observed effect
  window).

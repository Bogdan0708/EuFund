# Managed Agents — Rollback Runbook

Three escalating paths. During the 2026-05 production reactivation,
`fondeu-platform` may run with `MANAGED_RUNTIME_ENABLED=true` via the
Cloud Build `_MANAGED_RUNTIME_ENABLED` substitution. Use these in order;
each later step's SLO is slower.

## 1. Primary — flag off (target: sub-second propagation)

The `managed_agent_enabled` flag is read with `bypassCache:true`
(Task 2), so the cache is never consulted on the pilot hot path. DB
write propagates effectively immediately.

### Option A: admin API

```bash
curl -X PATCH "${FONDEU_URL}/api/v1/admin/feature-flags/managed_agent_enabled" \
  -H "Content-Type: application/json" \
  -b "${ADMIN_SESSION_COOKIE}" \
  -d '{"enabled":false,"targeting":{}}'
```

If middleware CSRF enforcement applies to admin PATCH, include the
`X-CSRF-Token` header + matching `csrf-token` cookie. Exact headers
are confirmed during the kill-switch drill at entry criterion #5 and
updated in-place after the drill.

### Option B: direct DB

```bash
psql "${DATABASE_URL}" -c \
  "UPDATE feature_flags SET enabled=false, targeting='{}'::jsonb, updated_at=now() \
   WHERE key='managed_agent_enabled';"
```

Always available regardless of API/middleware state. Preferred when
the admin UI or its auth path is itself the incident.

## 2. Secondary — disable service-local gate (target: ~30s for revision)

```bash
gcloud run services update fondeu-platform --region europe-west2 \
  --set-env-vars MANAGED_RUNTIME_ENABLED=false
```

The route's managed dispatch is gated by
`process.env.MANAGED_RUNTIME_ENABLED === 'true'` (Task 5). Setting the
env var to `false` makes the managed conjunct short-circuit false — no
managed import or dispatch happens even if the DB flag is stuck on.
For the next production deploy, keep the kill switch in place by
overriding `_MANAGED_RUNTIME_ENABLED=false` in Cloud Build.

## 3. Nuclear — scale pilot service to zero

```bash
gcloud run services update fondeu-platform --region europe-west2 \
  --min-instances=0 --max-instances=0
```

Use only when the production service itself is the incident (memory
leak, runaway costs, uncontrolled error spike). This intentionally
takes the service unavailable until traffic is redirected or a fixed
revision is deployed.

## Verification after rollback

```sql
-- Confirm no managed turns in the last 5 minutes (flag off effective):
SELECT count(*) FROM agent_turns
WHERE runtime_mode = 'managed'
  AND started_at > now() - interval '5 minutes';
-- Expected: 0
```

If the count is non-zero after path #1, escalate to path #2. If still
non-zero after #2, escalate to #3.

## Preconditions checked at entry criterion #5 (kill-switch drill)

- Option A headers confirmed + documented inline above.
- Option B DB path verified.
- Secondary path verified (a new revision rolls with the env removed).
- Nuclear path verified (scale-to-zero completes within SLO).

## Runbook verification reconfirmation

Re-test quarterly or after any edit to `app/src/app/api/ai/agent/route.ts`
or `app/src/lib/feature-flags/` that touches the kill-switch path.

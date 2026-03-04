# EuFund 30-Day Operational Hardening Plan

**Date**: 2026-03-04
**Repo**: Bogdan0708/EuFund (`master` branch)
**Author**: Staff Engineer / SRE Review
**Status**: DRAFT — awaiting owner approval
**Update 2026-03-04**: Migration risk review completed — journal/file mismatches fixed (see commit)

---

## Executive Summary

1. **No PR template exists** — every merge is a freeform gamble on review quality
2. **No migration preflight in CI** — Drizzle migrations can break prod DB silently (10 migrations exist, no dry-run gate)
3. **No AI-Gateway contract test** — `AI_GATEWAY_URL`/`AI_GATEWAY_KEY` env vars referenced but never validated in CI; provider router is complex (6 providers, 19 task types)
4. **No formal SLOs** — alerting rules exist (`monitoring/alerting-rules.yml`) but no SLO document, no error budget tracking, no burn-rate alerts
5. **`master` has massively diverged from `origin/main`** — hundreds of files changed; the open security PR (#3) may be stale
6. **Deploy workflow has rollback but no canary** — `deploy-production.yml` health-checks after full cutover, no staged traffic split
7. **Dual-cloud confusion** — staging=AWS ECS, prod=GCP Cloud Run; rollback script targets ECS only (useless for prod)
8. **No readiness endpoint** — `/api/health` exists but no `/api/readiness` for k8s/Cloud Run startup probes
9. **33 integration tests but no smoke suite** — post-deploy verification is a single curl to `/api/health`
10. **Incident runbook is AWS-centric** — references ECS/CloudWatch but prod is GCP Cloud Run

---

## Quick Wins (First 48 Hours)

These are zero-risk, high-value changes that can ship as individual PRs immediately:

### QW-1: PR Template (30 min)
**File**: `.github/PULL_REQUEST_TEMPLATE.md`

```markdown
## What changed and why

<!-- 1-3 sentences. Link to issue/ticket if applicable. -->

## Type of change
- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change
- [ ] Database migration
- [ ] Infrastructure / CI change
- [ ] Documentation only

## Pre-merge checklist
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] New/changed routes have integration tests
- [ ] i18n: both `ro.json` and `en.json` updated (if UI change)
- [ ] No secrets/credentials in diff
- [ ] Migration is backward-compatible (if DB change)

## Database migration (if applicable)
- [ ] Migration tested with `npm run db:push` on local
- [ ] Migration is additive-only (no DROP COLUMN / ALTER TYPE on hot tables)
- [ ] Rollback SQL documented below

<details><summary>Rollback SQL</summary>

```sql
-- Paste rollback SQL here
```

</details>

## Rollout / Rollback plan

<!-- How to verify this works in staging? How to roll back if broken? -->

## Screenshots (if UI change)

<!-- Before/After screenshots -->
```

### QW-2: Readiness Endpoint (20 min)
**File**: `app/src/app/api/readiness/route.ts`

A lightweight probe that only checks DB connectivity (not all services). For Cloud Run startup probes and k8s readiness checks.

```typescript
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { db } = await import('@/lib/db');
    const { sql } = await import('drizzle-orm');
    await Promise.race([
      db.execute(sql`SELECT 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    return NextResponse.json({ status: 'ready' }, { status: 200 });
  } catch {
    return NextResponse.json({ status: 'not_ready' }, { status: 503 });
  }
}
```

Add to public paths in `app/src/middleware.ts`:
```
'/api/readiness',
```

### QW-3: Branch Reconciliation Plan (1 hour)
**Action**: Audit the divergence between `master` and `origin/main`.

```bash
git log --oneline origin/main..master | wc -l   # count commits ahead
git log --oneline master..origin/main | wc -l   # count commits behind
```

Create a tracking issue: "Reconcile master → main: merge or rebase strategy". This blocks everything else — if `main` is the deployment branch and `master` is where work happens, CI gates on `main` are bypassed.

### QW-4: Add `/api/readiness` and `/api/health` to CSRF Exemptions (10 min)
**File**: `app/src/middleware.ts` — verify both are in `publicPaths` and CSRF-exempt.

### QW-5: Pin CI Node Version (10 min)
**File**: `.github/workflows/ci.yml` — currently uses `node-version: '22'`. Pin to `22.x` or specific `22.14.0` to prevent surprise breakage from Node point releases.

---

## Week 1 (Days 1–7): Release Gates & Migration Safety

### W1-1: Migration Preflight CI Check

**Priority**: P0 — migrations can break prod with no safety net today.

**New file**: `.github/workflows/migration-preflight.yml`

```yaml
name: Migration Preflight
on:
  pull_request:
    paths:
      - 'app/drizzle/**'
      - 'app/src/lib/db/schema.ts'

jobs:
  migration-check:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15-alpine
        env:
          POSTGRES_DB: preflight
          POSTGRES_USER: preflight
          POSTGRES_PASSWORD: preflight
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: app/package-lock.json
      - run: npm ci
        working-directory: app
      - name: Apply all existing migrations
        working-directory: app
        env:
          DATABASE_URL: postgresql://preflight:preflight@localhost:5432/preflight
        run: npx drizzle-kit migrate
      - name: Verify schema consistency
        working-directory: app
        env:
          DATABASE_URL: postgresql://preflight:preflight@localhost:5432/preflight
        run: npx drizzle-kit check
      - name: Check for destructive operations
        run: |
          NEW_MIGRATIONS=$(git diff --name-only origin/main...HEAD -- app/drizzle/*.sql)
          if [ -n "$NEW_MIGRATIONS" ]; then
            echo "## New migrations found:" >> $GITHUB_STEP_SUMMARY
            for f in $NEW_MIGRATIONS; do
              echo "### $f" >> $GITHUB_STEP_SUMMARY
              # Flag dangerous operations
              if grep -iE 'DROP (TABLE|COLUMN|INDEX)|ALTER COLUMN.*TYPE|TRUNCATE' "$f"; then
                echo "::error file=$f::DESTRUCTIVE OPERATION DETECTED — requires DBA review"
                exit 1
              fi
              cat "$f" >> $GITHUB_STEP_SUMMARY
            done
          fi
```

### W1-2: Release Gate Workflow

**New file**: `.github/workflows/release-gate.yml`

A required status check that blocks merge to `main`:

```yaml
name: Release Gate
on:
  pull_request:
    branches: [main]

jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Check PR has required labels
        uses: mheap/github-action-required-labels@v5
        with:
          mode: minimum
          count: 1
          labels: 'type:bugfix,type:feature,type:infra,type:docs,type:security'

      - name: Check PR description is not empty
        run: |
          BODY=$(gh pr view ${{ github.event.pull_request.number }} --json body -q .body)
          if [ ${#BODY} -lt 20 ]; then
            echo "::error::PR description too short. Use the PR template."
            exit 1
          fi
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Verify no TODO/FIXME in diff
        run: |
          TODOS=$(git diff origin/main...HEAD -- '*.ts' '*.tsx' | grep -c '^\+.*\(TODO\|FIXME\|HACK\)' || true)
          if [ "$TODOS" -gt 0 ]; then
            echo "::warning::Found $TODOS TODO/FIXME/HACK markers in diff"
          fi
```

### W1-3: Lock Down Branch Protection

**Action** (GitHub Settings, not a file change):
- Require PR reviews: 1+ approval
- Require status checks: `quality`, `security-gates`, `build-and-test`, `migration-check` (when applicable), `release-gate`
- Require branches to be up to date
- Require conversation resolution
- No force pushes to `main`

### W1-4: Add `npm run preflight` Script

**File**: `app/package.json` — add script:

```json
"preflight": "npm run typecheck && npm run lint && npm test"
```

Developers run this before pushing. CI enforces it anyway, but local preflight catches issues 10x faster.

---

## Week 2 (Days 8–14): AI Gateway Contracts & Integration Hardening

### W2-1: AI Gateway Contract Test

**New file**: `app/tests/integration/ai-gateway-contract.test.ts`

Tests the contract between the app and the AI provider routing layer. Validates:
- Request format sent to each provider matches expected schema
- Response parsing handles all known response shapes
- Fallback behavior when primary provider returns 5xx
- Rate limit headers are respected
- Streaming SSE format is valid

```typescript
// Key test cases:
describe('AI Gateway Contract', () => {
  describe('Provider Router', () => {
    it('routes Romanian content to openllm-ro when configured');
    it('falls back from primary to secondary provider on 5xx');
    it('respects circuit breaker state');
    it('includes required headers (Authorization, Content-Type)');
  });

  describe('Response Contract', () => {
    it('parses OpenAI chat completion format');
    it('parses Anthropic messages format');
    it('parses streaming SSE chunks correctly');
    it('handles partial/malformed JSON in stream gracefully');
  });

  describe('AI Gateway Endpoint', () => {
    it('validates AI_GATEWAY_URL format');
    it('rejects requests without AI_GATEWAY_KEY');
    it('handles gateway timeout (30s) gracefully');
  });
});
```

### W2-2: Provider Health Smoke Test in CI

**Modify**: `.github/workflows/ci.yml` — add job after `build-and-test`:

```yaml
  ai-contract-check:
    needs: [quality]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: app/package-lock.json
      - run: npm ci
        working-directory: app
      - name: Run AI contract tests
        working-directory: app
        run: npx vitest run tests/integration/ai-gateway-contract.test.ts
```

### W2-3: Circuit Breaker Observability

**Modify**: `app/src/lib/errors/index.ts` — add metrics emission to CircuitBreaker state transitions:

```typescript
// On state change, emit:
// circuit_breaker_state_changes_total{service, from_state, to_state}
// circuit_breaker_failures_total{service}
```

**Modify**: `app/src/lib/monitoring/metrics.ts` — register new metrics.

### W2-4: AI Response Validation Middleware

**New file**: `app/src/lib/ai/response-validator.ts`

Validates AI responses before returning to users:
- JSON schema validation for structured outputs (Zod)
- Romanian text quality check (not garbled UTF-8)
- PII leak detection (already exists in sanitizer — wire it into all routes consistently)
- Response size bounds (prevent runaway token generation)

---

## Week 3 (Days 15–21): Observability & SLOs

### W3-1: SLO Document

**New file**: `docs/slo-baseline.md`

```markdown
# EuFund SLO Baseline (v1.0)

## Service: Web Application (Cloud Run)

| SLI                         | Target | Measurement                                              | Alert Threshold |
|-----------------------------|--------|----------------------------------------------------------|-----------------|
| Availability                | 99.5%  | 1 - (5xx responses / total responses) over 30d window    | <99% over 1h   |
| API P95 Latency             | 500ms  | histogram_quantile(0.95, http_request_duration_seconds)   | >500ms for 10m  |
| API P99 Latency             | 2s     | histogram_quantile(0.99, http_request_duration_seconds)   | >2s for 5m      |
| Error Rate                  | <1%    | rate(http_request_errors_total) / rate(http_requests_total)| >5% for 5m     |
| AI Generation Success Rate  | 95%    | 1 - (ai_errors / ai_requests_total)                      | <90% for 15m    |
| Health Check Success        | 99.9%  | Uptime of /api/health returning 200                       | any 503 for 2m  |

## Service: Database (PostgreSQL / Cloud SQL)

| SLI                         | Target | Measurement                                              |
|-----------------------------|--------|----------------------------------------------------------|
| Query P95 Latency           | 100ms  | histogram_quantile(0.95, db_query_duration_seconds)       |
| Connection Pool Utilization | <80%   | db_connection_pool_size / max_connections                  |
| Migration Success Rate      | 100%   | Manual — every migration must be tested in preflight CI   |

## Service: Redis (Rate Limiting)

| SLI                         | Target | Measurement                                              |
|-----------------------------|--------|----------------------------------------------------------|
| Availability                | 99.9%  | redis_up metric (PING response)                           |
| Command Latency P95         | 10ms   | redis_command_duration_seconds                             |

## Error Budget Policy
- 99.5% availability = 3.6h downtime/month budget
- If budget exhausted: freeze non-critical deploys, focus on reliability
- Error budget reviewed weekly in ops standup

## Measurement
- Source: Prometheus metrics at `/api/metrics`
- Dashboard: Grafana (see `monitoring/docker-compose.monitoring.yml`)
- Alert rules: `monitoring/alerting-rules.yml`
```

### W3-2: Burn-Rate Alerts

**Modify**: `monitoring/alerting-rules.yml` — add burn-rate alerts:

```yaml
  - name: eu-funds-slo-burn
    rules:
      # Fast burn: will exhaust 30d budget in 1h
      - alert: SLOBudgetFastBurn
        expr: |
          (
            1 - (rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]))
          ) < 0.98
        for: 2m
        labels:
          severity: critical
          slo: availability
        annotations:
          summary: "SLO fast burn — error budget will exhaust in <1h at current rate"

      # Slow burn: will exhaust 30d budget in 3d
      - alert: SLOBudgetSlowBurn
        expr: |
          (
            1 - (rate(http_requests_total{status=~"5.."}[1h]) / rate(http_requests_total[1h]))
          ) < 0.995
        for: 1h
        labels:
          severity: warning
          slo: availability
        annotations:
          summary: "SLO slow burn — error budget draining faster than expected"
```

### W3-3: Structured Logging Enhancement

**Modify**: Add request correlation ID propagation. Currently `x-request-id` is set in middleware but not threaded to:
- DB queries (for slow query correlation)
- AI provider calls (for tracing through gateway)
- Error reports to Sentry

**Files to modify**:
- `app/src/middleware.ts` — already sets `x-request-id` ✓
- `app/src/lib/db/index.ts` — log query with request ID in comments
- `app/src/lib/ai/client-v2.ts` — pass `x-request-id` header to providers
- `app/src/lib/monitoring/sentry.ts` — set `requestId` tag on Sentry scope

### W3-4: Post-Deploy Smoke Test Suite

**New file**: `scripts/smoke-test.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:?Usage: smoke-test.sh <base-url>}"

echo "=== EuFund Post-Deploy Smoke Test ==="

# 1. Health check
echo -n "Health check... "
HEALTH=$(curl -sf "$BASE_URL/api/health" | jq -r '.status')
[ "$HEALTH" = "healthy" ] && echo "OK" || { echo "FAIL: $HEALTH"; exit 1; }

# 2. Readiness
echo -n "Readiness... "
READY=$(curl -sf "$BASE_URL/api/readiness" | jq -r '.status')
[ "$READY" = "ready" ] && echo "OK" || { echo "FAIL: $READY"; exit 1; }

# 3. Metrics endpoint
echo -n "Metrics... "
curl -sf "$BASE_URL/api/metrics" | grep -q "http_requests_total" && echo "OK" || { echo "FAIL"; exit 1; }

# 4. Login page loads (Romanian)
echo -n "Login page (ro)... "
HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" "$BASE_URL/ro/autentificare")
[ "$HTTP_CODE" = "200" ] && echo "OK" || { echo "FAIL: HTTP $HTTP_CODE"; exit 1; }

# 5. Login page loads (English)
echo -n "Login page (en)... "
HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" "$BASE_URL/en/autentificare")
[ "$HTTP_CODE" = "200" ] && echo "OK" || { echo "FAIL: HTTP $HTTP_CODE"; exit 1; }

# 6. API returns proper CORS/security headers
echo -n "Security headers... "
HEADERS=$(curl -sf -I "$BASE_URL/api/health")
echo "$HEADERS" | grep -qi "x-content-type-options: nosniff" && echo "OK" || { echo "FAIL: missing nosniff"; exit 1; }

# 7. CSRF token is set
echo -n "CSRF token... "
CSRF=$(curl -sf -I "$BASE_URL/ro/autentificare" | grep -i "x-csrf-token" || true)
[ -n "$CSRF" ] && echo "OK" || echo "WARN: no CSRF header on page load (may be cookie-only)"

echo ""
echo "=== All smoke tests passed ==="
```

**Integrate into deploy workflows**:
- `deploy-production.yml` — replace single curl with `./scripts/smoke-test.sh $SERVICE_URL`
- `deploy-staging.yml` — same

---

## Week 4 (Days 22–30): Incident Response & Hardened Rollbacks

### W4-1: Incident Runbook (Top 10)

**New file**: `docs/incident-runbooks.md`

```markdown
# EuFund Incident Runbooks

## INC-01: Application 5xx Spike
**Detection**: SLOBudgetFastBurn or HighErrorRate alert
**Severity**: P1
**Steps**:
1. Check `/api/health` — identify which service is failing (DB, Redis, AI, Storage)
2. Check Cloud Run logs: `gcloud run services logs tail fondeu-platform --region=europe-west2`
3. Check Sentry for new error clusters
4. If DB: check Cloud SQL metrics, connection count, slow queries
5. If Redis: check Redis INFO, memory usage, connection count
6. If AI provider: check circuit breaker state, fallback to alternative provider
7. If recent deploy: rollback via `deploy-production.yml` with `rollback: true`
**Rollback**: GitHub Actions → deploy-production.yml → Run workflow → rollback=true

## INC-02: Database Connection Pool Exhaustion
**Detection**: DBConnectionPoolHigh alert, 503 errors
**Steps**:
1. Check active connections: `SELECT count(*) FROM pg_stat_activity;`
2. Check for long-running queries: `SELECT * FROM pg_stat_activity WHERE state = 'active' AND query_start < NOW() - interval '30 seconds';`
3. Kill stuck queries: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE ...;`
4. Check if connection leak in app (look for missing connection release)
5. Temporary: increase `max_connections` in Cloud SQL
6. Root cause: check Drizzle pool settings in `app/src/lib/db/index.ts` (currently max=10)

## INC-03: Redis Unavailable (AI Endpoints Return 503)
**Detection**: Redis health=0, all AI endpoints returning 503
**Impact**: ALL AI features down (fail-closed design)
**Steps**:
1. Check Redis instance health (Memorystore console or `redis-cli PING`)
2. Check network connectivity from Cloud Run to Redis
3. Check Redis memory: `INFO memory` — is maxmemory reached?
4. If OOM: flush stale rate limit keys: `SCAN 0 MATCH rate_limit:* COUNT 1000`
5. If Redis completely down: consider temporary fail-open (DANGER: removes rate limiting)
6. Restart Redis instance if hung

## INC-04: AI Provider Outage
**Detection**: ExternalAPIDown alert, circuit breaker OPEN state
**Steps**:
1. Check which provider is down (circuit breaker metrics)
2. Verify fallback routing is active (AI router should auto-switch)
3. If OpenAI (primary) down: verify Anthropic/Google fallback is working
4. If all providers down: return user-friendly "AI temporarily unavailable" message
5. Check AI_GATEWAY_URL if using gateway proxy
6. Monitor provider status pages (status.openai.com, status.anthropic.com)

## INC-05: Migration Failure in Production
**Detection**: Deploy health check fails post-migration, app crash loop
**Steps**:
1. DO NOT PANIC — Cloud Run keeps previous revision running
2. Identify failing migration in deploy logs
3. If migration is additive (ADD COLUMN): usually safe, check for NOT NULL without DEFAULT
4. If migration is destructive: apply rollback SQL (should be in PR description)
5. Rollback app to previous revision: deploy-production.yml → rollback=true
6. Fix migration, test in staging, re-deploy
**Prevention**: Migration preflight CI (W1-1) catches this before merge

## INC-06: CSRF Token Mismatch (Users Can't Submit Forms)
**Detection**: Spike in 403 responses on POST/PUT/PATCH endpoints
**Steps**:
1. Check if recent middleware change broke CSRF flow
2. Check if CDN/proxy is stripping cookies or headers
3. Verify `csrf-token` cookie is being set (check `Set-Cookie` header)
4. Check for clock skew if token has expiry
5. Test: `curl -c cookies.txt -b cookies.txt -X POST ...`
6. Temporary mitigation: add failing path to CSRF exemption list (DANGER: security risk)

## INC-07: Certificate/TLS Expiry
**Detection**: Users report connection errors, monitoring shows 0 healthy endpoints
**Steps**:
1. Check Google-managed cert status: `gcloud compute ssl-certificates describe ...`
2. If auto-renewal failed: check DNS records, domain verification
3. Temporary: provision new certificate manually
4. Check cert-manager (k8s) or GCP Certificate Manager logs

## INC-08: Memory Leak (Cloud Run Instance OOM)
**Detection**: Container restarts, increasing memory usage in `/api/health` response
**Steps**:
1. Check `/api/health` → `memory` field for heap growth trend
2. Check Cloud Run metrics: memory utilization per instance
3. Common causes: unbounded caches (LRU cache in feature flags has 500 limit ✓), event listener leaks, large AI responses held in memory
4. Temporary: increase Cloud Run memory limit
5. Root cause: add heap snapshot endpoint (dev only), review recent code changes

## INC-09: Stripe Webhook Failures
**Detection**: Users report payment issues, webhook delivery failures in Stripe dashboard
**Steps**:
1. Check Stripe dashboard → Webhooks → Recent deliveries
2. Verify webhook secret matches `STRIPE_WEBHOOK_SECRET` env var
3. Check if endpoint URL changed (redeploy may change Cloud Run URL)
4. Check webhook handler logs for parsing errors
5. Replay failed webhooks from Stripe dashboard
6. Verify CSRF exemption for `/api/webhooks/stripe`

## INC-10: Audit Log Chain Broken
**Detection**: `verifyAuditChainIntegrity()` returns broken link
**Severity**: P1 — compliance/legal impact (tamper evidence)
**Steps**:
1. Identify the broken link: query audit_log for entries where previous_hash doesn't match
2. Check if concurrent writes caused a race condition
3. Check if a migration or manual DB edit broke the chain
4. DO NOT delete or modify audit entries
5. Document the break with timestamp and cause
6. Insert a "chain break acknowledgment" entry with manual verification note
7. Notify DPO (GDPR compliance impact)
8. File incident report for ANSPDCP if breach suspected
```

### W4-2: Runbook Test Schedule

**Modify**: `.github/workflows/ci.yml` or create new `chaos-test.yml`:

Monthly automated checks:
- Health endpoint responds correctly under load (k6 or artillery)
- Rollback workflow can be triggered (dry run)
- Migration preflight catches known-bad migrations (test fixture)

### W4-3: Deploy Canary Support

**Modify**: `.github/workflows/deploy-production.yml`

Add traffic splitting for Cloud Run:

```yaml
      - name: Deploy canary (10% traffic)
        if: inputs.rollback != true
        run: |
          gcloud run deploy fondeu-platform \
            --image "$IMAGE" \
            --region europe-west2 \
            --no-traffic \
            --tag canary

          gcloud run services update-traffic fondeu-platform \
            --region europe-west2 \
            --to-tags canary=10

      - name: Canary health check (5 min bake)
        run: |
          CANARY_URL=$(gcloud run services describe fondeu-platform \
            --region europe-west2 --format='value(status.traffic[0].url)')
          for i in $(seq 1 15); do
            STATUS=$(curl -sf "$CANARY_URL/api/health" | jq -r '.status')
            echo "Canary check $i/15: $STATUS"
            if [ "$STATUS" != "healthy" ]; then
              echo "::error::Canary unhealthy — rolling back"
              gcloud run services update-traffic fondeu-platform \
                --region europe-west2 --to-latest
              exit 1
            fi
            sleep 20
          done

      - name: Promote canary to 100%
        run: |
          gcloud run services update-traffic fondeu-platform \
            --region europe-west2 \
            --to-latest
```

### W4-4: Rollback Script for GCP (Currently Only AWS)

**New file**: `scripts/rollback-gcp.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

REGION="${GCP_REGION:-europe-west2}"
SERVICE="${GCP_SERVICE:-fondeu-platform}"

echo "=== GCP Cloud Run Rollback ==="

# List recent revisions
echo "Recent revisions:"
gcloud run revisions list --service="$SERVICE" --region="$REGION" \
  --format="table(name,active,creationTimestamp)" --limit=5

# Get current serving revision
CURRENT=$(gcloud run services describe "$SERVICE" --region="$REGION" \
  --format="value(status.traffic.revisionName)" | head -1)
echo "Currently serving: $CURRENT"

# Get previous revision
PREVIOUS=$(gcloud run revisions list --service="$SERVICE" --region="$REGION" \
  --format="value(name)" --limit=2 | tail -1)
echo "Rolling back to: $PREVIOUS"

read -rp "Proceed? (y/N): " CONFIRM
[ "$CONFIRM" != "y" ] && echo "Cancelled" && exit 0

gcloud run services update-traffic "$SERVICE" \
  --region="$REGION" \
  --to-revisions="$PREVIOUS=100"

echo "Verifying health..."
SERVICE_URL=$(gcloud run services describe "$SERVICE" --region="$REGION" \
  --format="value(status.url)")
sleep 10
curl -sf "$SERVICE_URL/api/health" | jq .

echo "✅ Rolled back to $PREVIOUS"
```

---

## File-by-File Implementation Checklist

### New Files

| # | File Path | Week | Priority | Description |
|---|-----------|------|----------|-------------|
| 1 | `.github/PULL_REQUEST_TEMPLATE.md` | QW | P0 | PR template with migration/rollback sections |
| 2 | `app/src/app/api/readiness/route.ts` | QW | P0 | Lightweight readiness probe |
| 3 | `.github/workflows/migration-preflight.yml` | W1 | P0 | Migration dry-run with destructive-op detection |
| 4 | `.github/workflows/release-gate.yml` | W1 | P1 | PR quality gate (labels, description length) |
| 5 | `app/tests/integration/ai-gateway-contract.test.ts` | W2 | P1 | AI provider contract validation |
| 6 | `app/src/lib/ai/response-validator.ts` | W2 | P1 | AI response schema + safety validation |
| 7 | `docs/slo-baseline.md` | W3 | P1 | SLO definitions and error budget policy |
| 8 | `scripts/smoke-test.sh` | W3 | P0 | Post-deploy verification (7 checks) |
| 9 | `docs/incident-runbooks.md` | W4 | P1 | Top 10 incident playbooks |
| 10 | `scripts/rollback-gcp.sh` | W4 | P0 | GCP Cloud Run rollback (matches existing AWS script) |

### Modified Files

| # | File Path | Week | Change |
|---|-----------|------|--------|
| 1 | `app/src/middleware.ts` | QW | Add `/api/readiness` to public paths |
| 2 | `.github/workflows/ci.yml` | W1 | Pin Node version; add ai-contract-check job |
| 3 | `app/package.json` | W1 | Add `preflight` script |
| 4 | `app/src/lib/errors/index.ts` | W2 | Emit circuit breaker metrics |
| 5 | `app/src/lib/monitoring/metrics.ts` | W2 | Register circuit breaker + AI gateway metrics |
| 6 | `monitoring/alerting-rules.yml` | W3 | Add SLO burn-rate alerts |
| 7 | `app/src/lib/db/index.ts` | W3 | Add request ID to query comments |
| 8 | `app/src/lib/ai/client-v2.ts` | W3 | Pass `x-request-id` to providers |
| 9 | `app/src/lib/monitoring/sentry.ts` | W3 | Set `requestId` tag on Sentry scope |
| 10 | `.github/workflows/deploy-production.yml` | W4 | Add canary traffic splitting + smoke test |
| 11 | `.github/workflows/deploy-staging.yml` | W4 | Add smoke test post-deploy |

### GitHub Settings Changes (Manual)

| # | Setting | Week |
|---|---------|------|
| 1 | Branch protection on `main`: require PR, 1 approval, status checks | W1 |
| 2 | Required status checks: quality, security-gates, build-and-test | W1 |
| 3 | Add `migration-check` as required when paths match | W1 |
| 4 | Create labels: type:bugfix, type:feature, type:infra, type:docs, type:security | W1 |

---

## SLO Baseline Proposal

| SLI | Target | Current Measurement | Gap |
|-----|--------|---------------------|-----|
| **Availability** | 99.5% (3.6h/month budget) | `/api/health` + 5xx rate | No burn-rate alerts |
| **API P95 Latency** | 500ms | `http_request_duration_seconds` histogram | Alert exists, no dashboard |
| **API P99 Latency** | 2s | Same histogram | Alert exists |
| **Error Rate** | <1% (alert at 5%) | `http_request_errors_total` | Alert threshold too generous |
| **AI Success Rate** | 95% | `ai_requests_total` counter exists | No error rate metric |
| **DB P95 Latency** | 100ms | Alert exists for `db_query_duration_seconds` | Metric may not be emitted yet |

**Recommendation**: Start with 99.5% availability SLO. It's achievable for a Cloud Run service with health checks. Tighten to 99.9% after 2 months of baseline data.

---

## Risks and Tradeoffs

### R1: `master` vs `main` Branch Divergence
**Risk**: HIGH — CI gates added to `main` are meaningless if all development happens on `master`. The migration preflight, release gate, and branch protection only apply to the branch they're configured for.
**Mitigation**: Reconcile branches FIRST. Either merge `master` → `main` or switch CI to `master`. This is a blocker for Week 1 changes.

### R2: Dual-Cloud Complexity
**Risk**: MEDIUM — Staging (AWS ECS) and production (GCP Cloud Run) have different networking, secrets management, and deployment models. A bug in staging may not reproduce in prod and vice versa.
**Tradeoff**: Standardizing on one cloud is ideal but high-effort. For now, ensure smoke tests run on BOTH environments.

### R3: Migration Preflight Uses Ephemeral DB
**Risk**: LOW — The preflight CI uses a fresh Postgres container, not a clone of prod data. Migrations that work on empty tables may fail on tables with millions of rows (lock contention, constraint violations on existing data).
**Mitigation**: For data-heavy migrations, add a step that seeds the ephemeral DB with representative row counts before running the migration.

### R4: Canary Deploys Add Latency to Releases
**Risk**: LOW — The 5-minute canary bake time adds ~5 min to every deploy. For hotfixes, this may feel slow.
**Tradeoff**: The canary step can be skipped with an input flag (`skip_canary: true`) for emergency deploys, but this should be rare.

### R5: Circuit Breaker Metrics Are In-Memory
**Risk**: MEDIUM — The Prometheus metrics registry is in-memory. Cloud Run instances are ephemeral and can be recycled. Metrics are lost on instance restart.
**Mitigation**: Use Prometheus scrape interval < Cloud Run idle timeout. For durable metrics, push to Cloud Monitoring (GCP) or use a sidecar.

### R6: No Staging Database Parity
**Risk**: MEDIUM — Staging likely has a different DB schema version than prod if migrations aren't applied consistently.
**Mitigation**: Staging deploy should run `npx drizzle-kit migrate` as a pre-deploy step (currently only the prod Dockerfile copies migrations).

### R7: Test Coverage Gaps
**Risk**: MEDIUM — 33 integration tests is solid but there are no load/performance tests. The SLO P95 latency target of 500ms is unmeasured.
**Mitigation**: Week 4 introduces k6/artillery smoke load test. Full load testing is a follow-up sprint.

### R8: Single Reviewer Bottleneck
**Risk**: LOW-MEDIUM — Requiring 1 PR approval is a minimum. With a small team, the reviewer may rubber-stamp under time pressure.
**Tradeoff**: 2 reviewers is ideal but may be impractical for a small team. Use automated checks (typecheck, lint, tests, migration preflight) to compensate.

---

## READY_TO_EXECUTE: **NO**

### Blockers:

1. **BLOCKER: Branch reconciliation** — `master` has diverged massively from `origin/main`. All CI gates target `main`. Until these branches are reconciled, adding workflows to `main` is pointless because development doesn't happen there. **Action needed**: Owner decides merge strategy (merge master→main, or switch all CI to master).

2. **BLOCKER: Working tree is dirty** — 15 modified files + 3 untracked files (conversational wizard WIP). These need to be committed or stashed before any hardening PRs are created. **Action needed**: Commit or stash WIP.

3. **DECISION NEEDED: Target branch** — Should CI/protection be configured for `main` or `master`? This affects every workflow file in this plan.

4. **DECISION NEEDED: Cloud provider standardization** — Rollback scripts, smoke tests, and canary deploys need to target the right infra. Current state: staging=AWS, prod=GCP. The existing `scripts/rollback.sh` only works for AWS. **Action needed**: Confirm prod will remain on GCP Cloud Run.

### Once Blockers Are Resolved:

All changes in this plan are PR-only, non-destructive, and independently shippable. The recommended order is:

```
QW-1 (PR template)           → merge first, governs all subsequent PRs
QW-2 (readiness endpoint)    → can merge independently
W1-1 (migration preflight)   → merge before any new migrations
W1-2 (release gate)          → merge after branch protection is set
W3-4 (smoke test)            → merge before next production deploy
W4-1 (runbooks)              → merge anytime
```

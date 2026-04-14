# Probe 08 — Env-var reach

**Run on:** 2026-04-14 against `master` at commit `1040228`.
**Spec reference:** Section 2, probe 8.
**Purpose:** Enumerate declared environment variables and identify declared-but-unread values that may indicate dead or drifted configuration.

## Commands

```bash
rg -n "^[A-Z_]+=" app/.env.example .env.example
rg -n "^_[A-Z_]+:|--set-env-vars" app/cloudbuild.production.yaml cloudbuild.production.yaml
rg -n "process\.env\.[A-Z_]+" app/src app/scripts | rg -o "process\.env\.[A-Z_]+"

declared=$(awk -F= '/^[A-Z_]+=/{print $1}' app/.env.example | sort -u)
read=$(rg -o 'process\.env\.[A-Z_]+' app/src app/scripts | sed 's/.*process\.env\.//' | sort -u)
comm -23 <(printf '%s\n' "$declared") <(printf '%s\n' "$read")
```

## Raw output

```text
## A. Vars in app/.env.example (or root .env.example)
app/.env.example:10:QDRANT_API_KEY
app/.env.example:11:VECTOR_COLLECTION
app/.env.example:14:DATABASE_URL
app/.env.example:15:DB_PASS
app/.env.example:16:NEXTAUTH_URL
app/.env.example:17:NEXTAUTH_SECRET
app/.env.example:20:GOOGLE_CLIENT_ID
app/.env.example:21:GOOGLE_CLIENT_SECRET
app/.env.example:22:MICROSOFT_CLIENT_ID
app/.env.example:23:MICROSOFT_CLIENT_SECRET
app/.env.example:24:FACEBOOK_CLIENT_ID
app/.env.example:25:FACEBOOK_CLIENT_SECRET
app/.env.example:28:SMTP_HOST
app/.env.example:29:SMTP_PORT
app/.env.example:2:AI_GATEWAY_URL
app/.env.example:30:SMTP_USER
app/.env.example:31:SMTP_PASSWORD
app/.env.example:32:EMAIL_FROM
app/.env.example:33:CONSENT_POLICY_VERSION
app/.env.example:34:NEXT_PUBLIC_CONSENT_POLICY_VERSION
app/.env.example:35:REDIS_URL
app/.env.example:36:NODE_ENV
app/.env.example:37:SENTRY_DSN
app/.env.example:38:SMTP_PASS
app/.env.example:39:LOG_LEVEL
app/.env.example:3:AI_GATEWAY_API_KEY
app/.env.example:40:METRICS_AUTH_TOKEN
app/.env.example:41:HEALTHCHECK_AUTH_TOKEN
app/.env.example:42:TRIAL_NOTIFICATIONS_AUTH_TOKEN
app/.env.example:43:ALLOW_DEMO_CALLS
app/.env.example:44:BILLING_ENABLED
app/.env.example:47:NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
app/.env.example:48:STRIPE_SECRET_KEY
app/.env.example:49:STRIPE_WEBHOOK_SECRET
app/.env.example:4:AI_GATEWAY_TENANT_ID
app/.env.example:52:UPLOAD_DIR
app/.env.example:53:GCS_BUCKET
app/.env.example:54:GCS_PROJECT_ID
app/.env.example:55:GCS_KEY_FILENAME
app/.env.example:56:STORAGE_STRICT_GCS
app/.env.example:5:AI_ANALYSIS_MODEL
app/.env.example:8:VECTOR_PROVIDER
app/.env.example:9:QDRANT_URL

## B. Vars in cloudbuild.production.yaml
cloudbuild.production.yaml:108:            --set-env-vars "DB_SOCKET_PATH=$_DB_SOCKET_PATH" \
cloudbuild.production.yaml:124:            --set-env-vars "DB_SOCKET_PATH=$_DB_SOCKET_PATH" \
cloudbuild.production.yaml:166:          --set-env-vars "APP_VERSION=${SHORT_SHA:-$BUILD_ID},GITHUB_SHA=${COMMIT_SHA:-${SHORT_SHA:-$BUILD_ID}},GCS_BUCKET=$_GCS_BUCKET,GCS_PROJECT_ID=$PROJECT_ID,GCS_KEY_FILENAME=$_GCS_KEY_FILENAME,STORAGE_STRICT_GCS=true,VECTOR_PROVIDER=qdrant,QDRANT_URL=$_QDRANT_URL,AI_GATEWAY_URL=$_AI_GATEWAY_URL,AI_GATEWAY_TENANT_ID=$_AI_GATEWAY_TENANT_ID,NODE_ENV=production,NEXT_PUBLIC_APP_URL=$_PRODUCTION_URL,NEXTAUTH_URL=$_PRODUCTION_URL,DB_SOCKET_PATH=$_DB_SOCKET_PATH,DB_NAME=$_DB_NAME,DB_USER=$_DB_USER" \
(none)

## C. Vars referenced via process.env.X in app/src and app/scripts
process.env.AI_ANALYSIS_MODEL
process.env.AI_EMBEDDING_MODEL
process.env.AI_GATEWAY_API_KEY
process.env.AI_GATEWAY_KEY
process.env.AI_GATEWAY_TENANT_ID
process.env.AI_GATEWAY_URL
process.env.AI_GENERATION_MODEL
process.env.ALLOW_DEMO_CALLS
process.env.ANTHROPIC_API_KEY
process.env.APPLE_CLIENT_ID
process.env.APPLE_CLIENT_SECRET
process.env.APP_VERSION
process.env.AUDIT_DLQ_PATH
process.env.AUTH_SECRET
process.env.BILLING_ENABLED
process.env.CERTSIGN_API_KEY
process.env.CERTSIGN_BASE_URL
process.env.CONSENT_POLICY_VERSION
process.env.DATABASE_URL
process.env.DB_NAME
process.env.DB_PASS
process.env.DB_SOCKET_PATH
process.env.DB_USER
process.env.EC_PORTAL_API_KEY
process.env.EMAIL_FROM
process.env.FACEBOOK_CLIENT_ID
process.env.FACEBOOK_CLIENT_SECRET
process.env.GCS_BUCKET
process.env.GCS_KEY_FILENAME
process.env.GCS_PROJECT_ID
process.env.GITHUB_SHA
process.env.GOOGLE_AI_API_KEY
process.env.GOOGLE_CLIENT_ID
process.env.GOOGLE_CLIENT_SECRET
process.env.HEALTHCHECK_AUTH_TOKEN
process.env.HOME
process.env.HOSTNAME
process.env.HUGGINGFACE_TOKEN
process.env.LOG_LEVEL
process.env.MCP_TOKEN_SECRET
process.env.METRICS_AUTH_TOKEN
process.env.MICROSOFT_CLIENT_ID
process.env.MICROSOFT_CLIENT_SECRET
process.env.MYSMIS_API_KEY
process.env.MYSMIS_BASE_URL
process.env.NEXTAUTH_SECRET
process.env.NEXT_PUBLIC_APP_URL
process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION
process.env.NEXT_PUBLIC_NODE_ENV
process.env.NEXT_RUNTIME
process.env.NODE_ENV
process.env.OPENAI_API_KEY
process.env.PERPLEXITY_API_KEY
process.env.PORT
process.env.QDRANT_API_KEY
process.env.QDRANT_URL
process.env.REDIS_URL
process.env.ROMANIAN_BERT_ENDPOINT
process.env.SENTRY_DSN
process.env.SMTP_FROM
process.env.SMTP_HOST
process.env.SMTP_PASS
process.env.SMTP_PASSWORD
process.env.SMTP_PORT
process.env.SMTP_USER
process.env.STORAGE_STRICT_GCS
process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY
process.env.STRIPE_PRICE_ENTERPRISE_YEARLY
process.env.STRIPE_PRICE_PLUS_MONTHLY
process.env.STRIPE_PRICE_PLUS_YEARLY
process.env.STRIPE_PRICE_PRO_MONTHLY
process.env.STRIPE_PRICE_PRO_YEARLY
process.env.STRIPE_PRICE_ULTRA_MONTHLY
process.env.STRIPE_PRICE_ULTRA_YEARLY
process.env.STRIPE_SECRET_KEY
process.env.STRIPE_WEBHOOK_SECRET
process.env.TRIAL_NOTIFICATIONS_AUTH_TOKEN
process.env.UPLOAD_DIR
process.env.VAULT_ROOT
process.env.VECTOR_COLLECTION
process.env.VECTOR_PROVIDER
process.env.VERCEL_GIT_COMMIT_SHA
process.env.VERCEL_URL

# Declared in app/.env.example but never read in app/src or app/scripts
NEXTAUTH_URL
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
```

## Classification

| Env var | Declared | Read in `app/src` / `app/scripts` | Classification |
|---------|----------|-----------------------------------|----------------|
| `NEXTAUTH_URL` | Yes | No | Declared-but-unread; candidate for separate auth/config audit, not tied cleanly to a decommission track |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Yes | No | Declared-but-unread; candidate for separate billing/config audit, not tied cleanly to a decommission track |
| `AI_GATEWAY_URL` | Yes | Yes | Live runtime config |
| `AI_GATEWAY_API_KEY` | Yes | Yes | Live runtime config |
| `AI_GATEWAY_TENANT_ID` | Yes | Yes | Live runtime config |
| `QDRANT_URL` / `QDRANT_API_KEY` | Yes | Yes | Live vector infrastructure config |

## Notes

- Probe 08 did not surface any declared-but-unread env var that maps directly to the legacy decommissioning tracks.
- The two unread vars are real drift candidates, but they look broader than this program's scope and should not be force-fit into plans 3, 4, or 5.

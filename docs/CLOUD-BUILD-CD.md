# Cloud Build CD

Date: 2026-03-11
Status: canonical production deployment path

## Purpose

FundEU production deploys should run through Cloud Build, not GitHub-hosted deployment jobs.

Primary config:
- `cloudbuild.production.yaml`

Legacy image-only build:
- `cloudbuild.yaml`

## What the production pipeline does

`cloudbuild.production.yaml` performs:
- Docker image build for `infrastructure/Dockerfile.prod`
- push of versioned image and `latest` to Artifact Registry
- pre-deploy Cloud SQL backup
- migration job update/create
- migration execution
- Cloud Run deploy for `fondeu-platform`
- AI gateway smoke checks
- authenticated production health check

## Required substitutions

Configure these on the Cloud Build trigger:
- `_GCS_BUCKET`
- `_GCS_KEY_FILENAME`
- `_QDRANT_URL`
- `_AI_GATEWAY_URL`
- `_PRODUCTION_URL`
- `_CLOUDSQL_CONNECTION_NAME`
- `_DB_SOCKET_PATH`
- `_DB_NAME`
- `_DB_USER`
- `_VPC_CONNECTOR`
- `_VPC_EGRESS`

Defaults already exist for:
- `_SERVICE=fondeu-platform`
- `_REGION=europe-west2`
- `_MIGRATION_JOB=fondeu-db-migrate`
- `_CLOUD_SQL_INSTANCE=fondeu-db`
- `_AI_GATEWAY_TENANT_ID=fondeu-platform`
- `_CLOUDSQL_CONNECTION_NAME=eufunding:europe-west2:fondeu-db`
- `_DB_SOCKET_PATH=/cloudsql/eufunding:europe-west2:fondeu-db`
- `_VPC_CONNECTOR=fondeu-vpc-connector`
- `_VPC_EGRESS=private-ranges-only`

## Secret names

The pipeline supports overridable secret-name substitutions. Defaults match current live production naming:
- `_DATABASE_URL_SECRET_NAME=DATABASE_URL`
- `_NEXTAUTH_SECRET_NAME=NEXTAUTH_SECRET`
- `_REDIS_URL_SECRET_NAME=REDIS_URL`
- `_SENTRY_DSN_SECRET_NAME=SENTRY_DSN`
- `_QDRANT_API_KEY_SECRET_NAME=QDRANT_API_KEY`
- `_SMTP_PASS_SECRET_NAME=SMTP_PASS`
- `_DB_PASS_SECRET_NAME=DB_PASS`
- `_AI_GATEWAY_SECRET_NAME=AI_GATEWAY_KEY`
- `_STRIPE_PUBLISHABLE_SECRET_NAME=STRIPE_PUBLISHABLE_KEY`
- `_STRIPE_SECRET_KEY_SECRET_NAME=stripe-secret-key`
- `_STRIPE_WEBHOOK_SECRET_NAME=stripe-webhook-secret`
- `_HEALTHCHECK_SECRET_NAME=` optional

## Required secrets

These must exist in Secret Manager:
- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `REDIS_URL`
- `SENTRY_DSN`
- `QDRANT_API_KEY`
- `SMTP_PASS`
- `DB_PASS`
- `AI_GATEWAY_KEY` by default, or whatever `_AI_GATEWAY_SECRET_NAME` points to
- `STRIPE_PUBLISHABLE_KEY` by default, or whatever `_STRIPE_PUBLISHABLE_SECRET_NAME` points to
- `stripe-secret-key` by default, or whatever `_STRIPE_SECRET_KEY_SECRET_NAME` points to
- `stripe-webhook-secret` by default, or whatever `_STRIPE_WEBHOOK_SECRET_NAME` points to
- optional authenticated health-check secret if you set `_HEALTHCHECK_SECRET_NAME`

## Trigger recommendation

Create one production trigger:
- branch: `master`
- config: `cloudbuild.production.yaml`
- approval: enabled if you want a manual promotion gate

Keep GitHub Actions for CI only. Do not rely on GitHub-hosted production deploy credentials.

## Manual run

```bash
gcloud builds submit --config cloudbuild.production.yaml
```

## Validation after deployment

```bash
gcloud run services describe fondeu-platform --region europe-west2
curl -H "Authorization: Bearer $HEALTHCHECK_AUTH_TOKEN" https://YOUR_PRODUCTION_URL/api/health
```

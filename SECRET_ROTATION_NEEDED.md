# 🚨 SECRET ROTATION NEEDED

**Date:** 2026-02-20
**Reason:** GitGuardian detected leaked secrets in git history (commits f9e356e, c1fc726, ea3dd49, caf30e2)

## Leaked Credentials — MUST ROTATE IMMEDIATELY

### 1. Stripe Live Secret Key ⚠️ CRITICAL
- **Value:** `sk_live_51ShaAgFtDF1TRyu7...` (full key was in DEPLOY_PLAN.md)
- **Action:** Go to https://dashboard.stripe.com/apikeys → Roll secret key
- **Where found:** DEPLOY_PLAN.md (commit c1fc726)

### 2. Stripe Webhook Secret ⚠️ CRITICAL
- **Value:** `whsec_xWhaNqDezUYROENI6NbN0d9KRuXzgRPU`
- **Action:** Go to https://dashboard.stripe.com/webhooks → Delete and recreate the endpoint to get a new secret
- **Where found:** DEPLOY_PLAN.md (commit c1fc726)

### 3. Stripe Publishable Key (lower risk)
- **Value:** `pk_live_51ShaAgFtDF1TRyu7...`
- **Note:** Publishable keys are designed to be public, but rotating alongside secret key is good practice
- **Where found:** DEPLOY_PLAN.md (commit c1fc726)

### 4. AI Gateway Auth Token ⚠️ HIGH
- **Value:** `by4K2R1L8B/K4jTPkPnkItKLEf8TinERSwGEUEqutuI=`
- **Action:** Regenerate the gateway API key in GCP
- **Where found:** DEPLOY_PLAN.md (commit c1fc726)

### 5. PostgreSQL Dev Password (low risk if local-only)
- **Value:** `fondeu_dev_2026`
- **Action:** Change in local docker setup if exposed externally
- **Where found:** docker-compose.yml (commit ea3dd49, fixed in caf30e2), app/.env.example

### 6. NextAuth Dev Secret (low risk)
- **Value:** `dev-secret-change-in-production-32chars!`
- **Action:** Ensure production uses a different secret (should already)
- **Where found:** docker-compose.yml (commit ea3dd49, fixed in caf30e2)

## What Was Fixed

1. ✅ Removed live Stripe keys, webhook secret, and gateway token from `DEPLOY_PLAN.md`
2. ✅ Replaced dev password in `app/.env.example` with placeholder
3. ✅ Added `.env.docker` to `.gitignore`
4. ✅ `docker-compose.yml` was already fixed in commit caf30e2 (uses `.env.docker` file)

## Git History

**The secrets still exist in git history.** After rotating all credentials:
- Use BFG Repo-Cleaner to scrub history: `bfg --replace-text secrets.txt EuFund.git`
- Or accept the risk since credentials will be rotated anyway
- Force push after cleaning: `git push --force`

## After Rotation Checklist

- [ ] Rotate Stripe secret key in Stripe Dashboard
- [ ] Recreate Stripe webhook endpoint (new whsec_)
- [ ] Regenerate AI Gateway key
- [ ] Update all secrets in GCP Secret Manager
- [ ] Redeploy Cloud Run service with new secrets
- [ ] Verify webhook events still arrive
- [ ] Clean git history with BFG (optional after rotation)
- [ ] Dismiss GitGuardian incidents

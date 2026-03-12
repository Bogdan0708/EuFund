# FondEU Deployment Plan — Feb 18, 2026

## Context
- FondEU app: `~/Dev/EU-Funds/app/` (Next.js 14, commit `5215613`)
- AI Gateway v3.0.0 deployed at: `https://ai-gateway-382299704849.europe-west2.run.app`
- Gateway auth token: [stored in GCP Secret Manager as AI_GATEWAY_API_KEY]
- GCP project: `eufunding`, region: `europe-west2`
- Artifact Registry: `europe-west2-docker.pkg.dev/eufunding/fondeu/app`
- Cloud SQL: `eufunding:europe-west2:fondeu-db`

## Stripe Config (LIVE)
- Secret key: [ROTATED — stored in GCP Secret Manager as STRIPE_SECRET_KEY]
- Publishable key: [stored in env as NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY]
- Webhook secret: [ROTATED — stored in GCP Secret Manager as STRIPE_WEBHOOK_SECRET]
- Price IDs: stored in env as STRIPE_PRICE_PRO_MONTHLY, STRIPE_PRICE_PRO_YEARLY, STRIPE_PRICE_ENTERPRISE_MONTHLY, STRIPE_PRICE_ENTERPRISE_YEARLY

## Task 1: Wire FondEU AI client to use AI Gateway
Currently `src/lib/ai/client.ts` calls providers directly. It should route through the gateway instead.

**Requirements:**
- Add env vars: `AI_GATEWAY_URL`, `AI_GATEWAY_API_KEY`
- Update `src/lib/ai/client.ts` to call gateway's `/v1/chat/completions` endpoint
- Keep fallback to direct provider calls if gateway is down
- The gateway is OpenAI-compatible, so use OpenAI SDK format

## Task 2: Add a pricing page
- Route: `/[locale]/preturi` (ro) / `/[locale]/pricing` (en)
- Show 3 tiers: Free, Pro (€29/mo), Enterprise (€99/mo)
- Each tier shows features, limits, CTA button
- Pro/Enterprise buttons link to Stripe Checkout via `/api/billing/checkout`
- Romanian and English translations

## Task 3: Stripe billing portal link in dashboard
- Add "Gestionare abonament" / "Manage subscription" link in the user dashboard sidebar
- Links to `/api/billing/portal` which creates a Stripe Customer Portal session

## Done criteria
- `npm run build` passes clean
- All new pages have ro + en translations
- Git commit with descriptive message

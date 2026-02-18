# FondEU Deployment Plan — Feb 18, 2026

## Context
- FondEU app: `~/Dev/EU-Funds/app/` (Next.js 14, commit `5215613`)
- AI Gateway v3.0.0 deployed at: `https://ai-gateway-382299704849.europe-west2.run.app`
- Gateway auth token: `by4K2R1L8B/K4jTPkPnkItKLEf8TinERSwGEUEqutuI=`
- GCP project: `eufunding`, region: `europe-west2`
- Artifact Registry: `europe-west2-docker.pkg.dev/eufunding/fondeu/app`
- Cloud SQL: `eufunding:europe-west2:fondeu-db`

## Stripe Config (LIVE)
- Secret key: `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`
- Publishable key: `pk_live_51ShaAgFtDF1TRyu7eyWPufYdfcXoBTDTeRTGA14pqIzXuXdJfmXuHMsqWgbk9IrN3DFTyfh1h1VrmCcVJynZISiZ00Nebgc2gs`
- Webhook secret: `whsec_xWhaNqDezUYROENI6NbN0d9KRuXzgRPU`
- Price IDs:
  - Pro Monthly: `price_1T27AjFtDF1TRyu76fBlpRYd`
  - Pro Yearly: `price_1T27AjFtDF1TRyu7ZjMBS8cz`
  - Enterprise Monthly: `price_1T27AkFtDF1TRyu7z539ngbG`
  - Enterprise Yearly: `price_1T27AkFtDF1TRyu7H5320TGE`

## Task 1: Wire FondEU AI client to use AI Gateway
Currently `src/lib/ai/client.ts` calls providers directly. It should route through the gateway instead.

**Requirements:**
- Add env vars: `AI_GATEWAY_URL`, `AI_GATEWAY_KEY`
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

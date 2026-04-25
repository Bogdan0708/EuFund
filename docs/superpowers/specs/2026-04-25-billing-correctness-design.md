# Billing Correctness — Design Spec

- **Date**: 2026-04-25
- **Track**: Pre-deploy hardening (top 3 from 2026-04-25 ultrareview)
- **Status**: Brainstorm complete; pending user written review
- **Sibling work**: Other Major findings from the same review (locale hardcoding, `adoptSession` ordering, agent-table RLS, document filename escaping, pubsub silent failure, document delete misreporting, export snapshot URL, managed runtime `done.finalState` staleness) are deferred to follow-up specs.

---

## 1. Context & motivation

A 2026-04-25 ultrareview surfaced three production-correctness gaps in the Stripe billing surface. The user's revised priority list collapsed them to:

1. **Stripe webhook correctness** — handler errors return 400 (so Stripe stops retrying), and a TOCTOU window in the idempotency check allows concurrent identical deliveries to double-process.
2. **Tier cache staleness** — `getUserTier()` caches user tiers for 5 minutes (`lib/middleware/auth.ts:17`) but no Stripe-driven user write invalidates it.
3. **Billing config gauntlet** — `cloudbuild.production.yaml` does not wire any `STRIPE_PRICE_*`; `resolveTierByPriceId` does not branch on `plus` or `ultra`; the `BillingTier` union and `STRIPE_PRICES` table claim those tiers exist while `getPricingTiers()` and the public pricing page do not.

Production deployment is paused per project memory; nothing here is currently customer-visible. The point of this work is to make the billing surface correct *before* it is exposed.

Splits cleanly into two PRs (one urgent, one pre-launch) to keep blast radius small.

## 2. Scope

### PR-A: Stripe webhook correctness

1. Reclassify webhook errors in `app/src/app/api/webhooks/stripe/route.ts`: 400 for bad/missing signature and malformed payload; 500 + `captureException` for server misconfig and handler errors.
2. Flip `handleWebhookEvent` in `app/src/lib/integrations/stripe/billing.ts` to insert-first idempotency with an on-error claim rollback.
3. Side-effect-based regression tests for both changes.

### PR-B: tier cache invalidation + billing config gauntlet

1. Invalidate the in-memory tier cache from all five Stripe webhook handlers using Drizzle `.returning({ id })`.
2. Remove `plus` and `ultra` from the TypeScript surface (`BillingTier` union and consumers) while leaving the Postgres `user_tier` enum intact.
3. Coerce legacy `tier='plus'` / `'ultra'` rows at the read boundary (B-coercion: plus → pro, ultra → enterprise) with a warning log.
4. Wire the four surviving `STRIPE_PRICE_*` env vars in `cloudbuild.production.yaml`.
5. Export pure helpers (`normalizeBillingTier`, `resolveTierByPriceId`) for direct unit coverage.
6. Targeted regression tests for invalidation, coercion, and price resolution.

## 3. Non-goals

- **Dropping `plus` and `ultra` from the Postgres `user_tier` enum.** Postgres enum value removal is a four-step ritual (column→text, backfill, drop/recreate enum, column→enum). Deferred to a follow-up cleanup migration once a production row count confirms zero occurrences.
- **Adding a `BILLING_ENABLED` kill switch.** Not requested; checkout has no caller in the codebase today, so the natural gate is "no route exists yet."
- **Stronger crash-window protection on the idempotency claim.** A claim row with `status` / `claimedAt` / `processedAt` / `lastError`, or wrapping claim + handler in a single DB transaction, would close the "process dies between claim and dispatch" window. Out of scope; documented limitation in PR-A. Stronger fix only if observed in production.
- **End-to-end Stripe replay tests** through the live route handler. Targeted regression at the `handleWebhookEvent` level is the agreed depth (Q4 in brainstorm).
- **Restructuring `BillingTier` into per-feature entitlements.** Tier-based gating stays as-is.
- **Other Major findings from the 2026-04-25 ultrareview.** Each gets its own follow-up.

## 4. Current state (file references)

| Concern | File:line | Current behavior |
|---|---|---|
| Webhook route | `app/src/app/api/webhooks/stripe/route.ts` | All errors return 400; no Sentry capture |
| Webhook idempotency | `app/src/lib/integrations/stripe/billing.ts:353-358` | `findFirst` then process then insert — TOCTOU |
| Webhook handlers | `app/src/lib/integrations/stripe/billing.ts:247-351` | DB writes with no `invalidateUserTierCache()` call |
| Tier cache | `app/src/lib/middleware/auth.ts:17, 20-22` | LRU max 10k, 5-min TTL; `invalidateUserTierCache(userId)` exported but unused by Stripe |
| `BillingTier` definition | `app/src/lib/billing/trial.ts` | Includes `plus` and `ultra` |
| Tier rate limits | `app/src/lib/middleware/auth.ts:59-65` | `RATE_LIMITS` defines `plus` and `ultra` |
| Tier API limits | `app/src/lib/integrations/stripe/billing.ts:85-91` | `API_CALL_LIMITS` defines `plus` and `ultra` |
| Stripe price table | `app/src/lib/integrations/stripe/billing.ts:66-83` | `STRIPE_PRICES` defines `plus` and `ultra` (env vars never wired) |
| Price-ID resolver | `app/src/lib/integrations/stripe/billing.ts:119-128` | Only branches on `pro` / `enterprise`; `plus` and `ultra` paid subs resolve to `free` |
| Public pricing | `app/src/lib/integrations/stripe/billing.ts:93-99` | `getPricingTiers()` returns only `free` / `pro` / `enterprise` |
| Tier-gate helpers | `app/src/lib/middleware/tier-gate.ts` | References `plus` and `ultra` per user audit note; `resolveUserTier()` reads `users.tier` directly |
| Direct downgrade check | `app/src/lib/integrations/stripe/billing.ts:140` | `checkIfDowngrade()` casts raw DB value to `BillingTier` and indexes `TIER_RANK` directly — bypasses `resolveBillingTrialState` |
| Tier table | `app/src/lib/billing/tiers.ts` | Defines `plus` and `ultra` per user audit note |
| Cloud Build config | `cloudbuild.production.yaml:166` | Wires `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` only |
| Postgres enum | `app/src/lib/db/schema.ts:32` | `userTierEnum` includes `'plus'` and `'ultra'` (added by `drizzle/0011_living_microbe.sql`) |
| Sentry wrapper | `app/src/lib/monitoring/sentry.ts` | `captureException(err, extra?)` is async; second arg is `extra`, not Sentry tags |

## 5. PR-A: Stripe webhook correctness

### 5.1 Error classification — `app/src/app/api/webhooks/stripe/route.ts`

Three distinct error classes, three responses. Stripe interprets 4xx as "do not retry" and 5xx as "retry with backoff."

```ts
import Stripe from 'stripe';
import { captureException } from '@/lib/monitoring/sentry';
import { logger } from '@/lib/logger';
import { constructWebhookEvent, handleWebhookEvent, MissingWebhookSecretError } from '@/lib/integrations/stripe/billing';

const log = logger.child({ component: 'stripe-webhook' });

export async function POST(req: Request): Promise<Response> {
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    log.warn('[stripe-webhook] missing stripe-signature header');
    return new Response(JSON.stringify({ error: 'missing signature' }), { status: 400 });
  }

  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(payload, signature);
  } catch (err) {
    if (err instanceof MissingWebhookSecretError) {
      await captureException(err, { source: 'stripe-webhook', kind: 'misconfig' });
      log.error({ err }, '[stripe-webhook] missing STRIPE_WEBHOOK_SECRET');
      return new Response(JSON.stringify({ error: 'server misconfigured' }), { status: 500 });
    }
    if (err instanceof Stripe.errors.StripeSignatureVerificationError) {
      log.warn({ err }, '[stripe-webhook] signature verification failed');
      return new Response(JSON.stringify({ error: 'invalid signature' }), { status: 400 });
    }
    if (err instanceof SyntaxError) {
      // stripe@18.x: signature verifies first, then JSON.parse(payload).
      // Validly signed but malformed payload lands here.
      log.warn({ err }, '[stripe-webhook] malformed payload');
      return new Response(JSON.stringify({ error: 'invalid payload' }), { status: 400 });
    }
    await captureException(err, { source: 'stripe-webhook', kind: 'construct' });
    log.error({ err }, '[stripe-webhook] unexpected construct error');
    return new Response(JSON.stringify({ error: 'internal' }), { status: 500 });
  }

  try {
    await handleWebhookEvent(event);
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    await captureException(err, { source: 'stripe-webhook', kind: 'handler', eventType: event.type, eventId: event.id });
    log.error({ err, eventType: event.type, eventId: event.id }, '[stripe-webhook] handler error');
    return new Response(JSON.stringify({ error: 'internal' }), { status: 500 });
  }
}
```

Two enabling tweaks in `app/src/lib/integrations/stripe/billing.ts`:

```ts
export class MissingWebhookSecretError extends Error {
  constructor() { super('STRIPE_WEBHOOK_SECRET is required for Stripe webhook verification.'); }
}

export function constructWebhookEvent(payload: string | Buffer, signature: string): Stripe.Event {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new MissingWebhookSecretError();
  return getStripeClient().webhooks.constructEvent(payload, signature, webhookSecret);
}
```

### 5.2 Insert-first idempotency — `app/src/lib/integrations/stripe/billing.ts:353-387`

Replace the check-then-process-then-insert sequence with insert-first as the gate, plus on-error rollback so retries can reclaim:

```ts
export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  // Insert-first idempotency: the unique constraint on event_id is the gate.
  const claimed = await db
    .insert(stripeWebhookEvents)
    .values({ eventId: event.id, eventType: event.type })
    .onConflictDoNothing()
    .returning({ id: stripeWebhookEvents.id });

  if (claimed.length === 0) return; // another delivery owns this event

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      default:
        break;
    }
  } catch (err) {
    // Release the claim so Stripe's retry can re-attempt
    await db.delete(stripeWebhookEvents).where(eq(stripeWebhookEvents.eventId, event.id));
    throw err;
  }
}
```

### 5.3 Documented limitation

The insert-first + delete-on-error pattern does **not** cover hard process death between the `INSERT … RETURNING` and the dispatch, or between successful dispatch and route return. In those windows the claim row persists and Stripe retries are silently no-op'd by the idempotency check.

Acceptable for this PR because:

- All current dispatch handlers are short-lived DB writes (< 50ms).
- The window is sub-millisecond on Cloud Run.
- Stripe surfaces "no recent successful webhook delivery" alerts in their dashboard.

If observed in production, the follow-up fix is a claim row with `status` / `claimedAt` / `processedAt` / `lastError`, or a single-transaction `claim + dispatch`. Either is its own design.

### 5.4 Tests — `tests/integration/stripe-webhooks.test.ts`

Side-effect-based: handlers stay private; tests assert via the DB calls those handlers make and via response shapes from the route handler.

**Mocking note:** `db` from `@/lib/db` is a lazy `Proxy` (per `CLAUDE.md` — first property access initializes a real Postgres connection). `vi.spyOn(db, 'update')` would trigger that initialization. Mock the module instead — follow the existing project pattern:

```ts
vi.mock('@/lib/db', () => ({
  db: {
    insert: vi.fn(/* chainable mock */),
    update: vi.fn(/* chainable mock */),
    select: vi.fn(/* chainable mock */),
    query: { stripeWebhookEvents: { findFirst: vi.fn() } },
  },
}));
import { db } from '@/lib/db';
// then assert on (db.update as Mock).mock.calls etc.
```

| # | Test | Assertion |
|---|---|---|
| 1 | Concurrent identical deliveries → exactly one observable side effect | `(db.update as Mock).mock.calls.length === 1` after `Promise.all([handle, handle])` |
| 2 | Handler throws | route returns 500, `captureException` called, `stripeWebhookEvents` row absent (so retry can claim) |
| 3 | Bad signature | route returns 400, no `captureException` call, no `stripeWebhookEvents` row |
| 4 | Missing `stripe-signature` header | route returns 400 before any `constructWebhookEvent` call |
| 5 | Malformed payload (validly signed) | route returns 400, no `stripeWebhookEvents` row |
| 6 | Missing `STRIPE_WEBHOOK_SECRET` | route returns 500, `captureException` called |
| 7 | Successful event | route returns 200, `stripeWebhookEvents` row present |
| 8 | Replay of already-processed event | `handleWebhookEvent` returns early, zero new side effects, `stripeWebhookEvents` row count unchanged |

## 6. PR-B: tier cache invalidation + billing config gauntlet

### 6.1 Tier cache invalidation — `app/src/lib/integrations/stripe/billing.ts`

Use Drizzle `.returning({ id })` so the UPDATE itself returns the userId — one round trip, not two. Loop over the returned rows so the (rare) case of multiple users sharing a `stripeCustomerId` clears each cache entry.

```ts
import { invalidateUserTierCache } from '@/lib/middleware/auth';

async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const userIdFromMetadata = subscription.metadata?.userId;
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : null;
  const priceId = subscription.items.data[0]?.price?.id;
  const resolvedTier = resolveTierByPriceId(priceId);

  const isDowngrade = await checkIfDowngrade(userIdFromMetadata, customerId, resolvedTier);
  const periodEndUnix = (subscription as { current_period_end?: number }).current_period_end;
  const updateValues = {
    tier: resolvedTier,
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: customerId,
    subscriptionStatus: mapStripeStatus(subscription.status),
    subscriptionPeriodEnd: periodEndUnix ? new Date(periodEndUnix * 1000) : null,
    ...(isDowngrade ? { apiCallsThisMonth: 0 } : {}),
    updatedAt: new Date(),
  } as const;

  const updated = userIdFromMetadata
    ? await db.update(users).set(updateValues).where(eq(users.id, userIdFromMetadata)).returning({ id: users.id })
    : customerId
      ? await db.update(users).set(updateValues).where(eq(users.stripeCustomerId, customerId)).returning({ id: users.id })
      : [];

  for (const row of updated) invalidateUserTierCache(row.id);
}
```

Apply the same pattern to:

- `handleCheckoutCompleted` (already has `userId`; just add the invalidate after the update — see also the metadata-validation note below)
- `handleSubscriptionDeleted` (same `userIdFromMetadata` / `customerId` resolution)
- `handleInvoicePaymentSucceeded` (only has `customerId` — `.returning({ id })` covers it)
- `handleInvoicePaymentFailed` (cheap insurance against future `subscriptionStatus`-driven effective-tier changes)

#### Normalize inbound Stripe metadata before writing

`handleCheckoutCompleted` currently writes `session.metadata?.tier as BillingTier | undefined` straight into `users.tier`. After PR-B narrows `BillingTier`, a stale checkout event whose metadata was set to `'plus'` or `'ultra'` (e.g., from a Stripe session created before this PR shipped) would still write the legacy value into the DB — breaking the invariant that "no new write produces a legacy tier."

Fix: validate / coerce the inbound metadata via `normalizeBillingTier`. Because `handleCheckoutCompleted` controls the entitlement granted, prefer **fail-loud** over silent coercion here — an unrecognized tier means our checkout config is broken:

```ts
const rawTierFromMetadata = session.metadata?.tier;
if (rawTierFromMetadata && rawTierFromMetadata !== 'free' && rawTierFromMetadata !== 'pro' && rawTierFromMetadata !== 'enterprise') {
  log.warn({ rawTierFromMetadata, sessionId: session.id, userId }, '[stripe-webhook] unexpected tier in checkout metadata — falling back to free');
}
const tier = normalizeBillingTier(rawTierFromMetadata) ?? 'free';
```

The `normalizeBillingTier` call still B-coerces `plus` → `pro` and `ultra` → `enterprise` (preserving paid entitlements during the transition), but anything genuinely unknown (`'admin'`, `''`, garbage) falls to `free` and surfaces a warning. This matches the read-side contract.

### 6.2 Plus/ultra removal from the TypeScript surface

Postgres enum stays as-is (out of scope per §3). TypeScript narrowing surfaces every consumer.

| File | Change |
|---|---|
| `app/src/lib/billing/trial.ts` | `BillingTier = 'free' \| 'pro' \| 'enterprise'` |
| `app/src/lib/integrations/stripe/billing.ts` | Drop `plus` and `ultra` keys from `STRIPE_PRICES` (lines 67-70, 79-82) and `API_CALL_LIMITS` (lines 87, 90) |
| `app/src/lib/middleware/auth.ts` | Drop `plus` and `ultra` from `RATE_LIMITS` (lines 61, 64) |
| `app/src/lib/middleware/tier-gate.ts` | Remove plus/ultra branches per user audit note; route DB tier reads through `normalizeBillingTier()` (see §6.3) |
| `app/src/lib/billing/tiers.ts` | Remove plus/ultra entries per user audit note |

The `resolveTierByPriceId` function (lines 119-128) already only branches on `pro` and `enterprise` — no change beyond exporting it (§6.5).

### 6.3 Legacy row coercion at every read boundary

`users.tier` in the DB can still hold `'plus'` or `'ultra'`; the TypeScript union no longer admits them. Coerce at every place the codebase reads the raw column. Two distinct boundary classes:

- **Class A — readers that already pass through `resolveBillingTrialState()`**: `getUserTier()` in `lib/middleware/auth.ts:42`, `getBillingInfo()` in `lib/integrations/stripe/billing.ts:419`, and `resolveUserTier()` in `lib/middleware/tier-gate.ts:30-60` (which casts `row.tier as BillingTier | null` at line 54 and feeds it into `resolveBillingTrialState`). Centralize coercion *inside* `resolveBillingTrialState()` so all three are fixed by a single change. **Critical: the cast in `resolveUserTier` becomes safe automatically once `resolveBillingTrialState` normalizes internally — do not replace the trial-state call with a direct `normalizeBillingTier()` return, that would skip the trial-upgrade path that turns eligible free-trial users into effective `pro`.**
- **Class B — readers that index `TIER_RANK` / `RATE_LIMITS` / `API_CALL_LIMITS` directly without going through `resolveBillingTrialState()`**: `checkIfDowngrade()` in `lib/integrations/stripe/billing.ts:140` is the only confirmed Class B reader. The grep audit in the PR description must surface any others.

#### New helper, exported for tests

```ts
// app/src/lib/billing/trial.ts
export function normalizeBillingTier(raw: string | null | undefined, ctx?: { userId?: string }): BillingTier {
  if (raw === 'plus') {
    logger.warn({ userId: ctx?.userId, rawTier: raw }, '[billing] legacy tier coerced — schedule cleanup');
    return 'pro';
  }
  if (raw === 'ultra') {
    logger.warn({ userId: ctx?.userId, rawTier: raw }, '[billing] legacy tier coerced — schedule cleanup');
    return 'enterprise';
  }
  if (raw === 'free' || raw === 'pro' || raw === 'enterprise') return raw;
  return 'free';
}
```

#### Class A: centralize in `resolveBillingTrialState`

Inside `resolveBillingTrialState()`, normalize the incoming `tier` before any rank/limit logic runs:

```ts
// app/src/lib/billing/trial.ts — at the top of resolveBillingTrialState()
export function resolveBillingTrialState(input: { tier?: string | null; /* ... */ }) {
  const tier = normalizeBillingTier(input.tier);
  // ... existing logic, now operating on a guaranteed BillingTier
}
```

`getUserTier()` and `getBillingInfo()` keep their existing call shape — no change at the call sites. `getUserTier()` becomes:

```ts
// app/src/lib/middleware/auth.ts:42 — unchanged shape, normalization moves into resolveBillingTrialState
const tier = resolveBillingTrialState(rows[0] ?? {}).effectiveTier;
```

(The `?? {}` mirrors the existing `rows[0] || {}` fallback.)

#### Class B: explicit calls at the direct readers

`checkIfDowngrade()` in `lib/integrations/stripe/billing.ts:140-143`:

```ts
const row = await db.select({ tier: users.tier }).from(users).where(condition).limit(1);
const currentTier = normalizeBillingTier(row[0]?.tier, { userId: userId ?? undefined });
return TIER_RANK[newTier] < TIER_RANK[currentTier];
```

`resolveUserTier()` in `lib/middleware/tier-gate.ts:30-60` needs **no explicit change** — it already feeds `row.tier` into `resolveBillingTrialState()`, which normalizes internally per Class A. The cast `as BillingTier | null` at line 54 becomes a no-op once `resolveBillingTrialState` coerces unrecognized values via `normalizeBillingTier`. Verify via the grep audit; do not refactor the function unless the audit shows additional direct reads.

The contract is: **every direct read of `users.tier` ends in either a `resolveBillingTrialState()` call or an explicit `normalizeBillingTier()` call before the value is used as a `BillingTier`.**

#### Audit rule for the implementation PR

Grep `users.tier` and `\.tier` references in `lib/billing/`, `lib/middleware/`, and `lib/integrations/stripe/`. Every site that reads the column from the DB must either pass the value through `resolveBillingTrialState()` or call `normalizeBillingTier()` explicitly. Add the grep result to the PR description.

### 6.4 Wire price IDs in `cloudbuild.production.yaml`

Add four substitution defaults near the top of the file:

```yaml
substitutions:
  # ... existing substitutions ...
  _STRIPE_PRICE_PRO_MONTHLY_SECRET_NAME: stripe-price-pro-monthly
  _STRIPE_PRICE_PRO_YEARLY_SECRET_NAME: stripe-price-pro-yearly
  _STRIPE_PRICE_ENTERPRISE_MONTHLY_SECRET_NAME: stripe-price-enterprise-monthly
  _STRIPE_PRICE_ENTERPRISE_YEARLY_SECRET_NAME: stripe-price-enterprise-yearly
```

Append four entries to the `--update-secrets` argument on line 166:

```
,STRIPE_PRICE_PRO_MONTHLY=${_STRIPE_PRICE_PRO_MONTHLY_SECRET_NAME}:latest,STRIPE_PRICE_PRO_YEARLY=${_STRIPE_PRICE_PRO_YEARLY_SECRET_NAME}:latest,STRIPE_PRICE_ENTERPRISE_MONTHLY=${_STRIPE_PRICE_ENTERPRISE_MONTHLY_SECRET_NAME}:latest,STRIPE_PRICE_ENTERPRISE_YEARLY=${_STRIPE_PRICE_ENTERPRISE_YEARLY_SECRET_NAME}:latest
```

Operational prereq (called out in PR checklist, not in code): create the four GCP Secret Manager entries with the actual Stripe price IDs from the live Stripe Dashboard *before* the next deploy.

Two distinct failure modes:

- **Secret missing entirely**: `gcloud run deploy --update-secrets stripe-price-pro-monthly:latest` fails at deploy time with "secret … was not found". Deploy aborts; no production impact.
- **Secret exists but holds an empty version**: deploy succeeds, the env var resolves to an empty string, and `createCheckoutSession` throws `Stripe price not configured for ${tier}/${interval}` at runtime — same failure mode as today, just visible at the point a user tries to upgrade.

The PR checklist gates on creating *non-empty* secret versions to avoid the second failure mode.

### 6.5 Test seams

The test plan in §6.6 needs three things the current code doesn't expose:

1. **`normalizeBillingTier()`** — pure, exported from `lib/billing/trial.ts` per §6.3.
2. **`resolveTierByPriceId()`** — pure, exported from `lib/integrations/stripe/billing.ts`. Today it's a private function at `:119-128`; just add `export`.
3. **`getUserTier()`** — currently a private function in `lib/middleware/auth.ts:24-49`. Tests need it to verify cache invalidation. Export it as an intentional test seam (no production behavior change; just a wider import surface).

#### Refactor `STRIPE_PRICES` to a lazy getter

`STRIPE_PRICES` (`lib/integrations/stripe/billing.ts:66-83`) is evaluated at module load. Tests cannot stub `process.env.STRIPE_PRICE_*` after the module has been imported. Replace the const with a function:

```ts
// app/src/lib/integrations/stripe/billing.ts
function getStripePrices(): Record<Exclude<BillingTier, 'free'>, Record<BillingInterval, string | undefined>> {
  return {
    pro: {
      monthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
      yearly: process.env.STRIPE_PRICE_PRO_YEARLY,
    },
    enterprise: {
      monthly: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY,
      yearly: process.env.STRIPE_PRICE_ENTERPRISE_YEARLY,
    },
  };
}
```

Call sites (`resolveTierByPriceId`, `createCheckoutSession`) read via `getStripePrices()` instead of the const. Production behavior is unchanged — env vars are still resolved at first call rather than at import. Tests can now set `process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_test_pro_m'` in `beforeEach()` and have the resolver pick it up. This also avoids the project's known `vi.resetModules()` brittleness with the `@/*` alias.

### 6.6 Tests

`tests/integration/billing-tier-cache.test.ts` — uses the now-exported `getUserTier` (per §6.5). One test per webhook event type:

| # | Event | Assertion |
|---|---|---|
| 1 | `checkout.session.completed` | After `handleWebhookEvent`, the next `getUserTier(userId)` call triggers `db.select` (cache cleared) |
| 2 | `customer.subscription.updated` | Same |
| 3 | `customer.subscription.deleted` | Same |
| 4 | `invoice.payment_succeeded` | Same |
| 5 | `invoice.payment_failed` | Same |

Spy mechanism: same `vi.mock('@/lib/db', …)` pattern as PR-A (the `db` lazy Proxy must not be touched directly). Prime the cache via one `getUserTier(userId)` call (which the mock satisfies with a fixture row), reset `(db.select as Mock).mockClear()`, replay the event, call `getUserTier(userId)` again, assert `db.select` was called. Reset cache between tests via `invalidateUserTierCache(userId)`.

`tests/unit/billing-tier-resolver.test.ts` — uses env stubs against the lazy `getStripePrices()` (per §6.5):

```ts
beforeEach(() => {
  process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_test_pro_m';
  process.env.STRIPE_PRICE_PRO_YEARLY = 'price_test_pro_y';
  process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY = 'price_test_ent_m';
  process.env.STRIPE_PRICE_ENTERPRISE_YEARLY = 'price_test_ent_y';
});

afterEach(() => {
  delete process.env.STRIPE_PRICE_PRO_MONTHLY; // etc.
});
```

| # | Assertion |
|---|---|
| 1 | `resolveTierByPriceId('price_test_pro_m')` === `'pro'` |
| 2 | `resolveTierByPriceId('price_test_pro_y')` === `'pro'` |
| 3 | `resolveTierByPriceId('price_test_ent_m')` === `'enterprise'` |
| 4 | `resolveTierByPriceId('price_test_ent_y')` === `'enterprise'` |
| 5 | `resolveTierByPriceId('price_unknown')` === `'free'` |
| 6 | `resolveTierByPriceId(null)` === `'free'` |
| 7 | Even with `process.env.STRIPE_PRICE_PLUS_MONTHLY = 'fake_plus_id'` set, `resolveTierByPriceId('fake_plus_id')` === `'free'` (resolver does not recognize plus tier) |

Test #7 is the load-bearing one — it pins the property "even if someone re-adds a `STRIPE_PRICE_PLUS_*` env var, the resolver does not honor it." If anyone later re-adds plus/ultra branches to the resolver, this test fails.

`tests/unit/billing-tier-normalize.test.ts`:

| # | Assertion |
|---|---|
| 1 | `normalizeBillingTier('plus')` === `'pro'` and emits warn log |
| 2 | `normalizeBillingTier('ultra')` === `'enterprise'` and emits warn log |
| 3 | `normalizeBillingTier('pro')` === `'pro'` (no log) |
| 4 | `normalizeBillingTier('free')` === `'free'` |
| 5 | `normalizeBillingTier(null)` === `'free'` |
| 6 | `normalizeBillingTier('garbage')` === `'free'` |

## 7. Sequencing & merge order

1. **PR-A merges first.** Independently urgent — webhook correctness benefits production immediately even though checkout isn't exposed yet.
2. **PR-B merges after PR-A is green.** Pre-launch hardening; blocks future checkout exposure.

PR-B does not depend on PR-A code paths but does share `lib/integrations/stripe/billing.ts`. Stacking PR-B on top of PR-A avoids merge conflicts.

## 8. Operational prerequisites

Before deploying PR-B to production:

1. Create four GCP Secret Manager entries (`stripe-price-pro-monthly`, `stripe-price-pro-yearly`, `stripe-price-enterprise-monthly`, `stripe-price-enterprise-yearly`) with the actual Stripe price IDs from the live Dashboard. **Verify each secret has a non-empty version** before deploying — an empty version would let the deploy succeed but throw at first checkout call. A missing secret aborts the deploy outright.
2. Run `SELECT COUNT(*) FROM users WHERE tier IN ('plus','ultra')` against production. Record the result in the PR description. If non-zero, the B-coercion in §6.3 is load-bearing — do not change it without a migration. If zero, file a follow-up ticket to drop the warning log and (eventually) shrink the Postgres enum.

## 9. PR checklist

### PR-A

- [ ] `MissingWebhookSecretError` extends `Error` with `instanceof` support
- [ ] Route handles missing header, signature error, syntax error, misconfig, handler error, success — six distinct paths
- [ ] `captureException` calls use `await` and pass extras as the second arg
- [ ] `handleWebhookEvent` uses insert-first claim with on-error rollback
- [ ] All 8 regression tests in §5.4 pass
- [ ] PR description documents the crash-window limitation in §5.3

### PR-B

- [ ] Production row count for `tier IN ('plus','ultra')` recorded in PR description
- [ ] All 4 GCP Secret Manager entries created with **non-empty** versions; verified via `gcloud secrets versions list` before merge
- [ ] `BillingTier` is `'free' | 'pro' | 'enterprise'` in `lib/billing/trial.ts`
- [ ] `lib/middleware/tier-gate.ts` and `lib/billing/tiers.ts` updated alongside `lib/integrations/stripe/billing.ts` and `lib/middleware/auth.ts`
- [ ] `normalizeBillingTier` called from inside `resolveBillingTrialState()` (Class A) and explicitly at every direct DB tier reader: `checkIfDowngrade`, `tier-gate.resolveUserTier` (Class B)
- [ ] PR description includes grep output of `users.tier` / `\.tier` references in `lib/billing/`, `lib/middleware/`, and `lib/integrations/stripe/` confirming every read site is covered
- [ ] All 5 webhook handlers (including `handleInvoicePaymentFailed`) call `invalidateUserTierCache`
- [ ] `handleCheckoutCompleted` normalizes `session.metadata?.tier` via `normalizeBillingTier` (or rejects unknown values) before writing to `users.tier` — closes the inbound-metadata write path so no new row picks up `plus`/`ultra`
- [ ] `normalizeBillingTier`, `resolveTierByPriceId`, and `getUserTier` exported as test seams (no production behavior change)
- [ ] `STRIPE_PRICES` const refactored into `getStripePrices()` lazy getter so env stubs work in tests
- [ ] `cloudbuild.production.yaml` substitutions and `--update-secrets` line updated
- [ ] All 18 tests across the three new test files pass

# Billing Correctness PR-B: Tier Cache Invalidation + Billing Config Gauntlet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Stripe-driven user write reflect in the in-memory tier cache within one request; narrow `BillingTier` to the three real tiers (`free | pro | enterprise`); coerce legacy `plus`/`ultra` rows safely at every read AND inbound-metadata write boundary; wire the four surviving `STRIPE_PRICE_*` env vars in production config.

**Architecture:** `normalizeBillingTier` helper added to `lib/billing/trial.ts` and called from inside `resolveBillingTrialState` (Class A — fixes 3 readers in one move). `checkIfDowngrade` gets an explicit normalize call (Class B). `BillingTier` narrowed in both definition sites (`lib/billing/trial.ts` and `lib/middleware/tier-gate.ts`). `STRIPE_PRICES` const refactored into `getStripePrices()` lazy getter so env stubs work in tests. Tier cache invalidation calls added to all 5 webhook handlers via Drizzle `.returning({ id })`. `handleCheckoutCompleted` validates inbound `session.metadata.tier` before write. `cloudbuild.production.yaml:166` wires 4 price-ID secrets.

**Tech Stack:** Next.js 14, TypeScript, Drizzle ORM (`postgres-js`), Vitest, GCP Cloud Build + Secret Manager.

**Spec:** `docs/superpowers/specs/2026-04-25-billing-correctness-design.md` §6, §8

**Prerequisite:** PR-A merged. PR-B refactors `lib/integrations/stripe/billing.ts` extensively; rebasing on top of PR-A avoids merge conflicts.

---

## Task 1: `normalizeBillingTier` helper + unit tests

**Files:**
- Modify: `app/src/lib/billing/trial.ts`
- Create: `app/tests/unit/billing/normalize-tier.test.ts`

The helper coerces unknown tier strings: `plus` → `pro`, `ultra` → `enterprise` (B-coercion preserves entitlements during transition); anything else falls to `free` with a warn log. Pure and side-effect-free apart from the log.

- [ ] **Step 1: Create the failing test file**

```ts
// app/tests/unit/billing/normalize-tier.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.fn();
vi.mock('@/lib/logger', () => ({
  logger: { warn, error: vi.fn(), info: vi.fn(), child: () => ({ warn, error: vi.fn(), info: vi.fn() }) },
}));

beforeEach(() => { warn.mockClear(); });

import { normalizeBillingTier } from '@/lib/billing/trial';

describe('normalizeBillingTier', () => {
  it('coerces plus → pro and emits warn log', () => {
    expect(normalizeBillingTier('plus', { userId: 'u1' })).toBe('pro');
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('coerces ultra → enterprise and emits warn log', () => {
    expect(normalizeBillingTier('ultra', { userId: 'u1' })).toBe('enterprise');
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('passes through pro unchanged with no log', () => {
    expect(normalizeBillingTier('pro')).toBe('pro');
    expect(warn).not.toHaveBeenCalled();
  });
  it('passes through enterprise unchanged with no log', () => {
    expect(normalizeBillingTier('enterprise')).toBe('enterprise');
  });
  it('passes through free unchanged with no log', () => {
    expect(normalizeBillingTier('free')).toBe('free');
  });
  it('returns free for null', () => {
    expect(normalizeBillingTier(null)).toBe('free');
  });
  it('returns free for unknown garbage', () => {
    expect(normalizeBillingTier('admin')).toBe('free');
    expect(normalizeBillingTier('')).toBe('free');
    expect(normalizeBillingTier(undefined)).toBe('free');
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `cd app && npx vitest run tests/unit/billing/normalize-tier.test.ts`
Expected: FAIL — `normalizeBillingTier` not exported.

- [ ] **Step 3: Add the helper to `lib/billing/trial.ts`**

Append to `app/src/lib/billing/trial.ts` (after the `resolveBillingTrialState` function):

```ts
import { logger } from '@/lib/logger';

export function normalizeBillingTier(
  raw: string | null | undefined,
  ctx?: { userId?: string },
): BillingTier {
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

(`BillingTier` is still the wide 5-value union at this point — Task 4 narrows it. The helper's return type doesn't change when the union narrows; the runtime behavior is what matters here.)

- [ ] **Step 4: Run the test, confirm it passes**

Run: `cd app && npx vitest run tests/unit/billing/normalize-tier.test.ts`
Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/billing/trial.ts app/tests/unit/billing/normalize-tier.test.ts
git commit -m "feat(billing): add normalizeBillingTier helper for legacy plus/ultra coercion"
```

---

## Task 2: Centralize coercion inside `resolveBillingTrialState` (Class A)

**Files:**
- Modify: `app/src/lib/billing/trial.ts:25-26`

Replace the cast `(input.tier || 'free') as BillingTier` with a `normalizeBillingTier` call so all three Class A readers (`getUserTier`, `getBillingInfo`, `tier-gate.resolveUserTier`) get safe coercion automatically.

- [ ] **Step 1: Write the failing test**

Append to `app/tests/unit/billing/normalize-tier.test.ts`:

```ts
import { resolveBillingTrialState } from '@/lib/billing/trial';

describe('resolveBillingTrialState (post-normalize)', () => {
  it('coerces legacy plus to pro effective tier', () => {
    const r = resolveBillingTrialState({ tier: 'plus' as any, subscriptionStatus: 'active' });
    expect(r.tier).toBe('pro');
    expect(r.effectiveTier).toBe('pro');
  });
  it('coerces legacy ultra to enterprise effective tier', () => {
    const r = resolveBillingTrialState({ tier: 'ultra' as any, subscriptionStatus: 'active' });
    expect(r.tier).toBe('enterprise');
    expect(r.effectiveTier).toBe('enterprise');
  });
  it('garbage tier falls to free', () => {
    const r = resolveBillingTrialState({ tier: 'admin' as any, subscriptionStatus: 'active' });
    expect(r.tier).toBe('free');
    expect(r.effectiveTier).toBe('free');
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `cd app && npx vitest run tests/unit/billing/normalize-tier.test.ts -t "post-normalize"`
Expected: FAIL — current code casts `'plus'` as-is.

- [ ] **Step 3: Apply the change**

In `app/src/lib/billing/trial.ts`, replace line 26:

```ts
// before
const tier = (input.tier || 'free') as BillingTier;
// after
const tier = normalizeBillingTier(input.tier);
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `cd app && npx vitest run tests/unit/billing/normalize-tier.test.ts -t "post-normalize"`
Expected: PASS.

- [ ] **Step 5: Run the wider test suite to catch any consumer surprises**

Run: `cd app && npx vitest run tests/unit/billing/`
Expected: existing trial tests still pass.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/billing/trial.ts app/tests/unit/billing/normalize-tier.test.ts
git commit -m "fix(billing): normalize legacy tier inside resolveBillingTrialState (Class A coverage)"
```

---

## Task 3: Class B explicit normalize at `checkIfDowngrade`

**Files:**
- Modify: `app/src/lib/integrations/stripe/billing.ts:140-143`

`checkIfDowngrade` reads `users.tier` and indexes `TIER_RANK` directly, bypassing `resolveBillingTrialState`. It needs an explicit `normalizeBillingTier` call.

- [ ] **Step 1: Run the audit grep first and record the result**

Run:
```bash
cd /home/godja/Dev/EU-Funds && grep -rn "users\.tier\|\.tier\b" app/src/lib/billing/ app/src/lib/middleware/ app/src/lib/integrations/stripe/ | grep -v test | grep -v ".d.ts"
```

Confirm three categories of hit:
- Reads via `resolveBillingTrialState(...)` → covered by Task 2
- Reads via `normalizeBillingTier(...)` → none yet (about to add one in this task)
- Direct casts to `BillingTier` outside the trial path → these are the Class B sites

The known Class B site is `app/src/lib/integrations/stripe/billing.ts:141`. If the grep surfaces additional sites, add them to the PR description and treat each with an explicit `normalizeBillingTier` call following the same pattern.

- [ ] **Step 2: Apply the change at line 140-143**

In `app/src/lib/integrations/stripe/billing.ts`, replace lines 140-142 (inside `checkIfDowngrade`):

```ts
// before
const row = await db.select({ tier: users.tier }).from(users).where(condition).limit(1);
const currentTier = (row[0]?.tier || 'free') as BillingTier;
return TIER_RANK[newTier] < TIER_RANK[currentTier];

// after
import { normalizeBillingTier } from '@/lib/billing/trial';  // add to existing imports at top of file
// ...
const row = await db.select({ tier: users.tier }).from(users).where(condition).limit(1);
const currentTier = normalizeBillingTier(row[0]?.tier, { userId: userId ?? undefined });
return TIER_RANK[newTier] < TIER_RANK[currentTier];
```

- [ ] **Step 3: Run typecheck**

Run: `cd app && npm run typecheck`
Expected: zero errors. (`BillingTier` still has 5 values at this point; the `as BillingTier` removal is safe because `normalizeBillingTier` returns a typed `BillingTier`.)

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/integrations/stripe/billing.ts
git commit -m "fix(billing): explicit normalizeBillingTier at checkIfDowngrade (Class B coverage)"
```

---

## Task 4: Narrow `BillingTier` union (both definition sites)

**Files:**
- Modify: `app/src/lib/billing/trial.ts:1`
- Modify: `app/src/lib/middleware/tier-gate.ts:4-12`

Drop `'plus'` and `'ultra'` from `BillingTier`. TypeScript will flag every consumer that still uses them.

- [ ] **Step 1: Narrow the type in `lib/billing/trial.ts:1`**

Replace line 1:

```ts
// before
export type BillingTier = 'free' | 'plus' | 'pro' | 'enterprise' | 'ultra';
// after
export type BillingTier = 'free' | 'pro' | 'enterprise';
```

- [ ] **Step 2: Narrow the duplicate definition in `lib/middleware/tier-gate.ts:4` and update `BILLING_TIER_ORDER`**

Replace lines 4-12:

```ts
// before
export type BillingTier = 'free' | 'plus' | 'pro' | 'enterprise' | 'ultra';

const BILLING_TIER_ORDER: Record<BillingTier, number> = {
  free: 0,
  plus: 1,
  pro: 2,
  enterprise: 3,
  ultra: 4,
};

// after
export type BillingTier = 'free' | 'pro' | 'enterprise';

const BILLING_TIER_ORDER: Record<BillingTier, number> = {
  free: 0,
  pro: 1,
  enterprise: 2,
};
```

- [ ] **Step 3: Run typecheck and capture all consumer errors**

Run: `cd app && npm run typecheck 2>&1 | tee /tmp/tier-narrow-errors.txt`
Expected: errors at consumer sites that still reference `plus` / `ultra`.

The known sites (per spec §6.2) and what to do at each:

| File | Fix |
|---|---|
| `app/src/lib/integrations/stripe/billing.ts:66-83` (STRIPE_PRICES) | drop plus + ultra entries (Task 5 will refactor to a function) |
| `app/src/lib/integrations/stripe/billing.ts:85-91` (API_CALL_LIMITS) | drop plus + ultra entries |
| `app/src/lib/middleware/auth.ts:59-65` (RATE_LIMITS) | drop plus + ultra entries |
| `app/src/lib/billing/tiers.ts:13-58` (TIER_LIMITS) | drop plus + ultra entries (note: `enterprise` is missing from this map — pre-existing gap, do not add it; out of scope) |

- [ ] **Step 4: Apply each fix**

In `app/src/lib/integrations/stripe/billing.ts`, replace the `STRIPE_PRICES` const (lines 66-83) — this stays as a const for now; Task 5 refactors it into a function:

```ts
const STRIPE_PRICES: Record<Exclude<BillingTier, 'free'>, Record<BillingInterval, string | undefined>> = {
  pro: {
    monthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
    yearly: process.env.STRIPE_PRICE_PRO_YEARLY,
  },
  enterprise: {
    monthly: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY,
    yearly: process.env.STRIPE_PRICE_ENTERPRISE_YEARLY,
  },
};
```

Replace `API_CALL_LIMITS` (lines 85-91) with:

```ts
const API_CALL_LIMITS: Record<BillingTier, number> = {
  free: 1000,
  pro: 25000,
  enterprise: 200000,
};
```

In `app/src/lib/middleware/auth.ts`, replace `RATE_LIMITS` (lines 59-65) with:

```ts
const RATE_LIMITS: Record<UserTier, number> = {
  free: 10,
  pro: 100,
  enterprise: 1000,
};
```

In `app/src/lib/billing/tiers.ts`, drop the `plus` entry (lines 25-35) and the `ultra` entry (lines 47-57) from `TIER_LIMITS`. The remaining map should have only `free` and `pro`. Add a comment noting that `enterprise` is intentionally absent here (callers fall back to `free` via `TIER_LIMITS.free` at line 61) — that's a pre-existing gap tracked separately, not in scope for this PR.

- [ ] **Step 5: Re-run typecheck**

Run: `cd app && npm run typecheck`
Expected: zero errors. If new errors surface (e.g., a site this plan didn't list), audit it: was the consumer using `plus`/`ultra` and needs updating, or is it a generic typing issue?

- [ ] **Step 6: Run the test suite**

Run: `cd app && npm run test`
Expected: tests still green. (Some tier-related tests may need their fixtures narrowed; if any fail, update the fixtures to use `free` / `pro` / `enterprise` only.)

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/billing/trial.ts app/src/lib/middleware/tier-gate.ts \
        app/src/lib/integrations/stripe/billing.ts app/src/lib/middleware/auth.ts \
        app/src/lib/billing/tiers.ts
git commit -m "refactor(billing): narrow BillingTier to free|pro|enterprise across the TS surface"
```

---

## Task 5: Refactor `STRIPE_PRICES` const into `getStripePrices()` lazy getter

**Files:**
- Modify: `app/src/lib/integrations/stripe/billing.ts` (`STRIPE_PRICES` const + 2 call sites)

The const is module-load-evaluated; tests can't stub `process.env.STRIPE_PRICE_*` after import. Replace with a function so env values are resolved at first call.

- [ ] **Step 1: Replace the const with a function**

In `app/src/lib/integrations/stripe/billing.ts`, replace the (now-narrowed) `STRIPE_PRICES` block:

```ts
// before
const STRIPE_PRICES: Record<Exclude<BillingTier, 'free'>, Record<BillingInterval, string | undefined>> = {
  pro: {
    monthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
    yearly: process.env.STRIPE_PRICE_PRO_YEARLY,
  },
  enterprise: {
    monthly: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY,
    yearly: process.env.STRIPE_PRICE_ENTERPRISE_YEARLY,
  },
};

// after
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

- [ ] **Step 2: Update `resolveTierByPriceId` (lines 119-128)**

```ts
// before — uses STRIPE_PRICES
function resolveTierByPriceId(priceId: string | null | undefined): BillingTier {
  if (!priceId) return 'free';
  const proPriceIds = [STRIPE_PRICES.pro.monthly, STRIPE_PRICES.pro.yearly].filter(Boolean);
  const enterprisePriceIds = [STRIPE_PRICES.enterprise.monthly, STRIPE_PRICES.enterprise.yearly].filter(Boolean);
  if (proPriceIds.includes(priceId)) return 'pro';
  if (enterprisePriceIds.includes(priceId)) return 'enterprise';
  return 'free';
}

// after — uses getStripePrices() and is exported as a test seam
export function resolveTierByPriceId(priceId: string | null | undefined): BillingTier {
  if (!priceId) return 'free';
  const prices = getStripePrices();
  const proPriceIds = [prices.pro.monthly, prices.pro.yearly].filter(Boolean);
  const enterprisePriceIds = [prices.enterprise.monthly, prices.enterprise.yearly].filter(Boolean);
  if (proPriceIds.includes(priceId)) return 'pro';
  if (enterprisePriceIds.includes(priceId)) return 'enterprise';
  return 'free';
}
```

- [ ] **Step 3: Update `createCheckoutSession` price lookup (line 182)**

In `createCheckoutSession`, replace:

```ts
// before
const selectedPrice = STRIPE_PRICES[tier][interval];
// after
const selectedPrice = getStripePrices()[tier][interval];
```

- [ ] **Step 4: Run typecheck**

Run: `cd app && npm run typecheck`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/integrations/stripe/billing.ts
git commit -m "refactor(billing): STRIPE_PRICES const → getStripePrices() lazy getter; export resolveTierByPriceId as test seam"
```

---

## Task 6: Resolver tests with env stubs

**Files:**
- Create: `app/tests/unit/billing/resolve-tier-by-price.test.ts`

Verify the resolver maps the four wired prices correctly, returns `free` for unknowns, and (test #7) does NOT honor a `STRIPE_PRICE_PLUS_*` env var even if one is set — pinning the contract that plus/ultra are removed.

- [ ] **Step 1: Write the test file**

```ts
// app/tests/unit/billing/resolve-tier-by-price.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveTierByPriceId } from '@/lib/integrations/stripe/billing';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_test_pro_m';
  process.env.STRIPE_PRICE_PRO_YEARLY = 'price_test_pro_y';
  process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY = 'price_test_ent_m';
  process.env.STRIPE_PRICE_ENTERPRISE_YEARLY = 'price_test_ent_y';
});

afterEach(() => {
  for (const key of [
    'STRIPE_PRICE_PRO_MONTHLY', 'STRIPE_PRICE_PRO_YEARLY',
    'STRIPE_PRICE_ENTERPRISE_MONTHLY', 'STRIPE_PRICE_ENTERPRISE_YEARLY',
    'STRIPE_PRICE_PLUS_MONTHLY', 'STRIPE_PRICE_ULTRA_MONTHLY',
  ]) {
    if (key in ORIGINAL_ENV) process.env[key] = ORIGINAL_ENV[key];
    else delete process.env[key];
  }
});

describe('resolveTierByPriceId', () => {
  it('pro monthly → pro', () => {
    expect(resolveTierByPriceId('price_test_pro_m')).toBe('pro');
  });
  it('pro yearly → pro', () => {
    expect(resolveTierByPriceId('price_test_pro_y')).toBe('pro');
  });
  it('enterprise monthly → enterprise', () => {
    expect(resolveTierByPriceId('price_test_ent_m')).toBe('enterprise');
  });
  it('enterprise yearly → enterprise', () => {
    expect(resolveTierByPriceId('price_test_ent_y')).toBe('enterprise');
  });
  it('unknown price → free', () => {
    expect(resolveTierByPriceId('price_unknown')).toBe('free');
  });
  it('null → free', () => {
    expect(resolveTierByPriceId(null)).toBe('free');
  });
  it('STRIPE_PRICE_PLUS_MONTHLY set → still resolves to free (plus tier removed)', () => {
    process.env.STRIPE_PRICE_PLUS_MONTHLY = 'fake_plus_id';
    expect(resolveTierByPriceId('fake_plus_id')).toBe('free');
  });
});
```

- [ ] **Step 2: Run the test, confirm 7 PASS**

Run: `cd app && npx vitest run tests/unit/billing/resolve-tier-by-price.test.ts`
Expected: 7 PASS.

- [ ] **Step 3: Commit**

```bash
git add app/tests/unit/billing/resolve-tier-by-price.test.ts
git commit -m "test(billing): pin resolveTierByPriceId contract incl. plus/ultra removal"
```

---

## Task 7: Export `getUserTier` as test seam

**Files:**
- Modify: `app/src/lib/middleware/auth.ts:24`

Tests in Task 8 need to call `getUserTier` directly to verify cache invalidation. Today it's a private module function. Add `export`.

- [ ] **Step 1: Apply the change**

In `app/src/lib/middleware/auth.ts:24`:

```ts
// before
async function getUserTier(userId: string): Promise<UserTier> {
// after
export async function getUserTier(userId: string): Promise<UserTier> {
```

- [ ] **Step 2: Run typecheck**

Run: `cd app && npm run typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/middleware/auth.ts
git commit -m "refactor(auth): export getUserTier as test seam (no behavior change)"
```

---

## Task 8: Tier cache invalidation across all 5 webhook handlers

**Files:**
- Modify: `app/src/lib/integrations/stripe/billing.ts:247-351`
- Create: `app/tests/integration/billing-tier-cache.test.ts`

Each Stripe webhook handler that writes `users` rows must invalidate the in-memory tier cache for affected userIds. Use Drizzle `.returning({ id })` to avoid an extra round trip.

- [ ] **Step 1: Write the failing tests**

```ts
// app/tests/integration/billing-tier-cache.test.ts
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type Stripe from 'stripe';

// Mock the db module — chainable Drizzle-style
function makeChainable() {
  const chain: any = {
    insert: vi.fn(() => chain),
    values: vi.fn(() => chain),
    onConflictDoNothing: vi.fn(() => chain),
    returning: vi.fn(),
    update: vi.fn(() => chain),
    set: vi.fn(() => chain),
    where: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    select: vi.fn(() => chain),
    from: vi.fn(() => chain),
    limit: vi.fn(),
    query: { stripeWebhookEvents: { findFirst: vi.fn() } },
  };
  return chain;
}
const dbMock = makeChainable();

vi.mock('@/lib/db', () => ({ db: dbMock }));

const invalidateUserTierCache = vi.fn();
vi.mock('@/lib/middleware/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/middleware/auth')>('@/lib/middleware/auth');
  return { ...actual, invalidateUserTierCache };
});

import { handleWebhookEvent } from '@/lib/integrations/stripe/billing';

beforeEach(() => {
  vi.clearAllMocks();
  // Idempotency claim succeeds
  dbMock.returning
    .mockResolvedValueOnce([{ id: 'webhook-event-row-1' }])  // first call: claim insert
    .mockResolvedValueOnce([{ id: 'user-1' }]);              // second call: update returning userId
});
afterEach(() => { vi.resetAllMocks(); });

function makeSubscriptionEvent(type: string): Stripe.Event {
  return {
    id: `evt_${Date.now()}`,
    type,
    data: { object: {
      id: 'sub_test',
      customer: 'cus_test',
      metadata: { userId: 'user-1' },
      items: { data: [{ price: { id: 'price_test_pro_m' } }] },
      status: 'active',
      current_period_end: Math.floor(Date.now() / 1000) + 3600,
    } },
  } as any;
}
function makeInvoiceEvent(type: string): Stripe.Event {
  return {
    id: `evt_${Date.now()}`,
    type,
    data: { object: { id: 'in_test', customer: 'cus_test' } },
  } as any;
}
function makeCheckoutEvent(): Stripe.Event {
  return {
    id: `evt_${Date.now()}`,
    type: 'checkout.session.completed',
    data: { object: {
      id: 'cs_test',
      customer: 'cus_test',
      subscription: 'sub_test',
      metadata: { userId: 'user-1', tier: 'pro' },
      client_reference_id: 'user-1',
    } },
  } as any;
}

describe('webhook handlers invalidate tier cache', () => {
  it('checkout.session.completed', async () => {
    await handleWebhookEvent(makeCheckoutEvent());
    expect(invalidateUserTierCache).toHaveBeenCalledWith('user-1');
  });
  it('customer.subscription.updated', async () => {
    await handleWebhookEvent(makeSubscriptionEvent('customer.subscription.updated'));
    expect(invalidateUserTierCache).toHaveBeenCalledWith('user-1');
  });
  it('customer.subscription.deleted', async () => {
    await handleWebhookEvent(makeSubscriptionEvent('customer.subscription.deleted'));
    expect(invalidateUserTierCache).toHaveBeenCalledWith('user-1');
  });
  it('invoice.payment_succeeded', async () => {
    await handleWebhookEvent(makeInvoiceEvent('invoice.payment_succeeded'));
    expect(invalidateUserTierCache).toHaveBeenCalledWith('user-1');
  });
  it('invoice.payment_failed', async () => {
    await handleWebhookEvent(makeInvoiceEvent('invoice.payment_failed'));
    expect(invalidateUserTierCache).toHaveBeenCalledWith('user-1');
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `cd app && npx vitest run tests/integration/billing-tier-cache.test.ts`
Expected: all 5 FAIL — `invalidateUserTierCache` not called from any handler yet.

- [ ] **Step 3: Apply the handler updates in `lib/integrations/stripe/billing.ts`**

Add to existing imports at the top of the file:

```ts
import { invalidateUserTierCache } from '@/lib/middleware/auth';
```

Replace `handleCheckoutCompleted` (lines 247-267) with:

```ts
async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.userId || session.client_reference_id;
  const rawTierFromMetadata = session.metadata?.tier;
  if (rawTierFromMetadata && rawTierFromMetadata !== 'free' && rawTierFromMetadata !== 'pro' && rawTierFromMetadata !== 'enterprise') {
    log.warn({ rawTierFromMetadata, sessionId: session.id, userId }, '[stripe-webhook] unexpected tier in checkout metadata');
  }
  const tier = normalizeBillingTier(rawTierFromMetadata, { userId: userId ?? undefined });
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
  const customerId = typeof session.customer === 'string' ? session.customer : null;

  if (!userId) return;

  await db
    .update(users)
    .set({
      tier,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      subscriptionStatus: 'active',
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  invalidateUserTierCache(userId);
}
```

(Note: the imports for `normalizeBillingTier` and `log` should already be present from earlier tasks. If `log` is not yet defined in this file, add: `const log = logger.child({ component: 'stripe-billing' });` near the top imports.)

Replace `handleSubscriptionUpdated` (lines 269-299) with:

```ts
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

Replace `handleSubscriptionDeleted` (lines 301-324) with:

```ts
async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : null;
  const userIdFromMetadata = subscription.metadata?.userId;
  const periodEndUnix = (subscription as { current_period_end?: number }).current_period_end;
  const updateValues = {
    tier: 'free' as const,
    stripeSubscriptionId: null,
    subscriptionStatus: 'canceled' as const,
    subscriptionPeriodEnd: periodEndUnix ? new Date(periodEndUnix * 1000) : null,
    updatedAt: new Date(),
  };

  const updated = userIdFromMetadata
    ? await db.update(users).set(updateValues).where(eq(users.id, userIdFromMetadata)).returning({ id: users.id })
    : customerId
      ? await db.update(users).set(updateValues).where(eq(users.stripeCustomerId, customerId)).returning({ id: users.id })
      : [];

  for (const row of updated) invalidateUserTierCache(row.id);
}
```

Replace `handleInvoicePaymentSucceeded` (lines 326-338) with:

```ts
async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : null;
  if (!customerId) return;

  const updated = await db
    .update(users)
    .set({
      apiCallsThisMonth: 0,
      subscriptionStatus: 'active',
      updatedAt: new Date(),
    })
    .where(eq(users.stripeCustomerId, customerId))
    .returning({ id: users.id });

  for (const row of updated) invalidateUserTierCache(row.id);
}
```

Replace `handleInvoicePaymentFailed` (lines 340-351) with:

```ts
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : null;
  if (!customerId) return;

  const updated = await db
    .update(users)
    .set({
      subscriptionStatus: 'past_due',
      updatedAt: new Date(),
    })
    .where(eq(users.stripeCustomerId, customerId))
    .returning({ id: users.id });

  for (const row of updated) invalidateUserTierCache(row.id);
}
```

- [ ] **Step 4: Update the test mock setup so `.returning({ id })` returns sensible rows**

Tests in Step 1 already prime `dbMock.returning` with two entries: claim insert + handler's update returning. For the invoice tests (which only have customerId), the handler does an `update().where().returning()` — the second `returning` mock value `[{ id: 'user-1' }]` covers that.

Run: `cd app && npx vitest run tests/integration/billing-tier-cache.test.ts`
Expected: all 5 PASS.

(If a specific test fails because `.returning()` returned `undefined`: prime the mock with more `mockResolvedValueOnce(...)` entries — one per `returning()` call in the handler.)

- [ ] **Step 5: Run typecheck**

Run: `cd app && npm run typecheck`
Expected: zero errors.

- [ ] **Step 6: Run the PR-A webhook tests to confirm no regression**

Run: `cd app && npx vitest run tests/integration/stripe-webhooks.test.ts`
Expected: all 8 PASS (the idempotency claim mock now competes with the cache-invalidation mock — verify both test files run cleanly side by side).

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/integrations/stripe/billing.ts app/tests/integration/billing-tier-cache.test.ts
git commit -m "fix(billing): invalidate tier cache after every Stripe-driven user write; normalize inbound checkout metadata"
```

---

## Task 9: Wire price IDs in `cloudbuild.production.yaml`

**Files:**
- Modify: `cloudbuild.production.yaml` (substitutions block + `--update-secrets` line 166)

The four `STRIPE_PRICE_*` env vars must be wired before the next production deploy that exposes checkout. Failure modes are split: missing secret aborts the deploy; empty version deploys cleanly but throws at first checkout attempt.

- [ ] **Step 1: Add four substitution defaults**

Open `cloudbuild.production.yaml` and find the `substitutions:` block near the top (around lines 25-27 where existing Stripe substitutions live). Add four new lines:

```yaml
  _STRIPE_PRICE_PRO_MONTHLY_SECRET_NAME: stripe-price-pro-monthly
  _STRIPE_PRICE_PRO_YEARLY_SECRET_NAME: stripe-price-pro-yearly
  _STRIPE_PRICE_ENTERPRISE_MONTHLY_SECRET_NAME: stripe-price-enterprise-monthly
  _STRIPE_PRICE_ENTERPRISE_YEARLY_SECRET_NAME: stripe-price-enterprise-yearly
```

- [ ] **Step 2: Append four entries to the `--update-secrets` line**

Find line 166 — it is a single long `--update-secrets "..."` argument with comma-separated `ENV_VAR=secret-name:version` pairs. Append:

```
,STRIPE_PRICE_PRO_MONTHLY=${_STRIPE_PRICE_PRO_MONTHLY_SECRET_NAME}:latest,STRIPE_PRICE_PRO_YEARLY=${_STRIPE_PRICE_PRO_YEARLY_SECRET_NAME}:latest,STRIPE_PRICE_ENTERPRISE_MONTHLY=${_STRIPE_PRICE_ENTERPRISE_MONTHLY_SECRET_NAME}:latest,STRIPE_PRICE_ENTERPRISE_YEARLY=${_STRIPE_PRICE_ENTERPRISE_YEARLY_SECRET_NAME}:latest
```

(Append inside the closing quote, before the `"`.)

- [ ] **Step 3: Validate the YAML parses**

Run: `cd /home/godja/Dev/EU-Funds && python3 -c "import yaml; yaml.safe_load(open('cloudbuild.production.yaml'))" && echo OK`
Expected: `OK`. If the YAML is malformed (e.g., quoting issue from the long line), fix before continuing.

- [ ] **Step 4: Commit**

```bash
git add cloudbuild.production.yaml
git commit -m "chore(infra): wire 4 STRIPE_PRICE_* secrets in production cloudbuild"
```

---

## Task 10: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `cd app && npm run test`
Expected: all tests pass.

- [ ] **Step 2: Run typecheck and lint**

Run: `cd app && npm run typecheck && npm run lint`
Expected: zero errors.

- [ ] **Step 3: Run the audit grep one more time and capture for the PR description**

Run:
```bash
grep -rn "users\.tier\|\.tier\b" /home/godja/Dev/EU-Funds/app/src/lib/billing/ /home/godja/Dev/EU-Funds/app/src/lib/middleware/ /home/godja/Dev/EU-Funds/app/src/lib/integrations/stripe/ | grep -v test | grep -v ".d.ts"
```

Confirm every hit is one of:
- inside `resolveBillingTrialState` (Task 2 covers it)
- a `normalizeBillingTier(...)` call (Task 3, Task 8)
- a `tier:` field in an UPDATE SET clause (write side, covered by `handleCheckoutCompleted` metadata normalization)

Paste the grep output into the PR description.

- [ ] **Step 4: Operational prerequisites — checklist for PR description**

Paste this into the PR body and ensure each item is checked before merge:

```markdown
## Operational prereqs (must be done before merging)
- [ ] Production row count: run `SELECT COUNT(*) FROM users WHERE tier IN ('plus','ultra');` against prod and record result here: __
  - If 0: file a follow-up ticket to drop the warn log and shrink the Postgres enum.
  - If non-zero: B-coercion is load-bearing; do NOT merge a change that switches plus → free or ultra → free.
- [ ] All 4 GCP Secret Manager entries created with **non-empty versions**:
  - [ ] `gcloud secrets versions list stripe-price-pro-monthly --limit 1` shows ENABLED
  - [ ] `gcloud secrets versions list stripe-price-pro-yearly --limit 1` shows ENABLED
  - [ ] `gcloud secrets versions list stripe-price-enterprise-monthly --limit 1` shows ENABLED
  - [ ] `gcloud secrets versions list stripe-price-enterprise-yearly --limit 1` shows ENABLED
- [ ] Each secret value verified to match the corresponding price ID in the live Stripe Dashboard
```

- [ ] **Step 5: PR description (paste into PR body)**

```markdown
## Summary
Tier cache correctness + plus/ultra TS removal + price-ID wiring. Pre-checkout-exposure hardening.

- All 5 Stripe webhook handlers now `invalidateUserTierCache(userId)` after writing. Drizzle `.returning({ id })` keeps it to one round trip.
- `handleCheckoutCompleted` normalizes `session.metadata.tier` via `normalizeBillingTier` before writing — closes the inbound write path so a stale Stripe session can't seed `'plus'`/`'ultra'` after the TS narrowing.
- `BillingTier` narrowed from 5 to 3 values (`free | pro | enterprise`) across both definition sites and all consumers.
- `normalizeBillingTier` centralized inside `resolveBillingTrialState` (Class A coverage: `getUserTier`, `getBillingInfo`, `tier-gate.resolveUserTier`); explicit call at `checkIfDowngrade` (Class B).
- `STRIPE_PRICES` const refactored into `getStripePrices()` lazy getter for testability.
- 4 `STRIPE_PRICE_*` secrets wired in `cloudbuild.production.yaml`.

## Audit grep
[paste output from Task 10 Step 3]

## Test plan
- [x] `tests/unit/billing/normalize-tier.test.ts` — 7 + 3 = 10 tests
- [x] `tests/unit/billing/resolve-tier-by-price.test.ts` — 7 tests including STRIPE_PRICE_PLUS_* fail-resolve test
- [x] `tests/integration/billing-tier-cache.test.ts` — 5 tests (one per webhook event type)
- [x] PR-A webhook tests still green (8 tests)
- [x] `npm run typecheck`, `npm run lint`, `npm run test` clean

## Spec
`docs/superpowers/specs/2026-04-25-billing-correctness-design.md` §6, §8

[insert operational prereq checklist from Task 10 Step 4 here]
```

- [ ] **Step 6: Push and open PR**

```bash
git push -u origin HEAD
gh pr create --title "fix(billing): tier cache invalidation + plus/ultra removal + price-ID wiring" --body-file <(cat <<'EOF'
[paste PR description from Step 5]
EOF
)
```

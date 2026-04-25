# Billing Correctness PR-A: Stripe Webhook Correctness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Stripe webhook handler correct under handler errors and concurrent identical deliveries: 3-class error classification (signature/payload 400 vs misconfig/handler 500 + Sentry), insert-first idempotency claim with on-error rollback so retries can re-attempt.

**Architecture:** Two files change. `lib/integrations/stripe/billing.ts` introduces `MissingWebhookSecretError`, flips `handleWebhookEvent` to insert-first idempotency with `try/catch`-rollback. `app/api/webhooks/stripe/route.ts` distinguishes signature/payload errors (400, no Sentry) from misconfig/handler errors (500 + `captureException`).

**Tech Stack:** Next.js 14 App Router, TypeScript, `stripe@18.x`, Drizzle ORM, Vitest, `@/lib/monitoring/sentry` (async wrapper).

**Spec:** `docs/superpowers/specs/2026-04-25-billing-correctness-design.md` §5

---

## Task 1: Set up test file scaffolding with module mocks

**Files:**
- Create: `app/tests/integration/stripe-webhooks.test.ts`

The test file mocks `@/lib/db`, `@/lib/monitoring/sentry`, and `@/lib/logger` so we can assert on calls without touching real infrastructure. The `db` proxy is lazy — direct `vi.spyOn(db, …)` would initialize a real Postgres connection (per `CLAUDE.md`).

- [ ] **Step 1: Create the test file scaffolding**

All `import` statements in this test file go at the top. Later tasks add `describe` blocks at the bottom and add new imports next to the existing ones — never interleaved with executable code.

`vi.resetAllMocks()` is intentionally **not** used in `afterEach` because it would reset the chainable `dbMock` implementations (the `() => chain` factories) to bare `vi.fn()`s, breaking subsequent tests. Use `vi.clearAllMocks()` only — it clears call history without touching implementations.

```ts
// app/tests/integration/stripe-webhooks.test.ts
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// Chainable Drizzle-style mock factory.
// IMPORTANT: this defines per-method implementations once at module load.
// Tests must NOT call vi.resetAllMocks() — that would replace the chain
// implementations with bare vi.fn()s and break the next test.
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
vi.mock('@/lib/monitoring/sentry', () => ({
  captureException: vi.fn().mockResolvedValue(undefined),
  initSentryIfConfigured: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }) },
}));

beforeEach(() => {
  vi.clearAllMocks();          // clears call history; preserves implementations
  // Default: idempotency claim succeeds (insert .returning() returns one row)
  dbMock.returning.mockResolvedValue([{ id: 'webhook-event-id-1' }]);
  // Default: SELECT().limit(1) for checkIfDowngrade reads
  dbMock.limit.mockResolvedValue([{ tier: 'pro' }]);
});

// Helper to build a StripeSignatureVerificationError that passes instanceof.
// stripe-node's actual constructor signature is awkward; setting the prototype
// directly is the most robust pattern.
import Stripe from 'stripe';
function makeSignatureError(message = 'No signatures found matching the expected signature for payload'): Stripe.errors.StripeSignatureVerificationError {
  const err = new Error(message);
  Object.setPrototypeOf(err, Stripe.errors.StripeSignatureVerificationError.prototype);
  return err as Stripe.errors.StripeSignatureVerificationError;
}

describe('stripe webhooks', () => {
  it.skip('placeholder', () => {});
});
```

- [ ] **Step 2: Run the test file once to confirm scaffolding works**

Run: `cd app && npx vitest run tests/integration/stripe-webhooks.test.ts`
Expected: 0 failures, 1 skipped.

- [ ] **Step 3: Commit scaffolding**

```bash
cd /home/godja/Dev/EU-Funds
git add app/tests/integration/stripe-webhooks.test.ts
git commit -m "test(stripe-webhooks): scaffold integration test file with db/sentry/logger mocks"
```

---

## Task 2: `MissingWebhookSecretError` typed error

**Files:**
- Modify: `app/src/lib/integrations/stripe/billing.ts:389-396`
- Test: `app/tests/integration/stripe-webhooks.test.ts`

Today `constructWebhookEvent` throws a generic `new Error('STRIPE_WEBHOOK_SECRET is required …')`. The route can't distinguish this from other errors. Replace with a typed class so the route can `instanceof`-check it.

- [ ] **Step 1: Write the failing test**

Add the import at the top of the file (next to the other `@/lib/...` imports):

```ts
import { MissingWebhookSecretError } from '@/lib/integrations/stripe/billing';
```

Replace the `it.skip('placeholder', …)` with this new top-level `describe`:

```ts
describe('MissingWebhookSecretError', () => {
  const original = process.env.STRIPE_WEBHOOK_SECRET;
  beforeEach(() => { delete process.env.STRIPE_WEBHOOK_SECRET; });
  afterEach(() => { if (original) process.env.STRIPE_WEBHOOK_SECRET = original; });

  it('constructWebhookEvent throws MissingWebhookSecretError when secret is unset', async () => {
    const { constructWebhookEvent } = await import('@/lib/integrations/stripe/billing');
    expect(() => constructWebhookEvent('payload', 'sig')).toThrow(MissingWebhookSecretError);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd app && npx vitest run tests/integration/stripe-webhooks.test.ts -t "MissingWebhookSecretError"`
Expected: FAIL with "MissingWebhookSecretError is not exported" or similar.

- [ ] **Step 3: Add the error class and update the throw site**

**Order matters here.** Check the webhook secret BEFORE calling `getStripeClient()` — otherwise a missing `STRIPE_SECRET_KEY` would throw a generic `Error` first and mask the more specific `MissingWebhookSecretError` classification.

In `app/src/lib/integrations/stripe/billing.ts`, replace lines 389-396 with:

```ts
export class MissingWebhookSecretError extends Error {
  constructor() {
    super('STRIPE_WEBHOOK_SECRET is required for Stripe webhook verification.');
    this.name = 'MissingWebhookSecretError';
  }
}

export function constructWebhookEvent(payload: string | Buffer, signature: string): Stripe.Event {
  // Webhook secret check runs first so a missing secret can't be masked
  // by a missing STRIPE_SECRET_KEY error from getStripeClient().
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new MissingWebhookSecretError();
  }
  const stripe = getStripeClient();
  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd app && npx vitest run tests/integration/stripe-webhooks.test.ts -t "MissingWebhookSecretError"`
Expected: PASS.

- [ ] **Step 5: Run typecheck to confirm no breakage elsewhere**

Run: `cd app && npm run typecheck`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/integrations/stripe/billing.ts app/tests/integration/stripe-webhooks.test.ts
git commit -m "feat(billing): typed MissingWebhookSecretError for webhook route to discriminate misconfig from handler errors"
```

---

## Task 3: Insert-first idempotency in `handleWebhookEvent`

**Files:**
- Modify: `app/src/lib/integrations/stripe/billing.ts:353-387`
- Test: `app/tests/integration/stripe-webhooks.test.ts`

Flip the order so the unique-constraint INSERT is the gate, not the prior SELECT. Two parallel deliveries of the same event both attempt to insert; only one row is created (`onConflictDoNothing` + `returning` shows zero rows for the loser); only the winner runs the handler.

- [ ] **Step 1: Write the failing test for concurrent deliveries**

Append to the test file:

```ts
import { handleWebhookEvent } from '@/lib/integrations/stripe/billing';
import { db } from '@/lib/db';

function makeStripeEvent(type: string, id = 'evt_test_1'): any {
  return {
    id,
    type,
    data: { object: { id: 'sub_test_1', customer: 'cus_test_1', metadata: {}, items: { data: [] }, status: 'active' } },
  };
}

describe('handleWebhookEvent idempotency', () => {
  it('concurrent identical deliveries → handler runs exactly once', async () => {
    // First insert wins (returns row); second loses (returns empty array)
    const returningMock = (db as any).returning as Mock;
    returningMock
      .mockResolvedValueOnce([{ id: 'claim-row-1' }])  // first delivery wins
      .mockResolvedValueOnce([]);                       // second delivery: conflict

    // Both handlers will try to update users; count update calls
    const updateMock = (db as any).update as Mock;

    const event = makeStripeEvent('customer.subscription.updated');
    await Promise.all([handleWebhookEvent(event), handleWebhookEvent(event)]);

    expect(updateMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd app && npx vitest run tests/integration/stripe-webhooks.test.ts -t "concurrent identical deliveries"`
Expected: FAIL — current code uses `findFirst` then `insert` so the count is 2 (or whatever the legacy behavior produces).

- [ ] **Step 3: Replace `handleWebhookEvent` with insert-first version**

In `app/src/lib/integrations/stripe/billing.ts`, replace lines 353-387 with:

```ts
export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  // Insert-first idempotency: the unique constraint on event_id is the gate.
  // Note: the dispatch handlers are short-lived DB writes, so the window
  // between claim INSERT and successful return is sub-millisecond. A hard
  // process death inside that window would leave the claim in place and
  // silently no-op subsequent retries; if observed, follow up with a claim
  // row that carries status / claimedAt / processedAt / lastError.
  const claimed = await db
    .insert(stripeWebhookEvents)
    .values({ eventId: event.id, eventType: event.type })
    .onConflictDoNothing()
    .returning({ id: stripeWebhookEvents.id });

  if (claimed.length === 0) return;

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
    // Release the claim so Stripe's retry can re-attempt.
    await db.delete(stripeWebhookEvents).where(eq(stripeWebhookEvents.eventId, event.id));
    throw err;
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd app && npx vitest run tests/integration/stripe-webhooks.test.ts -t "concurrent identical deliveries"`
Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run: `cd app && npm run typecheck`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/integrations/stripe/billing.ts app/tests/integration/stripe-webhooks.test.ts
git commit -m "fix(billing): insert-first idempotency for stripe webhook (closes TOCTOU race on concurrent deliveries)"
```

---

## Task 4: On-error rollback — handler throws release the claim

**Files:**
- Modify: already in place from Task 3 (the `try/catch` block)
- Test: `app/tests/integration/stripe-webhooks.test.ts`

Verify the rollback half of Task 3's change with a dedicated test: when a dispatched handler throws, the claim row is deleted so Stripe's retry can re-claim.

- [ ] **Step 1: Write the failing test**

Append to the `describe('handleWebhookEvent idempotency', …)` block:

```ts
it('handler throws → claim row deleted (so retry can re-claim)', async () => {
  const returningMock = (db as any).returning as Mock;
  returningMock.mockResolvedValueOnce([{ id: 'claim-row-1' }]);

  const updateMock = (db as any).update as Mock;
  // Handler dispatch eventually calls db.update; make it throw
  updateMock.mockImplementationOnce(() => { throw new Error('simulated db failure'); });

  const deleteMock = (db as any).delete as Mock;

  const event = makeStripeEvent('customer.subscription.updated');
  await expect(handleWebhookEvent(event)).rejects.toThrow('simulated db failure');

  expect(deleteMock).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test and confirm it passes**

Run: `cd app && npx vitest run tests/integration/stripe-webhooks.test.ts -t "claim row deleted"`
Expected: PASS — the rollback was added in Task 3 Step 3.

(If FAIL: the rollback in Task 3 was not implemented correctly. Fix the `try/catch` block before continuing.)

- [ ] **Step 3: Commit**

```bash
git add app/tests/integration/stripe-webhooks.test.ts
git commit -m "test(billing): assert claim rollback when webhook handler throws"
```

---

## Task 5: Route 3-class error classification

**Files:**
- Modify: `app/src/app/api/webhooks/stripe/route.ts` (full rewrite)
- Test: `app/tests/integration/stripe-webhooks.test.ts`

Three response classes: 400 for client errors (signature, syntax, missing header), 500 + Sentry for server errors (misconfig, handler). Use the existing `@/lib/monitoring/sentry` `captureException(err, extra?)` async wrapper.

- [ ] **Step 1: Write the failing tests for all six route paths**

Route tests use `vi.doMock(...)` followed by a dynamic `await import('@/app/api/webhooks/stripe/route')`. This pattern is more robust than `vi.spyOn(billingModule, ...)` against ESM live-binding quirks: each test installs a fresh mock for the billing module before importing the route.

Add to imports at the top of the test file (next to the other `@/lib/monitoring/sentry` import):

```ts
import { captureException } from '@/lib/monitoring/sentry';
```

Append this `describe` block at the bottom of the file:

```ts
function makeRequest(payload: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    body: payload,
    headers,
  });
}

async function loadRouteWithBillingMock(billingMockOverrides: Record<string, unknown>) {
  // Reset module registry so doMock takes effect for the freshly-imported route
  vi.resetModules();
  vi.doMock('@/lib/integrations/stripe/billing', async () => {
    const actual = await vi.importActual<typeof import('@/lib/integrations/stripe/billing')>('@/lib/integrations/stripe/billing');
    return { ...actual, ...billingMockOverrides };
  });
  // Re-mock dependencies that our top-level mocks installed; resetModules cleared them
  vi.doMock('@/lib/db', () => ({ db: dbMock }));
  vi.doMock('@/lib/monitoring/sentry', () => ({
    captureException: captureException as Mock,
    initSentryIfConfigured: vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock('@/lib/logger', () => ({
    logger: { child: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }) },
  }));
  const mod = await import('@/app/api/webhooks/stripe/route');
  return mod.POST;
}

describe('POST /api/webhooks/stripe error classification', () => {
  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_anything';
  });

  it('missing stripe-signature header → 400 before construct', async () => {
    const constructFn = vi.fn();
    const POST = await loadRouteWithBillingMock({ constructWebhookEvent: constructFn });
    const res = await POST(makeRequest('{}', {}) as any);
    expect(res.status).toBe(400);
    expect(constructFn).not.toHaveBeenCalled();
  });

  it('signature verification error → 400, no Sentry capture', async () => {
    const POST = await loadRouteWithBillingMock({
      constructWebhookEvent: vi.fn(() => { throw makeSignatureError(); }),
    });
    const res = await POST(makeRequest('{}', { 'stripe-signature': 'bad' }) as any);
    expect(res.status).toBe(400);
    expect(captureException as Mock).not.toHaveBeenCalled();
  });

  it('malformed payload (SyntaxError after signature verifies) → 400', async () => {
    const POST = await loadRouteWithBillingMock({
      constructWebhookEvent: vi.fn(() => { throw new SyntaxError('Unexpected token in JSON'); }),
    });
    const res = await POST(makeRequest('not-json', { 'stripe-signature': 'good' }) as any);
    expect(res.status).toBe(400);
    expect(captureException as Mock).not.toHaveBeenCalled();
  });

  it('missing STRIPE_WEBHOOK_SECRET → 500 + Sentry', async () => {
    const billing = await import('@/lib/integrations/stripe/billing');
    const POST = await loadRouteWithBillingMock({
      constructWebhookEvent: vi.fn(() => { throw new billing.MissingWebhookSecretError(); }),
    });
    const res = await POST(makeRequest('{}', { 'stripe-signature': 'whatever' }) as any);
    expect(res.status).toBe(500);
    expect(captureException as Mock).toHaveBeenCalled();
  });

  it('handler error → 500 + Sentry', async () => {
    const POST = await loadRouteWithBillingMock({
      constructWebhookEvent: vi.fn(() => ({ id: 'evt_test', type: 'customer.subscription.updated', data: { object: {} } } as any)),
      handleWebhookEvent: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const res = await POST(makeRequest('{}', { 'stripe-signature': 'good' }) as any);
    expect(res.status).toBe(500);
    expect(captureException as Mock).toHaveBeenCalled();
  });

  it('successful event → 200', async () => {
    const POST = await loadRouteWithBillingMock({
      constructWebhookEvent: vi.fn(() => ({ id: 'evt_test', type: 'customer.subscription.updated', data: { object: {} } } as any)),
      handleWebhookEvent: vi.fn().mockResolvedValue(undefined),
    });
    const res = await POST(makeRequest('{}', { 'stripe-signature': 'good' }) as any);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the new tests and confirm they fail**

Run: `cd app && npx vitest run tests/integration/stripe-webhooks.test.ts -t "error classification"`
Expected: most fail (current route returns 400 for everything; no Sentry capture anywhere).

- [ ] **Step 3: Replace the route handler**

In `app/src/app/api/webhooks/stripe/route.ts`, replace the entire file with:

```ts
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import {
  constructWebhookEvent,
  handleWebhookEvent,
  MissingWebhookSecretError,
} from '@/lib/integrations/stripe/billing';
import { captureException } from '@/lib/monitoring/sentry';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

const log = logger.child({ component: 'stripe-webhook' });

export async function POST(request: NextRequest) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    log.warn('[stripe-webhook] missing stripe-signature header');
    return NextResponse.json({ error: 'missing signature' }, { status: 400 });
  }

  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(payload, signature);
  } catch (err) {
    if (err instanceof MissingWebhookSecretError) {
      await captureException(err, { source: 'stripe-webhook', kind: 'misconfig' });
      log.error({ err }, '[stripe-webhook] missing STRIPE_WEBHOOK_SECRET');
      return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
    }
    if (err instanceof Stripe.errors.StripeSignatureVerificationError) {
      log.warn({ err }, '[stripe-webhook] signature verification failed');
      return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
    }
    if (err instanceof SyntaxError) {
      // stripe@18.x verifies signature first, then JSON.parse(payload).
      // A validly signed but malformed payload lands here.
      log.warn({ err }, '[stripe-webhook] malformed payload');
      return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
    }
    await captureException(err, { source: 'stripe-webhook', kind: 'construct' });
    log.error({ err }, '[stripe-webhook] unexpected construct error');
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  try {
    await handleWebhookEvent(event);
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    await captureException(err, {
      source: 'stripe-webhook',
      kind: 'handler',
      eventType: event.type,
      eventId: event.id,
    });
    log.error({ err, eventType: event.type, eventId: event.id }, '[stripe-webhook] handler error');
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the route tests and confirm they pass**

Run: `cd app && npx vitest run tests/integration/stripe-webhooks.test.ts -t "error classification"`
Expected: all 6 PASS.

- [ ] **Step 5: Run typecheck**

Run: `cd app && npm run typecheck`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add app/src/app/api/webhooks/stripe/route.ts app/tests/integration/stripe-webhooks.test.ts
git commit -m "fix(stripe-webhook): 3-class error classification (signature/payload 400, misconfig/handler 500 + Sentry)"
```

---

## Task 6: Replay test — already-processed events return 200 with no new side effects

**Files:**
- Test only: `app/tests/integration/stripe-webhooks.test.ts`

Verifies that a duplicate delivery of an event already recorded in `stripeWebhookEvents` returns early without re-running the handler.

- [ ] **Step 1: Write the test**

Append to the `describe('handleWebhookEvent idempotency', …)` block:

```ts
it('replay of already-processed event → no handler call, no new side effects', async () => {
  const returningMock = (db as any).returning as Mock;
  // Already-processed: insert returns empty (conflict)
  returningMock.mockResolvedValueOnce([]);

  const updateMock = (db as any).update as Mock;

  const event = makeStripeEvent('customer.subscription.updated');
  await handleWebhookEvent(event);

  expect(updateMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test and confirm it passes**

Run: `cd app && npx vitest run tests/integration/stripe-webhooks.test.ts -t "replay"`
Expected: PASS.

- [ ] **Step 3: Run the full integration test file once to confirm all 8 tests are green**

Run: `cd app && npx vitest run tests/integration/stripe-webhooks.test.ts`
Expected: all PASS, 0 skipped (after deleting the placeholder skip from Task 1 if still present).

- [ ] **Step 4: Run lint**

Run: `cd app && npm run lint`
Expected: no new errors in modified files.

- [ ] **Step 5: Commit**

```bash
git add app/tests/integration/stripe-webhooks.test.ts
git commit -m "test(billing): assert replay of already-processed webhook event is a no-op"
```

---

## Task 7: Final verification

- [ ] **Step 1: Confirm full test suite still green**

Run: `cd app && npm run test`
Expected: all tests pass, no regressions.

- [ ] **Step 2: Confirm typecheck still green**

Run: `cd app && npm run typecheck`
Expected: zero errors.

- [ ] **Step 3: PR description checklist (paste into PR body)**

```markdown
## Summary
Stripe webhook correctness: 3-class error classification + insert-first idempotency.

- Signature/syntax errors return 400 (Stripe should not retry).
- Misconfig (missing `STRIPE_WEBHOOK_SECRET`) and handler errors return 500 + Sentry capture (Stripe will retry).
- `handleWebhookEvent` flips from check-then-insert to insert-first; concurrent identical deliveries cannot double-process.
- On handler failure inside the dispatch, the idempotency claim is deleted so Stripe's retry can re-claim.

Documented limitation: hard process death between claim INSERT and successful return leaves a stuck claim. Sub-millisecond window; acceptable for current short-lived DB-only handlers. If observed in production, follow up with a claim row carrying status/claimedAt/processedAt/lastError.

## Test plan
- [x] `tests/integration/stripe-webhooks.test.ts` — 8 tests covering: idempotency under concurrency, claim rollback on handler error, replay no-op, 6 route error paths.
- [x] `npm run typecheck` clean.
- [x] `npm run lint` clean for modified files.

## Spec
`docs/superpowers/specs/2026-04-25-billing-correctness-design.md` §5
```

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin HEAD
gh pr create --title "fix(stripe-webhook): 3-class error classification + insert-first idempotency" --body-file <(cat <<'EOF'
[paste the PR description from Step 3 here]
EOF
)
```

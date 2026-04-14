# Security Hardening Wave 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 7 remaining security/reliability issues across two waves: auth+locking (4 items), then billing+platform (3 items).

**Architecture:** Each fix is a focused, independent change to an existing file. No new modules or abstractions — just patching existing functions. Stripe idempotency requires one new DB table + migration.

**Tech Stack:** Next.js 14, Drizzle ORM, ioredis, Vitest

---

## Wave 1: Security & Auth Concurrency

### Task 1: Session lock fail-closed (2.6)

**Files:**
- Modify: `app/src/app/api/ai/orchestrator/message/route.ts:45-54`
- Create: `app/tests/integration/session-lock-failclosed.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/tests/integration/session-lock-failclosed.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

describe('Session lock fail-closed behavior', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 503 when Redis is unavailable for session lock', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'u1', email: 'u@test.com' }),
    }));
    vi.doMock('@/lib/redis/client', () => ({
      getRedis: vi.fn().mockReturnValue(null),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: 'session-1', userId: 'u1' }]),
            }),
          }),
        }),
      },
    }));
    vi.doMock('@/lib/ai/orchestrator/engine', () => ({
      processMessage: vi.fn(),
      createSession: vi.fn(),
    }));
    vi.doMock('@/lib/ai/orchestrator/gateway', () => ({
      createGatewayClient: vi.fn(),
    }));
    vi.doMock('@/lib/ai/orchestrator/pubsub', () => ({
      createPubSubStream: vi.fn(),
    }));
    vi.doMock('@/lib/ai/model-routing', () => ({
      getAIModelRoutingContext: vi.fn().mockResolvedValue({}),
    }));
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
    }));

    const { POST } = await import('@/app/api/ai/orchestrator/message/route');
    const req = new NextRequest('http://localhost/api/ai/orchestrator/message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1', message: 'hello' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toContain('unavailable');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/integration/session-lock-failclosed.test.ts`
Expected: FAIL — currently returns 202 (fail-open)

- [ ] **Step 3: Change acquireLock to fail-closed**

In `app/src/app/api/ai/orchestrator/message/route.ts`, replace lines 45-54:

```typescript
async function acquireLock(sessionId: string): Promise<boolean> {
  try {
    const redis = getRedis()
    if (!redis) return true // fail-open when Redis is not configured
    const result = await redis.set(`orchestrator:lock:${sessionId}`, '1', 'EX', LOCK_TTL_SECONDS, 'NX')
    return result === 'OK'
  } catch {
    return true // fail-open for lock — if Redis is down, allow the request
  }
}
```

With:

```typescript
async function acquireLock(sessionId: string): Promise<'acquired' | 'busy' | 'unavailable'> {
  try {
    const redis = getRedis()
    if (!redis) return 'unavailable'
    const result = await redis.set(`orchestrator:lock:${sessionId}`, '1', 'EX', LOCK_TTL_SECONDS, 'NX')
    return result === 'OK' ? 'acquired' : 'busy'
  } catch {
    return 'unavailable'
  }
}
```

Then update the two call sites that use `acquireLock`:

**New session path** (~line 89): Replace `await acquireLock(session.id)` with:
```typescript
const lockStatus = await acquireLock(session.id)
if (lockStatus === 'unavailable') {
  return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 })
}
```

**Existing session path** (~line 115-118): Replace:
```typescript
const locked = await acquireLock(sessionId)
if (!locked) {
  return NextResponse.json({ error: 'Session is already processing a message. Please wait.' }, { status: 409 })
}
```
With:
```typescript
const lockStatus = await acquireLock(sessionId)
if (lockStatus === 'unavailable') {
  return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 })
}
if (lockStatus === 'busy') {
  return NextResponse.json({ error: 'Session is already processing a message. Please wait.' }, { status: 409 })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/integration/session-lock-failclosed.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
git commit -m "fix(security): make session lock fail-closed when Redis unavailable"
```

---

### Task 2: DB-backed isPlatformAdmin check (1.6)

**Files:**
- Modify: `app/src/app/api/v1/projects/[id]/route.ts:178`

- [ ] **Step 1: Read the current code**

The project PUT handler at line 178 trusts the JWT session value:
```typescript
if (!user.isPlatformAdmin && nextStatus === 'depus') {
```

This should call `requirePlatformAdmin()` which always hits the DB.

- [ ] **Step 2: Fix the check**

In `app/src/app/api/v1/projects/[id]/route.ts`, replace line 178:

```typescript
      if (!user.isPlatformAdmin && nextStatus === 'depus') {
```

With:

```typescript
      if (nextStatus === 'depus') {
        // DB-backed admin check — never trust stale session JWT for admin
        const { requirePlatformAdmin } = await import('@/lib/auth/helpers');
        try {
          await requirePlatformAdmin();
        } catch {
          throw new FondEUError({
            code: 'FORBIDDEN',
            statusCode: 403,
            messageEn: 'Only platform administrators can mark a project as submitted.',
            messageRo: 'Doar administratorii platformei pot marca un proiect ca depus.',
            details: { reason: 'PROJECT_SUBMISSION_REQUIRES_ADMIN' },
            retryable: false,
          });
        }
```

Remove the closing `}` that was part of the old if-block (line 187 currently has the closing brace — the new code includes its own error throw so the existing brace structure must be adjusted).

- [ ] **Step 3: Verify the existing test still passes**

Run: `cd app && npx vitest run tests/integration/project-detail-route.test.ts`
Expected: The test "requires org admin for direct submission status" should still pass (it mocks `requireAuth` to return a non-admin user; now `requirePlatformAdmin` will also fail because the DB mock doesn't return `isPlatformAdmin: true`).

Note: The test mocks `@/lib/auth/helpers` with only `requireAuth`. The dynamic import of `requirePlatformAdmin` will use the mocked module. You may need to add `requirePlatformAdmin` to the mock that rejects with `Errors.forbidden()`.

- [ ] **Step 4: Commit**

```
git commit -m "fix(security): use DB-backed admin check for project submission status"
```

---

### Task 3: Rate limit fail-closed on missing IP (P1-1)

**Files:**
- Modify: `app/src/lib/middleware/rate-limit.ts:53-59,85-89`

- [ ] **Step 1: Fix getClientIp to return null instead of empty string**

In `app/src/lib/middleware/rate-limit.ts`, replace `getClientIp` (lines 19-30):

```typescript
function getClientIp(request: NextRequest): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0]?.trim();
    if (firstIp) return firstIp;
  }

  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  return null;
}
```

- [ ] **Step 2: Fix enforceRateLimit to fail-closed in production**

Replace lines 53-59:

```typescript
  const identity = options.keySuffix ?? getClientIp(request);

  // If no identity can be determined, allow the request but skip rate limiting
  if (!identity) {
    log.warn('Request with no identifiable IP address — skipping rate limit');
    return { ok: true, headers: {} };
  }
```

With:

```typescript
  const identity = options.keySuffix ?? getClientIp(request);

  if (!identity) {
    log.warn('Request with no identifiable IP — rejecting in production');
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Unable to identify request origin' },
        { status: 403 },
      ),
    };
  }
```

- [ ] **Step 3: Fix Redis failure to fail-closed**

Replace lines 85-89:

```typescript
  } catch (error) {
    log.error({ error }, 'Rate limit check failed — allowing request');
    return {
      ok: true,
      headers: {},
    };
  }
```

With:

```typescript
  } catch (error) {
    log.error({ error }, 'Rate limit check failed — rejecting request');
    return {
      ok: false,
      response: NextResponse.json(
        Errors.serviceUnavailable('rate-limiter').toResponse('ro'),
        { status: 503 },
      ),
    };
  }
```

- [ ] **Step 4: Update affected tests**

Run: `cd app && npx vitest run tests/integration/security-fixes.test.ts`

If any rate-limit tests break (they mock Redis as available, so they shouldn't), update them to match the new fail-closed behavior.

- [ ] **Step 5: Commit**

```
git commit -m "fix(security): make rate limiting fail-closed on missing IP and Redis failure"
```

---

### Task 4: Audit hash chain FOR UPDATE lock (2.5)

**Files:**
- Modify: `app/src/lib/legal/audit.ts:139-143`

- [ ] **Step 1: Add FOR UPDATE to the latest hash query**

In `app/src/lib/legal/audit.ts`, replace lines 139-143:

```typescript
      // 1. Read latest entry_hash
      const [latest] = await tx
        .select({ entryHash: auditLog.entryHash })
        .from(auditLog)
        .orderBy(desc(auditLog.createdAt))
        .limit(1);
```

With:

```typescript
      // 1. Read latest entry_hash (FOR UPDATE prevents concurrent chain forks)
      const [latest] = await tx
        .select({ entryHash: auditLog.entryHash })
        .from(auditLog)
        .orderBy(desc(auditLog.createdAt))
        .limit(1)
        .for('update');
```

Note: Drizzle ORM supports `.for('update')` on select queries within transactions. This serializes concurrent `logAudit()` calls so only one can read+write at a time, preventing hash chain forks.

- [ ] **Step 2: Verify typecheck**

Run: `cd app && npm run typecheck`
Expected: Clean

- [ ] **Step 3: Run audit-related tests**

Run: `cd app && npx vitest run tests/integration/workspace.test.ts tests/unit/audit-hash-chain.test.ts`
Expected: PASS (existing tests don't test concurrency, so they should be unaffected)

- [ ] **Step 4: Commit**

```
git commit -m "fix(security): add FOR UPDATE to audit hash chain read to prevent forks"
```

---

## Wave 2: Reliability & Platform

### Task 5: Stripe webhook idempotency (P1-2)

**Files:**
- Modify: `app/src/lib/db/schema.ts` (add table)
- Modify: `app/src/lib/integrations/stripe/billing.ts:353-374`
- Modify: `app/src/app/api/webhooks/stripe/route.ts`

- [ ] **Step 1: Add stripe_webhook_events table to schema**

In `app/src/lib/db/schema.ts`, add after the `authVerificationTokens` table (around line 140):

```typescript
export const stripeWebhookEvents = pgTable('stripe_webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: varchar('event_id', { length: 255 }).unique().notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  processedAt: timestamp('processed_at').defaultNow().notNull(),
});
```

- [ ] **Step 2: Generate migration**

Run: `cd app && npm run db:generate`
Expected: Creates a migration file in `app/drizzle/`

- [ ] **Step 3: Add idempotency check to handleWebhookEvent**

In `app/src/lib/integrations/stripe/billing.ts`, replace `handleWebhookEvent` (lines 353-374):

```typescript
export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  // Idempotency: skip if already processed
  const existing = await db.query.stripeWebhookEvents.findFirst({
    where: eq(stripeWebhookEvents.eventId, event.id),
  });
  if (existing) return;

  // Process the event
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

  // Record as processed (after success — if handler throws, event can be retried)
  await db.insert(stripeWebhookEvents).values({
    eventId: event.id,
    eventType: event.type,
  }).onConflictDoNothing();
}
```

Add the imports at the top of the file:
```typescript
import { stripeWebhookEvents } from '@/lib/db/schema';
```

- [ ] **Step 4: Typecheck**

Run: `cd app && npm run typecheck`
Expected: Clean

- [ ] **Step 5: Commit**

```
git commit -m "fix(reliability): add Stripe webhook event idempotency tracking"
```

---

### Task 6: Timezone-safe eligibility deadline (P1-4)

**Files:**
- Modify: `app/src/lib/rules/eligibility.ts:277-314`

- [ ] **Step 1: Fix deadline comparison to use Romania timezone**

In `app/src/lib/rules/eligibility.ts`, replace `checkDeadline` (lines 277-314):

```typescript
const checkDeadline: Rule = (ctx) => {
  const { call } = ctx;
  if (!call.submissionEnd) {
    return {
      ruleId: 'DEAD-001',
      ruleName: 'Termen limită',
      status: 'not_applicable',
      messageRo: 'Termenul limită nu este specificat.',
      messageEn: 'Deadline not specified.',
    };
  }

  const deadline = new Date(call.submissionEnd);
  // Use Romania timezone for deadline comparison — EU funding calls use CET/EEST
  const nowInRomania = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Bucharest' }));
  const daysLeft = Math.ceil((deadline.getTime() - nowInRomania.getTime()) / (1000 * 60 * 60 * 24));

  if (daysLeft < 0) {
    return {
      ruleId: 'DEAD-001',
      ruleName: 'Termen limită',
      status: 'fail',
      messageRo: `Termenul limită a expirat în urmă cu ${Math.abs(daysLeft)} zile.`,
      messageEn: `Deadline expired ${Math.abs(daysLeft)} days ago.`,
    };
  }

  return {
    ruleId: 'DEAD-001',
    ruleName: 'Termen limită',
    status: daysLeft <= 14 ? 'warning' : 'pass',
    messageRo: daysLeft <= 14
      ? `Atenție: mai sunt doar ${daysLeft} zile până la termenul limită!`
      : `Mai sunt ${daysLeft} zile până la termenul limită.`,
    messageEn: daysLeft <= 14
      ? `Warning: only ${daysLeft} days until deadline!`
      : `${daysLeft} days until deadline.`,
  };
};
```

- [ ] **Step 2: Run eligibility tests**

Run: `cd app && npx vitest run tests/unit/eligibility-rules.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```
git commit -m "fix(rules): use Romania timezone for eligibility deadline comparison"
```

---

### Task 7: Node version alignment (P1-3)

**Files:**
- Modify: `infrastructure/Dockerfile.prod:2`
- Modify: `.github/workflows/security-scan.yml:46`
- Modify: `.github/workflows/dependency-security-scan.yml:34,150`

- [ ] **Step 1: Align infrastructure Dockerfile to Node 22**

In `infrastructure/Dockerfile.prod`, replace line 2:

```dockerfile
FROM node:20-alpine AS base
```

With:

```dockerfile
FROM node:22-alpine AS base
```

- [ ] **Step 2: Align security scan workflows to Node 22**

In `.github/workflows/security-scan.yml`, replace line 46:
```yaml
          node-version: '20'
```
With:
```yaml
          node-version: '22'
```

In `.github/workflows/dependency-security-scan.yml`, replace lines 34 and 150:
```yaml
          node-version: '20'
```
With:
```yaml
          node-version: '22'
```

- [ ] **Step 3: Commit**

```
git commit -m "chore: align all Node.js versions to 22 (Dockerfile.prod + CI workflows)"
```

---

## Verification

### Task 8: Final verification

- [ ] **Step 1: Run typecheck**

Run: `cd app && npm run typecheck`
Expected: Clean

- [ ] **Step 2: Run full test suite**

Run: `cd app && npx vitest run`
Expected: All tests pass (727+), 0 failures

- [ ] **Step 3: Run lint**

Run: `cd app && npm run lint`
Expected: No new lint errors

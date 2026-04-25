// app/tests/integration/stripe-webhooks.test.ts
import { beforeEach, describe, it, vi } from 'vitest';
import Stripe from 'stripe';

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
function makeSignatureError(message = 'No signatures found matching the expected signature for payload'): Stripe.errors.StripeSignatureVerificationError {
  const err = new Error(message);
  Object.setPrototypeOf(err, Stripe.errors.StripeSignatureVerificationError.prototype);
  return err as Stripe.errors.StripeSignatureVerificationError;
}

describe('stripe webhooks', () => {
  it.skip('placeholder', () => {});
});

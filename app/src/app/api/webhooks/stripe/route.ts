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

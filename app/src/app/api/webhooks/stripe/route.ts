import { NextRequest, NextResponse } from 'next/server';
import { constructWebhookEvent, handleWebhookEvent } from '@/lib/integrations/stripe/billing';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing Stripe signature' }, { status: 400 });
  }

  try {
    const payload = await request.text();
    const event = constructWebhookEvent(payload, signature);

    await handleWebhookEvent(event);

    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json({ error: 'Invalid webhook signature or payload' }, { status: 400 });
  }
}

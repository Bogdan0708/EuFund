import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/helpers';
import { createCheckoutSession } from '@/lib/integrations/stripe/billing';
import { FondEUError } from '@/lib/errors';

const checkoutSchema = z.object({
  tier: z.enum(['pro', 'enterprise']),
  interval: z.enum(['monthly', 'yearly']).optional().default('monthly'),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const parsed = checkoutSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid payload', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const successUrl = `${request.nextUrl.origin}/billing/success`;
    const cancelUrl = `${request.nextUrl.origin}/billing`;

    const session = await createCheckoutSession(
      user.id,
      parsed.data.tier,
      parsed.data.interval,
      successUrl,
      cancelUrl,
    );

    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }

    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuthScope } from '@/lib/auth/helpers';
import { createCheckoutSession } from '@/lib/integrations/stripe/billing';
import { FondEUError } from '@/lib/errors';

const checkoutSchema = z.object({
  tier: z.enum(['pro', 'enterprise']),
  interval: z.enum(['monthly', 'yearly']).optional().default('monthly'),
});

async function createSession(request: NextRequest, payload: unknown, userId: string): Promise<string | NextResponse> {
  const parsed = checkoutSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const baseUrl = process.env.NEXTAUTH_URL || request.nextUrl.origin;
  const successUrl = `${baseUrl}/billing/success`;
  const cancelUrl = `${baseUrl}/billing`;

  const session = await createCheckoutSession(
    userId,
    parsed.data.tier,
    parsed.data.interval,
    successUrl,
    cancelUrl,
  );

  return session.url;
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const result = await withAuthScope(async (user) => createSession(request, payload, user.id));
    if (typeof result !== 'string') {
      return result;
    }

    return NextResponse.json({ url: result });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }

    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getPricingTiers } from '@/lib/integrations/stripe/billing';

export async function GET() {
  return NextResponse.json(getPricingTiers());
}

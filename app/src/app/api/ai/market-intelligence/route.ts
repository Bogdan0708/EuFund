// ─── GET /api/ai/market-intelligence ─────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { gatherMarketIntelligence, quickIntelligenceSummary } from '@/lib/ai/integration-intelligence';
import { FondEUError, Errors } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sector = searchParams.get('sector') || 'general';
    const quick = searchParams.get('quick') === 'true';

    if (quick) {
      const result = quickIntelligenceSummary(sector);
      return NextResponse.json({ success: true, data: result });
    }

    const interests = searchParams.get('interests')?.split(',') || [sector];
    const result = await gatherMarketIntelligence({
      sector,
      interests,
      organizationName: searchParams.get('organization') || undefined,
      country: 'RO',
      locale: (searchParams.get('locale') as 'ro' | 'en') || 'en',
    });

    await logAudit({
      action: 'ai.generate',
      resourceType: 'market_intelligence',
      metadata: { sector, alertCount: result.opportunityAlerts.length },
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof FondEUError) return NextResponse.json(error.toResponse(), { status: error.statusCode });
    console.error('[market-intelligence]', error);
    return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
  }
}

// ─── POST /api/ai/market-intelligence ────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { analyzeRomanianContext, quickRomanianCheck } from '@/lib/ai/romanian-market-intelligence';
import { FondEUError, Errors } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { withAIAuth } from '@/lib/middleware/auth';
import { logger } from '@/lib/logger';
import { sanitizeAIResponseDeep } from '@/lib/ai/sanitize';
import { assertTier } from '@/lib/middleware/tier-gate';

const inputSchema = z.object({
  projectBudget: z.number().nonnegative(),
  romanianPartnerCount: z.number().int().nonnegative(),
  hasPublicProcurement: z.boolean(),
  projectDurationMonths: z.number().int().positive(),
  sectorFocus: z.string().optional(),
  currentExchangeRate: z.number().optional(),
  locale: z.enum(['ro', 'en']).optional(),
  quick: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  return withAIAuth(request, async (user) => {
    try {
      const body = await request.json();
      const parsed = inputSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(Errors.validation('body', 'Date invalide', 'Invalid input').toResponse(), { status: 400 });
      }

      if (parsed.data.quick) {
        const quick = quickRomanianCheck(parsed.data.hasPublicProcurement, parsed.data.romanianPartnerCount);
        return NextResponse.json({ success: true, data: quick });
      }

      assertTier(user.tier, 'pro');

      const result = await analyzeRomanianContext(parsed.data);

      await logAudit({
        action: 'ai.generate',
        resourceType: 'market_intelligence',
        userId: user.id,
        metadata: {
          readiness: result.overallReadiness,
          procurementRisks: result.publicProcurementRisks.length,
          userTier: user.tier,
        },
      });

      const { sanitized: data } = sanitizeAIResponseDeep(result);
      return NextResponse.json({ success: true, data });
    } catch (error) {
      if (error instanceof FondEUError) return NextResponse.json(error.toResponse(), { status: error.statusCode });
      logger.error({ error: error }, '[market-intelligence]');
      return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
    }
  });
}

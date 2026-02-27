import { withAIAuth } from '@/lib/middleware/auth';
// ─── Budget Intelligence API ─────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { analyzeBudget, type BudgetIntelligenceInput } from '@/lib/ai/budget-intelligence';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { sanitizeAIResponseDeep } from '@/lib/ai/sanitize';

const budgetSchema = z.object({
  projectId: z.string(),
  totalBudget: z.number(),
  currency: z.literal('EUR').default('EUR'),
  programType: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  currentDate: z.string().optional(),
  coFinancingRate: z.number(),
  categories: z.array(z.object({
    id: z.string(),
    name: z.string(),
    nameRo: z.string().optional(),
    allocated: z.number(),
    spent: z.number(),
    committed: z.number().default(0),
    isEligible: z.boolean().default(true),
    euCostCategory: z.enum(['personnel', 'subcontracting', 'equipment', 'travel', 'other-goods', 'indirect']),
    maxPercentage: z.number().optional(),
    monthlySpending: z.array(z.object({ month: z.string(), amount: z.number() })).optional(),
  })),
  partners: z.array(z.object({
    partnerId: z.string(),
    partnerName: z.string(),
    allocated: z.number(),
    spent: z.number(),
    currency: z.enum(['EUR', 'RON']),
    isRomanian: z.boolean(),
  })),
  exchangeRate: z.number().optional(),
  romanianPartnerBudgetRON: z.number().optional(),
  inflationRate: z.number().optional(),
  locale: z.enum(['ro', 'en']).default('en'),
});

export async function POST(request: NextRequest) {
  return withAIAuth(request, async () => {
    const req = request;
  try {
    const body = await req.json();
    const parsed = budgetSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, { status: 400 });
    }

    const result = await analyzeBudget(parsed.data as BudgetIntelligenceInput);
    const { sanitized: data } = sanitizeAIResponseDeep(result);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    logger.error({ error: error }, 'Budget analysis error:');
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Budget analysis failed' } },
      { status: 500 },
    );
  }
});
}

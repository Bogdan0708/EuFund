import { withAIAuth } from '@/lib/middleware/auth';
// ─── POST /api/ai/recommend-partners ─────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { recommendPartners, quickPartnerMatch } from '@/lib/ai/partner-matching';
import { FondEUError, Errors } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';

const inputSchema = z.object({
  projectTitle: z.string().min(5),
  projectSummary: z.string().min(20),
  programType: z.string(),
  totalBudget: z.number().positive(),
  requiredCapabilities: z.array(z.string()),
  existingPartners: z.array(z.object({
    name: z.string(),
    country: z.string(),
    type: z.enum(['university', 'research_institute', 'sme', 'large_enterprise', 'ngo', 'public_body']),
    capabilities: z.array(z.string()),
    budgetShare: z.number().optional(),
    role: z.enum(['coordinator', 'partner']),
  })),
  preferredCountries: z.array(z.string()).optional(),
  sector: z.string(),
  quick: z.boolean().optional(),
  locale: z.enum(['ro', 'en']).optional(),
});

export async function POST(request: NextRequest) {
  return withAIAuth(request, async (user) => {
  try {
    const body = await request.json();
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(Errors.validation('body', 'Date invalide', 'Invalid input').toResponse(), { status: 400 });
    }

    const input = parsed.data as any;

    if (input.quick) {
      const result = quickPartnerMatch(input.requiredCapabilities, input.sector);
      return NextResponse.json({ success: true, data: { recommendedPartners: result } });
    }

    const result = await recommendPartners(input);

    await logAudit({
      action: 'ai.generate',
      resourceType: 'partner_recommendation',
      metadata: { partnersRecommended: result.recommendedPartners.length },
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof FondEUError) return NextResponse.json(error.toResponse(), { status: error.statusCode });
    logger.error({ error: error }, '[recommend-partners]');
    return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
  }
});
}

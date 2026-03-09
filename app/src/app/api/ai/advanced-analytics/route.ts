import { withAIAuth } from '@/lib/middleware/auth';
// ─── POST /api/ai/advanced-analytics ─────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generateAdvancedReport, quickPortfolioSummary } from '@/lib/ai/advanced-reporting';
import { type EUProgramKey } from '@/lib/ai/eu-knowledge-base';
import { FondEUError, Errors } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';
import { sanitizeAIResponseDeep } from '@/lib/ai/sanitize';
import { assertTier } from '@/lib/middleware/tier-gate';

const euProgramKeys = ['horizon_europe', 'life_plus', 'interreg', 'erdf', 'pocidif', 'pnrr', 'general'] as const;

const inputSchema = z.object({
  organizationName: z.string(),
  projects: z.array(z.object({
    id: z.string(),
    title: z.string(),
    program: z.enum(euProgramKeys),
    budget: z.number(),
    spent: z.number(),
    status: z.enum(['active', 'completed', 'pipeline']),
    healthScore: z.number(),
    sector: z.string(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  })),
  historicalSuccessRate: z.number().optional(),
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

    const input = parsed.data as typeof parsed.data & {
      projects: Array<typeof parsed.data.projects[number] & { program: EUProgramKey }>;
    };

    if (input.quick) {
      const result = quickPortfolioSummary(input);
      const { sanitized: data } = sanitizeAIResponseDeep(result);
      return NextResponse.json({ success: true, data });
    }

    assertTier(user.tier, 'pro');

    const result = await generateAdvancedReport(input);

    await logAudit({
      action: 'ai.generate',
      resourceType: 'advanced_analytics',
      metadata: { organizationName: input.organizationName, projectCount: input.projects.length },
    });

    const { sanitized: data } = sanitizeAIResponseDeep(result);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof FondEUError) return NextResponse.json(error.toResponse(), { status: error.statusCode });
    logger.error({ error: error }, '[advanced-analytics]');
    return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
  }
});
}

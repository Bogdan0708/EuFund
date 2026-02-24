import { withAIAuth } from '@/lib/middleware/auth';
// ─── POST /api/ai/advanced-analytics ─────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generateAdvancedReport, quickPortfolioSummary } from '@/lib/ai/advanced-reporting';
import { FondEUError, Errors } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';

const inputSchema = z.object({
  organizationName: z.string(),
  projects: z.array(z.object({
    id: z.string(),
    title: z.string(),
    program: z.string(),
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
  return withAIAuth(request, async () => {
  try {
    const body = await request.json();
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(Errors.validation('body', 'Date invalide', 'Invalid input').toResponse(), { status: 400 });
    }

    const input = parsed.data;

    if (input.quick) {
      const result = quickPortfolioSummary(input);
      return NextResponse.json({ success: true, data: result });
    }

    const result = await generateAdvancedReport(input);

    await logAudit({
      action: 'ai.generate',
      resourceType: 'advanced_analytics',
      metadata: { organizationName: input.organizationName, projectCount: input.projects.length },
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof FondEUError) return NextResponse.json(error.toResponse(), { status: error.statusCode });
    logger.error({ error: error }, '[advanced-analytics]');
    return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
  }
});
}

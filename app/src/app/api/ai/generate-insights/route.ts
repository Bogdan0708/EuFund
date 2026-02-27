import { withAIAuth } from '@/lib/middleware/auth';
// ─── POST /api/ai/generate-insights ──────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generateKnowledgeRecommendations, quickQualityCheck } from '@/lib/ai/knowledge-engine';
import { type EUProgramKey } from '@/lib/ai/eu-knowledge-base';
import { FondEUError, Errors } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';
import { sanitizeAIResponseDeep } from '@/lib/ai/sanitize';

const euProgramKeys = ['horizon_europe', 'life_plus', 'interreg', 'erdf', 'pocidif', 'pnrr', 'general'] as const;

const inputSchema = z.object({
  projectTitle: z.string().min(5),
  projectSummary: z.string().min(20),
  programType: z.enum(euProgramKeys),
  objectives: z.array(z.string()).optional(),
  methodology: z.string().optional(),
  impact: z.string().optional(),
  dissemination: z.string().optional(),
  budget: z.number().optional(),
  partners: z.array(z.object({
    name: z.string(),
    country: z.string(),
    type: z.string(),
    role: z.string(),
  })).optional(),
  sector: z.string(),
  proposalDraft: z.string().optional(),
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

    const input = parsed.data as typeof parsed.data & { programType: EUProgramKey };

    if (input.quick) {
      const result = quickQualityCheck(input);
      return NextResponse.json({ success: true, data: result });
    }

    const result = await generateKnowledgeRecommendations(input);

    await logAudit({
      userId: user.id,
      action: 'ai.generate',
      resourceType: 'knowledge_insights',
      metadata: { qualityScore: result.overallQualityScore, readiness: result.readinessLevel },
    });

    const { sanitized: data } = sanitizeAIResponseDeep(result);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof FondEUError) return NextResponse.json(error.toResponse(), { status: error.statusCode });
    logger.error({ error: error }, '[generate-insights]');
    return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
  }
});
}

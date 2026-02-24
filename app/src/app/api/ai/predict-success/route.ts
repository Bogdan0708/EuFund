// ─── POST /api/ai/predict-success ────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { predictProposalSuccess, quickSuccessPrediction } from '@/lib/ai/predictive-analytics';
import { type EUProgramKey } from '@/lib/ai/eu-knowledge-base';
import { FondEUError, Errors } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { withAIAuth } from '@/lib/middleware/auth';
import { logger } from '@/lib/logger';

const euProgramKeys = ['horizon_europe', 'life_plus', 'interreg', 'erdf', 'pocidif', 'pnrr', 'general'] as const;

const inputSchema = z.object({
  projectTitle: z.string().min(5),
  projectSummary: z.string().min(20),
  programType: z.enum(euProgramKeys),
  totalBudget: z.number().positive(),
  durationMonths: z.number().positive(),
  sector: z.string(),
  trl: z.number().min(1).max(9).optional(),
  partners: z.array(z.object({
    name: z.string(),
    country: z.string(),
    type: z.enum(['university', 'research_institute', 'sme', 'large_enterprise', 'ngo', 'public_body']),
    role: z.enum(['coordinator', 'partner']),
    previousEUProjects: z.number().optional(),
    budgetShare: z.number().optional(),
  })),
  methodology: z.string().optional(),
  expectedImpact: z.string().optional(),
  innovation: z.string().optional(),
  objectives: z.array(z.string()).optional(),
  romanianLead: z.boolean().optional(),
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
      const result = quickSuccessPrediction(input);
      return NextResponse.json({ success: true, data: result });
    }

    const result = await predictProposalSuccess(input);

    await logAudit({
      action: 'ai.generate',
      resourceType: 'success_prediction',
      userId: user.id,
      metadata: { 
        successProbability: result.successProbability, 
        confidence: result.confidenceLevel,
        userTier: user.tier 
      },
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof FondEUError) return NextResponse.json(error.toResponse(), { status: error.statusCode });
    logger.error({ error: error }, '[predict-success]');
    return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
  }
  });
}

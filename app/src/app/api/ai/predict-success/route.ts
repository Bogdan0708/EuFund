// ─── POST /api/ai/predict-success ────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { predictProposalSuccess, quickSuccessPrediction, type ProposalSuccessPrediction } from '@/lib/ai/predictive-analytics';
import { type EUProgramKey } from '@/lib/ai/eu-knowledge-base';
import { FondEUError, Errors } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { withAIAuth } from '@/lib/middleware/auth';
import { withEUAIActCompliance } from '@/lib/ai/eu-ai-act';
import { logger } from '@/lib/logger';
import { sanitizeAIResponseDeep } from '@/lib/ai/sanitize';
import { db } from '@/lib/db';
import { aiReviews, orgMembers } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { assertTier } from '@/lib/middleware/tier-gate';

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
  orgId: z.string().uuid().optional(),
});

async function resolveOversightOrgId(userId: string, requestedOrgId?: string): Promise<string | null> {
  if (requestedOrgId) {
    const membership = await db.query.orgMembers.findFirst({
      where: and(
        eq(orgMembers.userId, userId),
        eq(orgMembers.orgId, requestedOrgId),
      ),
    });
    return membership?.orgId ?? null;
  }

  const memberships = await db.query.orgMembers.findMany({
    where: eq(orgMembers.userId, userId),
    columns: { orgId: true },
    limit: 2,
  });

  if (memberships.length === 1) {
    return memberships[0].orgId;
  }

  return null;
}

export async function POST(request: NextRequest) {
  return withAIAuth(request, async (user) => {
    try {
      const body = await request.json();
      const parsed = inputSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(Errors.validation('body', 'Date invalide', 'Invalid input').toResponse(), { status: 400 });
      }

      const input = parsed.data as typeof parsed.data & { programType: EUProgramKey };

      if (!input.quick) {
        assertTier(user.tier, 'pro');
      }

      const runWithCompliance = withEUAIActCompliance<typeof input>(
        'predict-success',
        async (payload) => {
          if (payload.quick) {
            const quickResult = quickSuccessPrediction(payload);
            return { result: quickResult, confidence: 0.4 };
          }

          const fullResult = await predictProposalSuccess(payload);
          const confidenceMap: Record<ProposalSuccessPrediction['confidenceLevel'], number> = {
            high: 0.9,
            medium: 0.7,
            low: 0.45,
          };
          return { result: fullResult, confidence: confidenceMap[fullResult.confidenceLevel] };
        },
      );

      const execution = await runWithCompliance(input, user.id);
      const result = execution.result as ProposalSuccessPrediction | ReturnType<typeof quickSuccessPrediction>;
      const oversightRequired = execution.metadata?.oversightRequired === true;

      const fullResult = result as ProposalSuccessPrediction;
      await logAudit({
        action: 'ai.generate',
        resourceType: 'success_prediction',
        userId: user.id,
        metadata: {
          successProbability: fullResult.successProbability ?? null,
          confidence: fullResult.confidenceLevel ?? (input.quick ? 'low' : null),
          userTier: user.tier,
          oversightRequired,
          quickMode: input.quick === true,
        },
      });

      const { sanitized: data } = sanitizeAIResponseDeep(result);

      // EU AI Act Art. 14: High-risk results require human oversight
      if (oversightRequired) {
        const oversightOrgId = await resolveOversightOrgId(user.id, input.orgId);

        if (!oversightOrgId) {
          return NextResponse.json({
            success: false,
            error: {
              code: 'OVERSIGHT_ORG_REQUIRED',
              message: 'A valid organization context is required for human oversight routing.',
            },
          }, { status: 409 });
        }

        if (oversightOrgId) {
          const [review] = await db.insert(aiReviews).values({
            orgId: oversightOrgId,
            requestedBy: user.id,
            feature: 'predict-success',
            riskLevel: 'high',
            inputSummary: `${input.projectTitle} — ${input.programType}`,
            resultData: data,
            resultMetadata: execution.metadata ?? {},
            status: 'pending_review',
          }).returning({ id: aiReviews.id });

          return NextResponse.json({
            success: true,
            status: 'pending_review',
            reviewId: review.id,
            reviewUrl: `/api/v1/organizations/${oversightOrgId}/ai-reviews?status=pending_review`,
            message: 'Rezultatul necesită aprobarea unui administrator conform EU AI Act Art. 14.',
            messageEn: 'Result requires administrator approval per EU AI Act Art. 14.',
            metadata: {
              aiAct: execution.metadata,
            },
          });
        }
      }

      return NextResponse.json({
        success: true,
        data,
        metadata: {
          aiAct: execution.metadata,
        },
      });
    } catch (error) {
      if (error instanceof FondEUError) return NextResponse.json(error.toResponse(), { status: error.statusCode });
      logger.error({ error: error }, '[predict-success]');
      return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
    }
  });
}

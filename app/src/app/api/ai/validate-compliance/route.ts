// ─── POST /api/ai/validate-compliance ────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateCompliance } from '@/lib/ai/compliance-validator';
import { FondEUError, Errors } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { withAIAuth } from '@/lib/middleware/auth';

const complianceInputSchema = z.object({
  project: z.object({
    title: z.string().min(5),
    summary: z.string().optional(),
    objectives: z.string().optional(),
    methodology: z.string().optional(),
    budget: z.number().optional(),
    ownContrib: z.number().optional(),
    durationMonths: z.number().optional(),
  }),
  organization: z.object({
    orgType: z.string(),
    orgSize: z.string().optional(),
    caenPrimary: z.string().optional(),
    caenSecondary: z.array(z.string()).optional(),
    nutsRegion: z.string().optional(),
    employeeCount: z.number().optional(),
    annualRevenue: z.number().optional(),
  }),
  call: z.object({
    eligibleTypes: z.array(z.string()).optional(),
    eligibleRegions: z.array(z.string()).optional(),
    eligibleCaen: z.array(z.string()).optional(),
    budgetMin: z.number().optional(),
    budgetMax: z.number().optional(),
    cofinancingRate: z.number().optional(),
    durationMin: z.number().optional(),
    durationMax: z.number().optional(),
    submissionEnd: z.string().optional(),
  }).optional(),
  locale: z.enum(['ro', 'en']).optional().default('ro'),
});

export async function POST(request: NextRequest) {
  return withAIAuth(request, async (user) => {
    try {
      const body = await request.json();
      const parsed = complianceInputSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          Errors.validation('body', 'Date invalide', 'Invalid input').toResponse(),
          { status: 400 }
        );
      }

      const result = await validateCompliance(parsed.data);

      await logAudit({
        userId: user.id,
        action: 'ai.compliance_check',
        resourceType: 'project',
        metadata: {
          overallScore: result.overallScore,
          tokensUsed: result.tokensUsed,
          ragSources: result.ragSources,
          userTier: user.tier,
        },
      });

      return NextResponse.json({
        success: true,
        data: {
          overallScore: result.overallScore,
          deterministicResults: result.deterministicResults,
          aiResults: result.aiResults,
          recommendations: result.recommendations,
          metadata: {
            tokensUsed: result.tokensUsed,
            ragSourcesUsed: result.ragSources,
            validatedAt: new Date().toISOString(),
          },
        },
      });
    } catch (error) {
      if (error instanceof FondEUError) {
        return NextResponse.json(error.toResponse(), { status: error.statusCode });
      }
      console.error('[validate-compliance]', error);
      return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
    }
  });
}

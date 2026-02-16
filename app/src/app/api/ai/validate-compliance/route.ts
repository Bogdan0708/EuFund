// ─── POST /api/ai/validate-compliance ────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { validateCompliance } from '@/lib/ai/compliance-validator';
import { FondEUError, Errors } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { withAIAuth } from '@/lib/middleware/auth';
import { validateComplianceSchema } from '@/lib/validation/schemas';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  return withAIAuth(request, async (user) => {
    try {
      const body = await request.json();
      const parsed = validateComplianceSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          Errors.validation('body', 'Date invalide', 'Invalid input').toResponse(),
          { status: 400 }
        );
      }

      const result = await validateCompliance({
        project: {
          title: parsed.data.proposalText.slice(0, 120),
          summary: parsed.data.proposalText,
        },
        organization: {
          orgType: 'unknown',
        },
        call: {
          eligibleTypes: parsed.data.regulations,
        },
        locale: 'ro',
      });

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
      logger.error({ error: error }, '[validate-compliance]');
      return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
    }
  });
}

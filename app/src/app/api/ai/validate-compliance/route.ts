// ─── POST /api/ai/validate-compliance ────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { validateCompliance } from '@/lib/ai/compliance-validator';
import { FondEUError, Errors } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { withAIAuth } from '@/lib/middleware/auth';
import { withEUAIActCompliance } from '@/lib/ai/eu-ai-act';
import { validateComplianceSchema } from '@/lib/validation/schemas';
import { logger } from '@/lib/logger';
import { checkFacts } from '@/lib/ai/fact-checker';
import { sanitizeAIResponseDeep } from '@/lib/ai/sanitize';

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

      const validationInput = {
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
        locale: 'ro' as const,
      };

      const runWithCompliance = withEUAIActCompliance<typeof validationInput>(
        'validate-compliance',
        async (payload) => {
          const result = await validateCompliance(payload);
          return { result, confidence: result.overallScore / 100 };
        },
      );
      const execution = await runWithCompliance(validationInput, user.id);
      const result = execution.result as Awaited<ReturnType<typeof validateCompliance>>;

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

      const complianceData = {
        overallScore: result.overallScore,
        deterministicResults: result.deterministicResults,
        aiResults: result.aiResults,
        dnshAssessment: result.dnshAssessment,
        sourceTrace: result.sourceTrace,
        recommendations: result.recommendations,
      };
      const { sanitized: sanitizedData } = sanitizeAIResponseDeep(complianceData);
      const factCheck = checkFacts(JSON.stringify(complianceData));
      return NextResponse.json({
        success: true,
        data: {
          ...sanitizedData,
          metadata: {
            tokensUsed: result.tokensUsed,
            ragSourcesUsed: result.ragSources,
            validatedAt: result.evaluatedAt,
            aiAct: execution.metadata,
            ...(!factCheck.passed && { factCheckWarnings: factCheck.warnings }),
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
  }, { feature: 'compliance' });
}

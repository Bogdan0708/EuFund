// ─── POST /api/ai/generate-proposal-enhanced ─────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { generateEnhancedProposal } from '@/lib/ai/enhanced-proposal-generator';
import { FondEUError, Errors } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { withAIAuth } from '@/lib/middleware/auth';
import { generateProposalSchema } from '@/lib/validation/schemas';
import { logger } from '@/lib/logger';

const PROGRAM_MAP: Record<string, 'horizon_europe' | 'interreg' | 'life_plus' | 'pocidif' | 'pnrr' | 'general'> = {
  horizon_europe: 'horizon_europe',
  interreg: 'interreg',
  life_plus: 'life_plus',
  pocidif: 'pocidif',
  pnrr: 'pnrr',
};

export async function POST(request: NextRequest) {
  return withAIAuth(request, async (user) => {
    try {
      const body = await request.json();
      const parsed = generateProposalSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          Errors.validation('body', 'Date invalide', 'Invalid input').toResponse(),
          { status: 400 }
        );
      }

      const selectedProgram = parsed.data.fundingProgram ?? parsed.data.programType ?? 'general';
      const programType = PROGRAM_MAP[selectedProgram] ?? 'general';
      const locale: 'ro' | 'en' = parsed.data.locale === 'en' ? 'en' : 'ro';
      const proposalInput = {
        projectIdea: parsed.data.projectIdea ?? parsed.data.businessDescription ?? '',
        programType,
        organizationType: parsed.data.organizationType ?? 'company',
        organizationName: parsed.data.organizationName ?? 'Applicant Organization',
        organizationCountry: 'RO',
        sector: parsed.data.sector,
        budget: parsed.data.budget,
        duration: parsed.data.duration,
        locale,
        includeComplianceCheck: true,
      };

      const result = await generateEnhancedProposal(proposalInput);

      await logAudit({
        userId: user.id,
        action: 'ai.generate',
        resourceType: 'proposal_enhanced',
        metadata: {
          fundingProgram: selectedProgram,
          tokensUsed: result.tokensUsed,
          ragSourcesUsed: result.ragSourcesUsed,
          userTier: user.tier,
        },
      });

      return NextResponse.json({
        success: true,
        data: {
          proposal: result.proposal,
          compliance: result.compliance,
          metadata: {
            tokensUsed: result.tokensUsed,
            ragSourcesUsed: result.ragSourcesUsed,
            generatedAt: new Date().toISOString(),
            mode: 'enhanced',
          },
        },
      });
    } catch (error) {
      if (error instanceof FondEUError) {
        return NextResponse.json(error.toResponse(), { status: error.statusCode });
      }
      logger.error({ error: error }, '[generate-proposal-enhanced]');
      return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
    }
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { withAIAuth } from '@/lib/middleware/auth';
import { db } from '@/lib/db';
import { callsForProposals } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { generateProposal } from '@/lib/ai/proposal-generator';
import { wizardGenerateProjectSchema } from '@/lib/validation/schemas';
import { Errors, FondEUError } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';
import { factCheckGeneratedContent } from '@/lib/ai/fact-checker';

const log = logger.child({ component: 'wizard-generate-project' });

const PROGRAM_MAP: Record<string, 'horizon_europe' | 'interreg' | 'life_plus' | 'pocidif' | 'pnrr' | 'general'> = {
  'HORIZON-EUROPE': 'horizon_europe',
  'LIFE-PLUS': 'life_plus',
  'INTERREG-VI': 'interreg',
  POCIDIF: 'pocidif',
  PNRR: 'pnrr',
};

export async function POST(req: NextRequest) {
  return withAIAuth(req, async (user) => {
    try {
      const body = await req.json();
      const parsed = wizardGenerateProjectSchema.safeParse(body);
      
      if (!parsed.success) {
        throw Errors.validation('body', 'Date invalide', 'Invalid input');
      }

      const { projectIdea, callId, organization, locale } = parsed.data;

      // 1. Fetch full call details
      const call = await db.query.callsForProposals.findFirst({
        where: eq(callsForProposals.id, callId),
        with: {
          program: true,
        }
      });

      if (!call) {
        throw Errors.notFound('call', callId);
      }

      // 2. Generate full proposal
      const proposal = await generateProposal({
        projectIdea,
        programType: PROGRAM_MAP[call.program.code] ?? 'general',
        organizationName: organization.orgName,
        organizationType: organization.orgType,
        sector: organization.sector,
        locale,
        callId,
      });
      const factCheck = factCheckGeneratedContent(proposal.proposal, {
        expectedProgram: PROGRAM_MAP[call.program.code] ?? 'general',
      });

      await logAudit({
        userId: user.id,
        action: 'ai.wizard_generate',
        resourceType: 'ai_wizard',
        metadata: { callId, locale, tokensUsed: proposal.tokensUsed },
      });

      return NextResponse.json({
        success: true,
        data: {
          proposal: factCheck.annotated,
          metadata: {
            tokensUsed: proposal.tokensUsed,
            ragSourcesUsed: proposal.ragSourcesUsed,
            factCheck: {
              confidenceScore: factCheck.confidenceScore,
              references: factCheck.references,
              unverifiableClaims: factCheck.unverifiableClaims,
            },
          },
        },
      });

    } catch (error) {
      if (error instanceof FondEUError) {
        return NextResponse.json(error.toResponse(), { status: error.statusCode });
      }
      log.error({ error }, '[wizard:generate] error');
      return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
    }
  }, { feature: 'proposal' });
}

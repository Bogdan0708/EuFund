import { NextRequest, NextResponse } from 'next/server';
import { withAIAuth } from '@/lib/middleware/auth';
import { wizardGenerateProjectSchema } from '@/lib/validation/schemas';
import { Errors, FondEUError } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';
import { generateProjectProposal } from '@/lib/ai/wizard-actions';
import { assertTier } from '@/lib/middleware/tier-gate';

const log = logger.child({ component: 'wizard-generate-project' });

export async function POST(req: NextRequest) {
  return withAIAuth(req, async (user) => {
    try {
      assertTier(user.tier, 'pro');

      const body = await req.json();
      const parsed = wizardGenerateProjectSchema.safeParse(body);

      if (!parsed.success) {
        throw Errors.validation('body', 'Date invalide', 'Invalid input');
      }

      const { projectIdea, callId, organization, locale } = parsed.data;

      const result = await generateProjectProposal(
        projectIdea,
        callId,
        organization,
        locale,
      );

      await logAudit({
        userId: user.id,
        action: 'ai.wizard_generate',
        resourceType: 'ai_wizard',
        metadata: { callId, locale, tokensUsed: result.metadata.tokensUsed },
      });

      return NextResponse.json({
        success: true,
        data: {
          proposal: result.proposal,
          metadata: result.metadata,
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

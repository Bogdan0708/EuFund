import { NextRequest, NextResponse } from 'next/server';
import { withAIAuth } from '@/lib/middleware/auth';
import { wizardMatchCallsSchema } from '@/lib/validation/schemas';
import { Errors, FondEUError } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';
import { matchFundingCalls } from '@/lib/ai/wizard-actions';

const log = logger.child({ component: 'wizard-match-calls' });

export async function POST(req: NextRequest) {
  return withAIAuth(req, async (user) => {
    try {
      const body = await req.json();
      const parsed = wizardMatchCallsSchema.safeParse(body);

      if (!parsed.success) {
        throw Errors.validation('body', 'Date invalide', 'Invalid input');
      }

      const { projectIdea, organization, budget, locale } = parsed.data;

      const result = await matchFundingCalls(
        projectIdea,
        organization,
        budget,
        locale,
        user.id,
      );

      await logAudit({
        userId: user.id,
        action: 'ai.wizard_match',
        resourceType: 'ai_wizard',
        metadata: { matchesFound: result.matches.length, locale },
      });

      return NextResponse.json({
        success: true,
        data: result,
      });

    } catch (error) {
      if (error instanceof FondEUError) {
        return NextResponse.json(error.toResponse(), { status: error.statusCode });
      }
      log.error({ error }, '[wizard:match] error');
      return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
    }
  }, { feature: 'grant' });
}

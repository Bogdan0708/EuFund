import { NextRequest, NextResponse } from 'next/server';
import { withAIAuth } from '@/lib/middleware/auth';
import { enhanceIdeaSchema } from '@/lib/validation/schemas';
import { Errors, FondEUError } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';
import { enhanceProjectIdea } from '@/lib/ai/wizard-actions';
import { assertTier } from '@/lib/middleware/tier-gate';

const log = logger.child({ component: 'wizard-enhance-idea' });

export async function POST(req: NextRequest) {
  return withAIAuth(req, async (user) => {
    try {
      assertTier(user.tier, 'pro');

      const body = await req.json();
      const parsed = enhanceIdeaSchema.safeParse(body);

      if (!parsed.success) {
        throw Errors.validation('body', 'Date invalide', 'Invalid input');
      }

      const { projectIdea, locale } = parsed.data;

      const result = await enhanceProjectIdea(projectIdea, locale);

      await logAudit({
        userId: user.id,
        action: 'ai.wizard_enhance',
        resourceType: 'ai_wizard',
        metadata: { length: projectIdea.length, locale },
      });

      return NextResponse.json({
        success: true,
        data: result,
      });

    } catch (error) {
      if (error instanceof FondEUError) {
        return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
      }
      log.error({ error }, '[wizard:enhance] error');
      return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
    }
  }, { feature: 'proposal' });
}

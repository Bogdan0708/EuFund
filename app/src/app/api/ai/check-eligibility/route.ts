import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { Errors, FondEUError } from '@/lib/errors';
import { checkEligibilitySchema } from '@/lib/validation/schemas';
import { runEligibilityRules } from '@/lib/rules/eligibility';
import { logAudit } from '@/lib/legal/audit';
import { trackRequest } from '@/lib/monitoring/metrics';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'check-eligibility' });
export const dynamic = 'force-dynamic';

/**
 * POST /api/ai/check-eligibility
 * Deterministic eligibility pre-filter — no AI call, no AI rate limit.
 * Returns instant eligibility results (<200ms target).
 */
export async function POST(req: NextRequest) {
  const start = Date.now();
  try {
    const session = await auth();
    if (!session?.user?.id) {
      throw Errors.unauthorized();
    }

    const body = await req.json();
    const parsed = checkEligibilitySchema.safeParse(body);
    if (!parsed.success) {
      throw Errors.validation(
        'body',
        'Datele de eligibilitate sunt invalide.',
        'Eligibility data is invalid.',
      );
    }

    const { results, score, passCount, failCount, warningCount } = runEligibilityRules(parsed.data);
    const isEligible = failCount === 0;

    await logAudit({
      userId: session.user.id,
      action: 'ai.compliance_check',
      resourceType: 'eligibility_check',
      metadata: { score, isEligible, failCount, warningCount },
    });

    const response = NextResponse.json({
      success: true,
      data: {
        results,
        score,
        passCount,
        failCount,
        warningCount,
        isEligible,
        checkedAt: new Date().toISOString(),
      },
    });

    trackRequest(req.method, '/api/ai/check-eligibility', 200, Date.now() - start);
    return response;
  } catch (error) {
    const status = error instanceof FondEUError ? error.statusCode : 500;
    trackRequest(req.method, '/api/ai/check-eligibility', status, Date.now() - start);

    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[check-eligibility] POST error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

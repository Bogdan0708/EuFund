// ─── POST /api/ai/forecast-lifecycle ─────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { predictLifecycle, type LifecyclePredictionInput } from '@/lib/ai/lifecycle-prediction';
import { FondEUError, Errors } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { withAIAuth } from '@/lib/middleware/auth';
import { forecastLifecycleSchema } from '@/lib/validation/schemas';
import { logger } from '@/lib/logger';
import { sanitizeAIResponseDeep } from '@/lib/ai/sanitize';

export async function POST(request: NextRequest) {
  return withAIAuth(request, async (user) => {
  try {
    const body = await request.json();
    const parsed = forecastLifecycleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(Errors.validation('body', 'Date invalide', 'Invalid input').toResponse(), { status: 400 });
    }

    const { projectId, parameters } = parsed.data;
    const input = {
      projectId,
      ...parameters,
    } as LifecyclePredictionInput;

    const requiredFields: Array<keyof LifecyclePredictionInput> = [
      'projectTitle',
      'programType',
      'totalBudget',
      'spentBudget',
      'durationMonths',
      'elapsedMonths',
      'startDate',
      'endDate',
      'milestones',
      'partners',
    ];
    const missing = requiredFields.filter((field) => input[field] === undefined);
    if (missing.length > 0) {
      return NextResponse.json(
        Errors.validation('parameters', `Lipsesc câmpuri obligatorii: ${missing.join(', ')}`, `Missing required fields: ${missing.join(', ')}`).toResponse(),
        { status: 400 }
      );
    }

    const result = await predictLifecycle(input);

    await logAudit({
      action: 'ai.generate',
      resourceType: 'lifecycle_prediction',
      userId: user.id,
      metadata: {
        projectId: input.projectId,
        health: result.overallProjectHealth,
        userTier: user.tier
      },
    });

    const { sanitized: data } = sanitizeAIResponseDeep(result);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof FondEUError) return NextResponse.json(error.toResponse(), { status: error.statusCode });
    logger.error({ error: error }, '[forecast-lifecycle]');
    return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
  }
  });
}

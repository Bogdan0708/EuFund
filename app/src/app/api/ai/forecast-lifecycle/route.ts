// ─── POST /api/ai/forecast-lifecycle ─────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { predictLifecycle, quickLifecycleCheck } from '@/lib/ai/lifecycle-prediction';
import { FondEUError, Errors } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { withAIAuth } from '@/lib/middleware/auth';

const inputSchema = z.object({
  projectId: z.string(),
  projectTitle: z.string(),
  programType: z.string(),
  totalBudget: z.number().positive(),
  spentBudget: z.number().min(0),
  durationMonths: z.number().positive(),
  elapsedMonths: z.number().min(0),
  startDate: z.string(),
  endDate: z.string(),
  milestones: z.array(z.object({
    id: z.string(),
    name: z.string(),
    dueDate: z.string(),
    status: z.enum(['completed', 'in_progress', 'not_started', 'delayed']),
    completionPercentage: z.number(),
    responsiblePartner: z.string(),
    dependencies: z.array(z.string()).optional(),
  })),
  partners: z.array(z.object({
    name: z.string(),
    country: z.string(),
    allocatedBudget: z.number(),
    spentBudget: z.number(),
    deliverablesCompleted: z.number(),
    deliverablesTotal: z.number(),
    reportingOnTime: z.boolean(),
  })),
  recentIssues: z.array(z.string()).optional(),
  quick: z.boolean().optional(),
  locale: z.enum(['ro', 'en']).optional(),
});

export async function POST(request: NextRequest) {
  return withAIAuth(request, async (user) => {
  try {
    const body = await request.json();
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(Errors.validation('body', 'Date invalide', 'Invalid input').toResponse(), { status: 400 });
    }

    const input = parsed.data as any;

    if (input.quick) {
      const result = quickLifecycleCheck(input);
      return NextResponse.json({ success: true, data: result });
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

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof FondEUError) return NextResponse.json(error.toResponse(), { status: error.statusCode });
    console.error('[forecast-lifecycle]', error);
    return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
  }
  });
}

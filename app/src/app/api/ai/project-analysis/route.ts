import { withAIAuth } from '@/lib/middleware/auth';
// ─── Project Analysis API ────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { analyzeProject, getProjectHealthQuick, type ProjectAnalysisRequest } from '@/lib/ai/project-intelligence';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { sanitizeAIResponseDeep } from '@/lib/ai/sanitize';

const quickAnalysisSchema = z.object({
  mode: z.literal('quick'),
  projectId: z.string(),
  projectTitle: z.string(),
  workPackages: z.array(z.object({
    id: z.string(),
    name: z.string(),
    plannedStart: z.string(),
    plannedEnd: z.string(),
    progress: z.number(),
    dependencies: z.array(z.string()),
    budget: z.number(),
    spent: z.number(),
    deliverables: z.array(z.object({
      name: z.string(),
      completed: z.boolean(),
      dueDate: z.string(),
    })),
  })),
  deadline: z.string(),
  budget: z.number(),
  spentBudget: z.number(),
});

const fullAnalysisSchema = z.object({
  mode: z.literal('full'),
  projectId: z.string(),
  projectTitle: z.string(),
  projectSummary: z.string(),
  programType: z.string(),
  budget: z.number(),
  spentBudget: z.number(),
  durationMonths: z.number(),
  elapsedMonths: z.number(),
  startDate: z.string(),
  endDate: z.string(),
  submissionDeadline: z.string().optional(),
  workPackages: z.array(z.any()),
  partners: z.array(z.any()),
  organization: z.object({
    type: z.string(),
    country: z.string(),
    region: z.string().optional(),
    size: z.string().optional(),
  }),
  locale: z.enum(['ro', 'en']).optional(),
});

export async function POST(request: NextRequest) {
  return withAIAuth(request, async () => {
  try {
    const body = await request.json();

    if (body.mode === 'quick') {
      const parsed = quickAnalysisSchema.parse(body);
      const result = getProjectHealthQuick(
        parsed.projectId,
        parsed.projectTitle,
        parsed.workPackages,
        parsed.deadline,
        parsed.budget,
        parsed.spentBudget,
      );
      const { sanitized: data } = sanitizeAIResponseDeep(result);
      return NextResponse.json({ success: true, data });
    }

    const parsed = fullAnalysisSchema.parse(body);
    const result = await analyzeProject(parsed as ProjectAnalysisRequest);
    const { sanitized: data } = sanitizeAIResponseDeep(result);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input' } },
        { status: 400 },
      );
    }
    logger.error({ error: error }, 'Project analysis error:');
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Analysis failed' } },
      { status: 500 },
    );
  }
});
}

import { withAIAuth } from '@/lib/middleware/auth';
// ─── Project Analysis API ────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { analyzeProject, getProjectHealthQuick, type ProjectAnalysisRequest } from '@/lib/ai/project-intelligence';
import { z } from 'zod';

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
  return withAIAuth(request, async (user) => {
  try {
    const body = await request.json();

    if (body.mode === 'quick') {
      const parsed = quickAnalysisSchema.parse(body);
      const result = getProjectHealthQuick(
        parsed.projectId,
        parsed.projectTitle,
        parsed.workPackages as any,
        parsed.deadline,
        parsed.budget,
        parsed.spentBudget,
      );
      return NextResponse.json(result);
    }

    const parsed = fullAnalysisSchema.parse(body);
    const result = await analyzeProject(parsed as any as ProjectAnalysisRequest);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.issues }, { status: 400 });
    }
    console.error('Project analysis error:', error);
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 });
  }
});
}

import { withAIAuth } from '@/lib/middleware/auth';
// ─── Project Health Monitoring API ───────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { getProjectHealthQuick } from '@/lib/ai/project-intelligence';
import { z } from 'zod';
import { logger } from '@/lib/logger';

const healthSchema = z.object({
  projectId: z.string(),
  projectTitle: z.string(),
  mode: z.enum(['quick', 'advanced']).default('quick'),
  // Quick mode fields
  workPackages: z.array(z.object({
    id: z.string(),
    name: z.string(),
    plannedStart: z.string(),
    plannedEnd: z.string(),
    progress: z.number(),
    dependencies: z.array(z.string()),
    budget: z.number(),
    spent: z.number(),
    deliverables: z.array(z.object({ name: z.string(), dueDate: z.string(), status: z.string() })).default([]),
  })).default([]),
  deadline: z.string().optional(),
  budget: z.number().default(0),
  spentBudget: z.number().default(0),
  // Advanced mode supplementary data
  timelineData: z.object({
    criticalPath: z.array(z.string()),
    bottlenecks: z.number(),
    feasibilityScore: z.number(),
  }).optional(),
  consortiumData: z.object({
    overallScore: z.number(),
    atRiskPartners: z.number(),
    partnerCount: z.number(),
  }).optional(),
  budgetData: z.object({
    overallHealth: z.number(),
    burnRate: z.number(),
    forecastAccuracy: z.number(),
  }).optional(),
});

export async function GET(request: NextRequest) {
  return withAIAuth(request, async () => {
    const req = request;
  const projectId = req.nextUrl.searchParams.get('projectId');
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }
  // Placeholder - in production would fetch from database
  return NextResponse.json({ success: true, data: { status: 'Use POST for full health analysis', projectId } });
});
}

export async function POST(request: NextRequest) {
  return withAIAuth(request, async () => {
    const req = request;
  try {
    const body = await req.json();
    const parsed = healthSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, { status: 400 });
    }

    const { mode, projectId, projectTitle, workPackages, deadline, budget, spentBudget } = parsed.data;

    const normalizedWorkPackages = workPackages.map((workPackage) => ({
      ...workPackage,
      deliverables: workPackage.deliverables.map((deliverable) => ({
        name: deliverable.name,
        dueDate: deliverable.dueDate,
        completed: deliverable.status === 'completed',
      })),
    }));

    if (mode === 'quick') {
      const result = getProjectHealthQuick(projectId, projectTitle, normalizedWorkPackages, deadline ?? '', budget, spentBudget);
      return NextResponse.json({ success: true, data: result });
    }

    // Advanced mode - would need full ProjectAnalysisRequest; for now return quick + supplementary
    const quickHealth = getProjectHealthQuick(projectId, projectTitle, normalizedWorkPackages, deadline ?? '', budget, spentBudget);
    return NextResponse.json({
      success: true,
      data: {
        ...quickHealth,
        advancedMetrics: {
          timeline: parsed.data.timelineData,
          consortium: parsed.data.consortiumData,
          budget: parsed.data.budgetData,
        },
      },
    });
  } catch (error) {
    logger.error({ error: error }, 'Project health error:');
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Health analysis failed' } },
      { status: 500 },
    );
  }
});
}

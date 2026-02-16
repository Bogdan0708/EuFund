import { withAIAuth } from '@/lib/middleware/auth';
// ─── Project Health Monitoring API ───────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { getProjectHealthQuick, getAdvancedProjectHealth, analyzeProject, type ProjectAnalysisRequest } from '@/lib/ai/project-intelligence';
import { z } from 'zod';

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
  return withAIAuth(request, async (user) => {
    const req = request;
  const projectId = req.nextUrl.searchParams.get('projectId');
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }
  // Placeholder - in production would fetch from database
  return NextResponse.json({ status: 'Use POST for full health analysis', projectId });
});
}

export async function POST(request: NextRequest) {
  return withAIAuth(request, async (user) => {
    const req = request;
  try {
    const body = await req.json();
    const parsed = healthSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
    }

    const { mode, projectId, projectTitle, workPackages, deadline, budget, spentBudget } = parsed.data;

    if (mode === 'quick') {
      const result = getProjectHealthQuick(projectId, projectTitle, workPackages as any, deadline ?? '', budget, spentBudget);
      return NextResponse.json(result);
    }

    // Advanced mode - would need full ProjectAnalysisRequest; for now return quick + supplementary
    const quickHealth = getProjectHealthQuick(projectId, projectTitle, workPackages as any, deadline ?? '', budget, spentBudget);
    return NextResponse.json({
      ...quickHealth,
      advancedMetrics: {
        timeline: parsed.data.timelineData,
        consortium: parsed.data.consortiumData,
        budget: parsed.data.budgetData,
      },
    });
  } catch (error) {
    console.error('Project health error:', error);
    return NextResponse.json({ error: 'Health analysis failed' }, { status: 500 });
  }
});
}

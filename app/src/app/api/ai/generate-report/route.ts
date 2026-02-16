import { withAIAuth } from '@/lib/middleware/auth';
// ─── Report Generation API ───────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { generateReport, type ReportInput } from '@/lib/ai/reporting-engine';
import { z } from 'zod';

const reportSchema = z.object({
  projectId: z.string(),
  projectTitle: z.string(),
  reportType: z.enum(['periodic', 'final', 'interim', 'audit']),
  periodStart: z.string(),
  periodEnd: z.string(),
  budget: z.object({
    total: z.number(),
    spent: z.number(),
    coFinancingRate: z.number(),
    categories: z.array(z.object({ name: z.string(), allocated: z.number(), spent: z.number() })),
    partnerBudgets: z.array(z.object({ name: z.string(), country: z.string(), allocated: z.number(), spent: z.number() })),
    ronConversions: z.array(z.object({ amount: z.number(), rate: z.number() })).optional(),
  }),
  workPackages: z.array(z.object({
    id: z.string(),
    name: z.string(),
    leader: z.string(),
    progress: z.number(),
    tasksCompleted: z.number(),
    tasksTotal: z.number(),
    deliverables: z.array(z.object({ name: z.string(), dueDate: z.string(), status: z.string() })),
    description: z.string().optional(),
  })),
  milestones: z.array(z.object({ name: z.string(), dueDate: z.string(), status: z.string() })),
  risks: z.array(z.object({
    description: z.string(),
    category: z.string(),
    severity: z.string(),
    likelihood: z.string(),
    mitigation: z.string(),
    isNew: z.boolean().optional(),
    isClosed: z.boolean().optional(),
  })),
  partners: z.array(z.object({
    name: z.string(),
    country: z.string(),
    role: z.string(),
    budgetUtilization: z.number(),
    performanceScore: z.number(),
    deliverableStatus: z.string(),
    issues: z.array(z.string()),
  })),
  locale: z.enum(['ro', 'en']).default('en'),
});

export async function POST(request: NextRequest) {
  return withAIAuth(request, async (user) => {
    const req = request;
  try {
    const body = await req.json();
    const parsed = reportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
    }

    const result = await generateReport(parsed.data as ReportInput);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Report generation error:', error);
    return NextResponse.json({ error: 'Report generation failed' }, { status: 500 });
  }
});
}

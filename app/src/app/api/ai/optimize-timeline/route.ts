import { withAIAuth } from '@/lib/middleware/auth';
// ─── Timeline Optimization API ───────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { optimizeTimeline, analyzeScenario, quickFeasibilityCheck, type TimelineOptimizationInput, type WhatIfScenario } from '@/lib/ai/timeline-optimizer';
import { z } from 'zod';
import { logger } from '@/lib/logger';

const timelineSchema = z.object({
  projectId: z.string(),
  tasks: z.array(z.object({
    id: z.string(),
    name: z.string(),
    start: z.string(),
    end: z.string(),
    dependencies: z.array(z.string()),
    assignedResources: z.array(z.string()),
    workPackageId: z.string().optional(),
    percentComplete: z.number().optional(),
    isMilestone: z.boolean().optional(),
  })),
  resources: z.array(z.object({
    resourceId: z.string(),
    name: z.string(),
    role: z.string(),
    availability: z.number(),
    vacationDays: z.array(z.string()).optional(),
    maxConcurrentTasks: z.number().optional(),
  })).default([]),
  projectStart: z.string(),
  projectEnd: z.string(),
  includeRomanianHolidays: z.boolean().default(true),
  bureaucracyBufferPercent: z.number().default(15),
  locale: z.enum(['ro', 'en']).default('en'),
  scenario: z.object({
    name: z.string(),
    changes: z.array(z.object({
      type: z.enum(['delay-task', 'remove-task', 'add-task', 'change-resource', 'change-duration']),
      taskId: z.string().optional(),
      delayDays: z.number().optional(),
      newDuration: z.number().optional(),
      newResource: z.string().optional(),
    })),
  }).optional(),
});

export async function POST(request: NextRequest) {
  return withAIAuth(request, async (user) => {
    const req = request;
  try {
    const body = await req.json();
    const parsed = timelineSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, { status: 400 });
    }

    const input: TimelineOptimizationInput = parsed.data;

    if (parsed.data.scenario) {
      const scenarioResult = await analyzeScenario(input, parsed.data.scenario as WhatIfScenario);
      return NextResponse.json({ success: true, data: { scenario: scenarioResult } });
    }

    const result = await optimizeTimeline(input);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    logger.error({ error: error }, 'Timeline optimization error:');
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Timeline optimization failed' } },
      { status: 500 },
    );
  }
});
}

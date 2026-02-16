import { withAIAuth } from '@/lib/middleware/auth';
// ─── Deadline & Risk Assessment API ──────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { analyzeDeadlines, quickRiskCheck } from '@/lib/ai/deadline-intelligence';
import { assessRisk } from '@/lib/ai/risk-assessment';
import { z } from 'zod';
import { logger } from '@/lib/logger';

const deadlineSchema = z.object({
  type: z.enum(['deadline', 'risk', 'quick']),
  projectId: z.string(),
  projectTitle: z.string(),
  locale: z.enum(['ro', 'en']).optional(),
  // For deadline analysis
  submissionDeadline: z.string().optional(),
  projectStart: z.string().optional(),
  projectEnd: z.string().optional(),
  workPackages: z.array(z.any()).optional(),
  // For risk assessment
  project: z.any().optional(),
  partners: z.array(z.any()).optional(),
  compliance: z.any().optional(),
  romanianContext: z.any().optional(),
});

export async function POST(request: NextRequest) {
  return withAIAuth(request, async (user) => {
  try {
    const body = await request.json();
    const parsed = deadlineSchema.parse(body);

    if (parsed.type === 'quick') {
      const result = quickRiskCheck(
        parsed.workPackages || [],
        parsed.submissionDeadline || parsed.projectEnd || new Date().toISOString(),
      );
      return NextResponse.json({ success: true, data: result });
    }

    if (parsed.type === 'deadline') {
      const result = await analyzeDeadlines({
        projectId: parsed.projectId,
        projectTitle: parsed.projectTitle,
        submissionDeadline: parsed.submissionDeadline,
        projectStart: parsed.projectStart,
        projectEnd: parsed.projectEnd,
        workPackages: parsed.workPackages || [],
        locale: parsed.locale,
      });
      return NextResponse.json({ success: true, data: result });
    }

    if (parsed.type === 'risk') {
      const result = await assessRisk({
        project: parsed.project,
        workPackages: parsed.workPackages || [],
        partners: parsed.partners || [],
        compliance: parsed.compliance,
        romanianContext: parsed.romanianContext,
        locale: parsed.locale,
      });
      return NextResponse.json({ success: true, data: result });
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input' } },
        { status: 400 },
      );
    }
    logger.error({ error: error }, 'Risk assessment error:');
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Assessment failed' } },
      { status: 500 },
    );
  }
});
}

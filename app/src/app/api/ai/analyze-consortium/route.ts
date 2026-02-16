import { withAIAuth } from '@/lib/middleware/auth';
// ─── Consortium Analytics API ────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { analyzeConsortium, type ConsortiumAnalysisInput } from '@/lib/ai/consortium-analytics';
import { z } from 'zod';
import { logger } from '@/lib/logger';

const consortiumSchema = z.object({
  projectId: z.string(),
  partners: z.array(z.object({
    id: z.string(),
    name: z.string(),
    country: z.string(),
    type: z.enum(['university', 'research', 'sme', 'large-enterprise', 'ngo', 'public-body']),
    budget: z.object({ allocated: z.number(), spent: z.number(), currency: z.enum(['EUR', 'RON']) }),
    deliverables: z.array(z.object({
      id: z.string(),
      title: z.string(),
      dueDate: z.string(),
      submittedDate: z.string().optional(),
      status: z.enum(['pending', 'submitted', 'accepted', 'revision-needed', 'rejected']),
      qualityScore: z.number().optional(),
      revisionCount: z.number().optional(),
    })),
    tasks: z.array(z.object({
      id: z.string(),
      name: z.string(),
      plannedEnd: z.string(),
      actualEnd: z.string().optional(),
      status: z.enum(['not-started', 'in-progress', 'completed', 'delayed']),
    })),
    capabilities: z.array(z.string()),
    communicationLog: z.object({
      meetingsAttended: z.number(),
      totalMeetings: z.number(),
      avgResponseHours: z.number(),
      messagesExchanged: z.number(),
    }).optional(),
    romanianContext: z.object({
      isRomanian: z.boolean(),
      publicProcurementRequired: z.boolean(),
      anafRegistered: z.boolean(),
      sicapRegistered: z.boolean(),
    }).optional(),
  })),
  programType: z.string(),
  requiredCapabilities: z.array(z.string()),
  smeRequirementPercent: z.number().default(20),
  requiredCountries: z.number().default(3),
  locale: z.enum(['ro', 'en']).default('en'),
});

export async function POST(request: NextRequest) {
  return withAIAuth(request, async (user) => {
    const req = request;
  try {
    const body = await req.json();
    const parsed = consortiumSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, { status: 400 });
    }

    const result = await analyzeConsortium(parsed.data as ConsortiumAnalysisInput);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    logger.error({ error: error }, 'Consortium analysis error:');
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Consortium analysis failed' } },
      { status: 500 },
    );
  }
});
}

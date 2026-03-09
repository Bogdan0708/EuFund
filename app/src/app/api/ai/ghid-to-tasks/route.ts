import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAIAuth } from '@/lib/middleware/auth';
import { Errors, FondEUError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { generateComplianceTasksFromGhid } from '@/lib/compliance/ghid-task-generator';
import { logAudit } from '@/lib/legal/audit';
import { sanitizeAIResponseDeep } from '@/lib/ai/sanitize';
import { assertTier } from '@/lib/middleware/tier-gate';

const inputSchema = z.object({
  projectId: z.string().uuid(),
  ghidText: z.string().min(200).max(100_000),
});

export async function POST(request: NextRequest) {
  return withAIAuth(request, async (user) => {
    try {
      assertTier(user.tier, 'pro');

      const body = await request.json();
      const parsed = inputSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          Errors.validation('body', 'Date invalide', 'Invalid input').toResponse(),
          { status: 400 },
        );
      }

      const result = generateComplianceTasksFromGhid(parsed.data.projectId, parsed.data.ghidText);

      await logAudit({
        userId: user.id,
        action: 'ai.compliance_check',
        resourceType: 'project',
        resourceId: parsed.data.projectId,
        metadata: {
          generatedTasks: result.summary.total,
          highRisk: result.summary.highRisk,
          source: 'ghid_to_tasks',
        },
      });

      const { sanitized: data } = sanitizeAIResponseDeep(result);
      return NextResponse.json({
        success: true,
        data,
      });
    } catch (error) {
      if (error instanceof FondEUError) {
        return NextResponse.json(error.toResponse(), { status: error.statusCode });
      }
      logger.error({ error }, '[ghid-to-tasks]');
      return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
    }
  }, { feature: 'compliance' });
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { wizardSaveProjectSchema } from '@/lib/validation/schemas';
import { Errors, FondEUError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { saveWizardProject } from '@/lib/ai/wizard-actions';
import { ProposalOutput } from '@/lib/ai/proposal-generator';

const log = logger.child({ component: 'wizard-save-project' });

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const parsed = wizardSaveProjectSchema.safeParse(body);

    if (!parsed.success) {
      throw Errors.validation('body', 'Date invalide', 'Invalid input');
    }

    const { callId, orgId, proposal: p } = parsed.data;
    const proposal = p as ProposalOutput;

    const result = await saveWizardProject(callId, orgId, user.id, proposal);

    return NextResponse.json({
      success: true,
      data: {
        id: result.projectId,
        title: result.title,
      },
    });

  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse(), { status: error.statusCode });
    }
    log.error({ error }, '[wizard:save] error');
    return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
  }
}

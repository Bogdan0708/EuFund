// ─── POST /api/ai/generate-proposal ──────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { generateProposal, proposalInputSchema } from '@/lib/ai/proposal-generator';
import { FondEUError, Errors } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = proposalInputSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        Errors.validation('body', 'Date invalide', 'Invalid input').toResponse(),
        { status: 400 }
      );
    }

    const result = await generateProposal(parsed.data);

    // Audit log
    await logAudit({
      action: 'ai.generate',
      resourceType: 'proposal',
      metadata: {
        programType: parsed.data.programType,
        tokensUsed: result.tokensUsed,
        ragSourcesUsed: result.ragSourcesUsed,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        proposal: result.proposal,
        metadata: {
          tokensUsed: result.tokensUsed,
          ragSourcesUsed: result.ragSourcesUsed,
          generatedAt: new Date().toISOString(),
        },
      },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse(), { status: error.statusCode });
    }
    console.error('[generate-proposal]', error);
    return NextResponse.json(
      Errors.internal().toResponse(),
      { status: 500 }
    );
  }
}

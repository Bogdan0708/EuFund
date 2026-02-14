// ─── POST /api/ai/generate-proposal ──────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { generateProposal, proposalInputSchema } from '@/lib/ai/proposal-generator';
import { generateEnhancedProposal, type EnhancedProposalInput } from '@/lib/ai/enhanced-proposal-generator';
import { FondEUError, Errors } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Enhanced mode: if 'enhanced' flag is set, use new structured generator
    if (body.enhanced) {
      const input: EnhancedProposalInput = {
        projectIdea: body.projectIdea,
        programType: body.programType || 'general',
        organizationType: body.organizationType,
        organizationName: body.organizationName,
        organizationCountry: body.organizationCountry || 'Romania',
        organizationRegion: body.organizationRegion,
        organizationSize: body.organizationSize,
        sector: body.sector,
        caenCode: body.caenCode,
        budget: body.budget,
        duration: body.duration,
        partners: body.partners,
        trlLevel: body.trlLevel,
        objectives: body.objectives,
        includeComplianceCheck: body.includeComplianceCheck ?? true,
        locale: body.locale || 'ro',
      };

      const result = await generateEnhancedProposal(input);

      await logAudit({
        action: 'ai.generate',
        resourceType: 'enhanced_proposal',
        metadata: {
          programType: input.programType,
          tokensUsed: result.tokensUsed,
          ragSourcesUsed: result.ragSourcesUsed,
          complianceScore: result.compliance?.overallScore,
        },
      });

      return NextResponse.json({
        success: true,
        data: {
          proposal: result.proposal,
          compliance: result.compliance,
          programGuidance: result.programGuidance,
          metadata: {
            tokensUsed: result.tokensUsed,
            ragSourcesUsed: result.ragSourcesUsed,
            generatedAt: new Date().toISOString(),
            mode: 'enhanced',
          },
        },
      });
    }

    // Legacy mode: original generator
    const parsed = proposalInputSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        Errors.validation('body', 'Date invalide', 'Invalid input').toResponse(),
        { status: 400 }
      );
    }

    const result = await generateProposal(parsed.data);

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
          mode: 'standard',
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

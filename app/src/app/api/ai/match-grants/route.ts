// ─── POST /api/ai/match-grants ───────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { matchGrants, type FundingCall } from '@/lib/ai/grant-matcher';
import { FondEUError, Errors } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { withAIAuth } from '@/lib/middleware/auth';
import { matchGrantsSchema } from '@/lib/validation/schemas';

// Seed data for demo - in production this comes from the database
const DEMO_CALLS: FundingCall[] = [
  {
    id: 'call-001',
    callCode: 'HORIZON-CL4-2026-01',
    titleRo: 'Tranziția digitală a IMM-urilor europene',
    programName: 'Horizon Europe',
    eligibleTypes: ['srl', 'sa', 'ong'],
    budgetMin: 500000,
    budgetMax: 5000000,
    durationMin: 24,
    durationMax: 48,
    submissionEnd: '2026-09-15T17:00:00Z',
    status: 'deschis',
  },
  {
    id: 'call-002',
    callCode: 'LIFE-2026-ENV',
    titleRo: 'Proiecte de mediu și eficiență resurselor',
    programName: 'LIFE+',
    eligibleTypes: ['srl', 'sa', 'ong', 'uat', 'institutie_publica'],
    budgetMin: 1000000,
    budgetMax: 10000000,
    durationMin: 36,
    durationMax: 60,
    submissionEnd: '2026-10-01T17:00:00Z',
    status: 'deschis',
  },
  {
    id: 'call-003',
    callCode: 'INTERREG-RO-HU-2026',
    titleRo: 'Cooperare transfrontalieră România-Ungaria',
    programName: 'Interreg VI-A',
    eligibleTypes: ['srl', 'ong', 'uat', 'institutie_publica'],
    eligibleRegions: ['RO11', 'RO42'],
    budgetMin: 100000,
    budgetMax: 2000000,
    durationMin: 12,
    durationMax: 36,
    submissionEnd: '2026-06-30T17:00:00Z',
    status: 'deschis',
  },
  {
    id: 'call-004',
    callCode: 'POCIDIF-2026-OP1-01',
    titleRo: 'Digitalizare și inovare pentru competitivitate',
    descriptionRo: 'Sprijin pentru investiții în digitalizare, cercetare și inovare pentru IMM-uri din România.',
    programName: 'POCIDIF',
    eligibleTypes: ['srl', 'sa'],
    eligibleCaen: ['6201', '6202', '6311', '7112', '7211', '7219'],
    budgetMin: 200000,
    budgetMax: 3000000,
    cofinancingRate: 10,
    durationMin: 12,
    durationMax: 36,
    submissionEnd: '2026-12-15T17:00:00Z',
    status: 'deschis',
  },
];

export async function POST(request: NextRequest) {
  return withAIAuth(request, async (user) => {
    try {
      const body = await request.json();
      const parsed = matchGrantsSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          Errors.validation('body', 'Date invalide', 'Invalid input').toResponse(),
          { status: 400 }
        );
      }

      const { companyProfile } = parsed.data;
      const matcherInput = {
        projectIdea: `${companyProfile.sector} innovation initiative for ${companyProfile.companyName}`,
        organization: {
          orgType: companyProfile.companyType,
          employeeCount: companyProfile.employeeCount,
          annualRevenue: companyProfile.annualRevenue,
        },
        budget: Math.max(companyProfile.annualRevenue * 0.25, 100000),
        locale: 'ro' as const,
      };

      // In production, fetch calls from DB. For now use demo data.
      const result = await matchGrants(matcherInput, DEMO_CALLS);

      await logAudit({
        userId: user.id,
        action: 'ai.generate',
        resourceType: 'grant_match',
        metadata: {
          companyType: companyProfile.companyType,
          matchesFound: result.matches.length,
          tokensUsed: result.tokensUsed,
          userTier: user.tier,
        },
      });

      return NextResponse.json({
        success: true,
        data: {
          matches: result.matches,
          metadata: {
            tokensUsed: result.tokensUsed,
            callsEvaluated: DEMO_CALLS.length,
            matchedAt: new Date().toISOString(),
          },
        },
      });
    } catch (error) {
      if (error instanceof FondEUError) {
        return NextResponse.json(error.toResponse(), { status: error.statusCode });
      }
      console.error('[match-grants]', error);
      return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
    }
  });
}

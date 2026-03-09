// ─── POST /api/ai/match-grants ───────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { matchGrants, type FundingCall } from '@/lib/ai/grant-matcher';
import { FondEUError, Errors } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { withAIAuth } from '@/lib/middleware/auth';
import { withEUAIActCompliance } from '@/lib/ai/eu-ai-act';
import { matchGrantsSchema } from '@/lib/validation/schemas';
import { logger } from '@/lib/logger';
import { sanitizeAIResponseDeep } from '@/lib/ai/sanitize';

import { db } from '@/lib/db';
import { callsForProposals, fundingPrograms } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';

// Seed data for demo - used ONLY as a fallback if DB is empty
const DEMO_CALLS: FundingCall[] = [
  {
    id: 'demo-call-001',
    callCode: 'PNRR-DIGITAL-IMM-2026',
    titleRo: 'Digitalizare IMM în cadrul PNRR',
    programName: 'PNRR',
    eligibleTypes: ['srl', 'sa'],
    budgetMin: 50000,
    budgetMax: 500000,
    durationMin: 6,
    durationMax: 24,
    submissionEnd: '2026-12-31T23:59:59Z',
    status: 'deschis',
  },
  {
    id: 'demo-call-002',
    callCode: 'POCIDIF-TEH-2026',
    titleRo: 'Inovare tehnologică pentru competitivitate',
    programName: 'POCIDIF',
    eligibleTypes: ['srl', 'sa', 'ong'],
    budgetMin: 100000,
    budgetMax: 2000000,
    durationMin: 12,
    durationMax: 36,
    submissionEnd: '2026-11-30T23:59:59Z',
    status: 'previzionat',
  },
];

function isDemoModeEnabled(): boolean {
  return process.env.ALLOW_DEMO_CALLS === 'true';
}

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

      // Fetch active calls from DB (fallback to demo if unavailable)
      let dbCalls: Array<{
        id: string;
        callCode: string;
        titleRo: string;
        descriptionRo: string | null;
        programName: string;
        eligibleTypes: string[] | null;
        eligibleRegions: string[] | null;
        eligibleCaen: string[] | null;
        budgetMin: string | null;
        budgetMax: string | null;
        cofinancingRate: string | null;
        durationMin: number | null;
        durationMax: number | null;
        submissionEnd: Date | null;
        status: 'deschis' | 'previzionat' | 'in_evaluare' | 'inchis' | 'anulat' | null;
      }> = [];
      try {
        dbCalls = await db.select({
          id: callsForProposals.id,
          callCode: callsForProposals.callCode,
          titleRo: callsForProposals.titleRo,
          descriptionRo: callsForProposals.descriptionRo,
          programName: fundingPrograms.nameRo,
          eligibleTypes: callsForProposals.eligibleTypes,
          eligibleRegions: callsForProposals.eligibleRegions,
          eligibleCaen: callsForProposals.eligibleCaen,
          budgetMin: callsForProposals.budgetMin,
          budgetMax: callsForProposals.budgetMax,
          cofinancingRate: callsForProposals.cofinancingRate,
          durationMin: callsForProposals.durationMin,
          durationMax: callsForProposals.durationMax,
          submissionEnd: callsForProposals.submissionEnd,
          status: callsForProposals.status,
        })
          .from(callsForProposals)
          .innerJoin(fundingPrograms, eq(callsForProposals.programId, fundingPrograms.id))
          .where(inArray(callsForProposals.status, ['deschis', 'previzionat']))
          .limit(50);
      } catch (dbError) {
        logger.warn({ error: dbError, userId: user.id }, 'Calls query failed; using DEMO_CALLS fallback');
      }

      // Cast string decimals to numbers for the AI matcher
      const mappedCalls: FundingCall[] = dbCalls.map(c => ({
        id: c.id,
        callCode: c.callCode,
        titleRo: c.titleRo,
        descriptionRo: c.descriptionRo ?? undefined,
        programName: c.programName,
        eligibleTypes: c.eligibleTypes ?? undefined,
        eligibleRegions: c.eligibleRegions ?? undefined,
        eligibleCaen: c.eligibleCaen ?? undefined,
        budgetMin: c.budgetMin ? Number(c.budgetMin) : undefined,
        budgetMax: c.budgetMax ? Number(c.budgetMax) : undefined,
        cofinancingRate: c.cofinancingRate ? Number(c.cofinancingRate) : undefined,
        durationMin: c.durationMin ?? undefined,
        durationMax: c.durationMax ?? undefined,
        submissionEnd: c.submissionEnd ? c.submissionEnd.toISOString() : undefined,
        status: c.status ?? 'deschis',
      }));

      let callsToEvaluate = mappedCalls;
      let usingDemoFallback = false;

      if (callsToEvaluate.length === 0) {
        if (isDemoModeEnabled()) {
          usingDemoFallback = true;
          callsToEvaluate = DEMO_CALLS;
          logger.warn({ userId: user.id }, 'Empty calls database, ALLOW_DEMO_CALLS enabled; using demo calls');
        } else {
          logger.error({ userId: user.id }, 'Grant matching unavailable: no validated calls available');
          return NextResponse.json(
            {
              success: false,
              error: {
                code: 'CALL_DATA_UNAVAILABLE',
                message: 'Funding call data is temporarily unavailable. Please try again later.',
              },
            },
            { status: 503 },
          );
        }
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

      const runWithCompliance = withEUAIActCompliance<typeof matcherInput>(
        'match-grants',
        async (payload) => {
          const result = await matchGrants(payload, callsToEvaluate);
          const topScore = result.matches[0]?.overallScore ?? 0;
          return {
            result,
            confidence: Math.max(0.3, Math.min(0.95, topScore / 100)),
          };
        },
      );
      const execution = await runWithCompliance(matcherInput, user.id);
      const result = execution.result as Awaited<ReturnType<typeof matchGrants>>;

      await logAudit({
        userId: user.id,
        action: 'ai.generate',
        resourceType: 'grant_match',
        metadata: {
          companyType: companyProfile.companyType,
          matchesFound: result.matches.length,
          tokensUsed: result.tokensUsed,
          userTier: user.tier,
          isDemoFallback: usingDemoFallback,
        },
      });

      const { sanitized: matches } = sanitizeAIResponseDeep(result.matches);
      return NextResponse.json({
        success: true,
        data: {
          matches,
          metadata: {
            tokensUsed: result.tokensUsed,
            callsEvaluated: callsToEvaluate.length,
            matchedAt: new Date().toISOString(),
            aiAct: execution.metadata,
            isDemoFallback: usingDemoFallback,
          },
        },
      });
    } catch (error) {
      if (error instanceof FondEUError) {
        return NextResponse.json(error.toResponse(), { status: error.statusCode });
      }
      logger.error({ error: error }, '[match-grants]');
      return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
    }
  }, { feature: 'grant' });
}

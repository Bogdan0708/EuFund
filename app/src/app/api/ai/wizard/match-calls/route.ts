import { NextRequest, NextResponse } from 'next/server';
import { withAIAuth } from '@/lib/middleware/auth';
import { db } from '@/lib/db';
import { callsForProposals, fundingPrograms } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { matchGrants, type FundingCall } from '@/lib/ai/grant-matcher';
import { wizardMatchCallsSchema } from '@/lib/validation/schemas';
import { withEUAIActCompliance } from '@/lib/ai/eu-ai-act';
import { Errors, FondEUError } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'wizard-match-calls' });

export async function POST(req: NextRequest) {
  return withAIAuth(req, async (user) => {
    try {
      const body = await req.json();
      const parsed = wizardMatchCallsSchema.safeParse(body);
      
      if (!parsed.success) {
        throw Errors.validation('body', 'Date invalide', 'Invalid input');
      }

      const { projectIdea, organization, budget, locale } = parsed.data;

      // 1. Fetch real calls from DB
      const dbCalls = await db.select({
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

      const mappedCalls: FundingCall[] = dbCalls.map((c) => ({
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
        submissionStart: undefined,
        submissionEnd: c.submissionEnd ? c.submissionEnd.toISOString() : undefined,
        status: c.status ?? 'deschis',
      }));

      if (mappedCalls.length === 0) {
        return NextResponse.json({
          success: true,
          data: {
            matches: [],
            aiAct: null,
          },
        });
      }

      // 2. Perform AI matching with compliance
      const matcherInput = {
        projectIdea,
        organization,
        budget,
        locale,
      };

      const runWithCompliance = withEUAIActCompliance<typeof matcherInput>(
        'match-grants',
        async (payload) => {
          const result = await matchGrants(payload, mappedCalls);
          return {
            result,
            confidence: Math.max(0.3, Math.min(0.95, (result.matches[0]?.overallScore ?? 0) / 100)),
          };
        },
      );

      const execution = await runWithCompliance(matcherInput, user.id);
      const result = execution.result as Awaited<ReturnType<typeof matchGrants>>;

      await logAudit({
        userId: user.id,
        action: 'ai.wizard_match',
        resourceType: 'ai_wizard',
        metadata: { matchesFound: result.matches.length, locale },
      });

      return NextResponse.json({
        success: true,
        data: {
          matches: result.matches,
          aiAct: execution.metadata,
        },
      });

    } catch (error) {
      if (error instanceof FondEUError) {
        return NextResponse.json(error.toResponse(), { status: error.statusCode });
      }
      log.error({ error }, '[wizard:match] error');
      return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
    }
  }, { feature: 'grant' });
}

// ─── Grant Matcher ───────────────────────────────────────────────
// Matches project ideas against active funding calls using AI + rules

import { z } from 'zod';
import { aiGenerateObject } from './client';
import { runEligibility, type EligibilityInput } from './agent/services/eligibility';
import { logger } from '@/lib/logger';
import { analyzeRomanianContent } from './romanian-specialist';

// ─── Types ───────────────────────────────────────────────────────

export interface FundingCall {
  id: string;
  callCode: string;
  titleRo: string;
  program: string;
  summaryRo?: string | null;
  descriptionRo?: string | null;
  submissionEnd?: Date | null;
  status: string;
}

export interface MatchInput {
  projectIdea: string;
  organization: {
    orgType: string;
    orgSize?: string;
    caenPrimary?: string;
    caenSecondary?: string[];
    nutsRegion?: string;
    employeeCount?: number;
    annualRevenue?: number;
  };
  budget?: number;
  duration?: number;
  locale?: 'ro' | 'en';
}

export interface MatchResult {
  call: FundingCall;
  eligibilityScore: number;
  relevanceScore: number;
  overallScore: number;
  matchReason: string;
  recommendations: string[];
  // Metadata for transparency
  eligibilityFailures: string[];
}

export interface MatchGrantsResponse {
  matches: MatchResult[];
  tokensUsed: number;
  provider?: string;
  model?: string;
  tier?: string;
  cached?: boolean;
  romanianOptimized?: boolean;
  processingTime?: number;
}

// ─── AI Relevance Schema ────────────────────────────────────────

const relevanceSchema = z.object({
  matches: z.array(z.object({
    callId: z.string(),
    relevanceScore: z.number().min(0).max(100),
    matchReason: z.string(),
    recommendations: z.array(z.string()),
  })),
});

const log = logger.child({ component: 'grant-matcher' });

// ─── Matcher Implementation ──────────────────────────────────────

export async function matchGrants(
  input: MatchInput,
  availableCalls: FundingCall[]
): Promise<MatchGrantsResponse> {
  const startTime = performance.now();
  const isRo = input.locale !== 'en';

  if (availableCalls.length === 0) {
    return { matches: [], tokensUsed: 0, processingTime: 0 };
  }

  // Step 1: Pre-filter by deterministic eligibility (parallel)
  const eligibilityResults = await Promise.all(
    availableCalls.map(async (call) => {
      try {
        const eligInput: EligibilityInput = {
          organization: input.organization,
          project: {
            totalBudget: input.budget,
            durationMonths: input.duration,
          }
        };
        // Mocking service context for the internal call
        const serviceCtx = { userId: 'system', sessionId: 'matching', requestId: 'internal', now: new Date() };
        const decision = await runEligibility(serviceCtx, eligInput, call.id);
        return { callId: call.id, decision };
      } catch (err) {
        log.warn({ err, callId: call.id }, 'Eligibility check failed for call during matching');
        return { callId: call.id, decision: null };
      }
    })
  );

  // Keep only viable calls (at least partial pass)
  const viable = availableCalls.filter(call => {
    const res = eligibilityResults.find(r => r.callId === call.id);
    return !res || !res.decision || res.decision.failCount === 0;
  });

  if (viable.length === 0) {
    return { 
      matches: [], 
      tokensUsed: 0, 
      processingTime: Number((performance.now() - startTime).toFixed(2)) 
    };
  }

  // Step 2: Romanian Specialization
  const romanianAnalysis = isRo ? await analyzeRomanianContent({
    content: input.projectIdea,
    context: 'grant_matching',
    additionalContext: {
      organizationType: input.organization.orgType,
      budget: input.budget,
      availableCallsCount: viable.length
    }
  }) : null;

  // Step 3: AI Relevance Scoring
  const systemPrompt = isRo
    ? `Ești un expert în fonduri europene în România. Evaluezi potrivirea dintre ideea de proiect a unui solicitant și apelurile de finanțare active. Oferi scoruri de relevanță (0-100) și recomandări concrete.`
    : `You are an EU funding expert. Evaluate the relevance between a project idea and active funding calls. Provide relevance scores (0-100) and concrete recommendations.`;

  const callsContext = viable.map(c => 
    `ID: ${c.id}\nCod: ${c.callCode}\nTitlu: ${c.titleRo}\nProgram: ${c.program}\nSumar: ${c.summaryRo || c.descriptionRo || 'N/A'}`
  ).join('\n\n---\n\n');

  const prompt = isRo
    ? `Evaluează potrivirea ideii de proiect cu apelurile de mai jos.

Idee Proiect: ${input.projectIdea}
Organizație: ${input.organization.orgType}
Buget estimat: ${input.budget || 'Nespecificat'} EUR

Apeluri active:
${callsContext}

Returnează scorul de relevanță (0-100), motivul potrivirii și recomandări pentru fiecare apel.`
    : `Evaluate project relevance for the following calls.

Project Idea: ${input.projectIdea}
Organization: ${input.organization.orgType}
Estimated Budget: ${input.budget || 'Unspecified'} EUR

Active Calls:
${callsContext}

Return relevance scores (0-100), match reasons and recommendations.`;

  const { object: aiResult, tokensUsed, provider, model, tier, cached, romanianOptimized } = await aiGenerateObject({
    system: systemPrompt,
    prompt,
    schema: relevanceSchema,
    schemaName: 'GrantRelevance',
    temperature: 0.3,
    taskType: 'grant_matching',
    romanianContext: romanianAnalysis?.context,
  });

  // Step 4: Combine results
  const matches: MatchResult[] = (aiResult?.matches || []).map(aiMatch => {
    const call = viable.find(c => c.id === aiMatch.callId)!;
    const elig = eligibilityResults.find(r => r.callId === aiMatch.callId)?.decision;
    
    const eligibilityScore = elig?.score ?? 100;
    const relevanceScore = aiMatch.relevanceScore;
    
    // Weighted overall score: 40% eligibility, 60% relevance
    const overallScore = Math.round(eligibilityScore * 0.4 + relevanceScore * 0.6);
    
    return {
      call,
      eligibilityScore,
      relevanceScore,
      overallScore,
      matchReason: aiMatch.matchReason,
      recommendations: aiMatch.recommendations,
      eligibilityFailures: elig?.results.filter(r => r.status === 'fail').map(r => r.messageRo) ?? [],
    };
  });

  // Sort by overall score
  matches.sort((a, b) => b.overallScore - a.overallScore);

  return {
    matches,
    tokensUsed,
    provider,
    model,
    tier,
    cached,
    romanianOptimized,
    processingTime: Number((performance.now() - startTime).toFixed(2)),
  };
}

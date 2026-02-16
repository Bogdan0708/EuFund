// ─── Legal Compliance Validator ──────────────────────────────────
// Combines deterministic rules + AI validation for compliance checking

import { z } from 'zod';
import { aiGenerateObject } from './client';
import { runEligibilityRules, type RuleContext, type RuleResult } from '@/lib/rules/eligibility';
import { hybridSearch } from '@/lib/rag/pipeline';

// ─── Types ───────────────────────────────────────────────────────

export interface ComplianceInput {
  project: {
    title: string;
    summary?: string;
    objectives?: string;
    methodology?: string;
    budget?: number;
    ownContrib?: number;
    durationMonths?: number;
  };
  organization: {
    orgType: string;
    orgSize?: string;
    caenPrimary?: string;
    caenSecondary?: string[];
    nutsRegion?: string;
    employeeCount?: number;
    annualRevenue?: number;
  };
  call?: {
    eligibleTypes?: string[];
    eligibleRegions?: string[];
    eligibleCaen?: string[];
    budgetMin?: number;
    budgetMax?: number;
    cofinancingRate?: number;
    durationMin?: number;
    durationMax?: number;
    submissionEnd?: string;
  };
  locale?: 'ro' | 'en';
}

export interface ComplianceResult {
  overallScore: number;
  deterministicResults: RuleResult[];
  aiResults: AIComplianceCheck[];
  ragSources: number;
  tokensUsed: number;
  recommendations: string[];
}

// ─── AI Compliance Schema ────────────────────────────────────────

const aiComplianceSchema = z.object({
  checks: z.array(z.object({
    area: z.string(),
    status: z.enum(['pass', 'fail', 'warning']),
    finding: z.string(),
    recommendation: z.string(),
    legalReference: z.string().optional(),
  })),
  overallAssessment: z.string(),
  recommendations: z.array(z.string()),
});

type AIComplianceCheck = z.infer<typeof aiComplianceSchema>['checks'][number];

// ─── Validator ───────────────────────────────────────────────────

export async function validateCompliance(input: ComplianceInput): Promise<ComplianceResult> {
  const isRo = input.locale !== 'en';

  // Step 1: Deterministic rules
  const ruleCtx: RuleContext = {
    organization: input.organization,
    project: {
      totalBudget: input.project.budget,
      ownContrib: input.project.ownContrib,
      durationMonths: input.project.durationMonths,
    },
    call: input.call ?? {},
  };

  const { results: deterministicResults, score: ruleScore } = runEligibilityRules(ruleCtx);

  // Step 2: RAG - find relevant regulations
  const ragQuery = `${input.project.title} ${input.project.summary || ''} eligibilitate conformitate`;
  const ragResults = await hybridSearch({
    query: ragQuery,
    locale: input.locale,
    topK: 3,
  });

  const ragContext = ragResults.length > 0
    ? ragResults.map((r, i) => `[Sursa ${i + 1}] ${r.content.substring(0, 500)}`).join('\n\n')
    : '';

  // Step 3: AI compliance check
  const systemPrompt = isRo
    ? `Ești un expert în conformitate juridică pentru fonduri europene. Verifici proiecte din perspectiva:
- Regulamentului CPR (2021/1060)
- Regulilor de ajutor de stat
- Eligibilitate cheltuieli
- GDPR și protecția datelor
- Legislația românească relevantă (OUG, HG)
Oferă evaluări concrete și referințe juridice.${ragContext ? `\n\nContext legislativ relevant:\n${ragContext}` : ''}`
    : `You are an EU funding legal compliance expert. Check projects for:
- CPR Regulation (2021/1060)
- State aid rules
- Expenditure eligibility
- GDPR and data protection
- Relevant Romanian legislation
Provide concrete assessments and legal references.${ragContext ? `\n\nRelevant legal context:\n${ragContext}` : ''}`;

  const prompt = isRo
    ? `Verifică conformitatea următorului proiect:

Titlu: ${input.project.title}
${input.project.summary ? `Rezumat: ${input.project.summary}` : ''}
${input.project.objectives ? `Obiective: ${input.project.objectives}` : ''}
${input.project.methodology ? `Metodologie: ${input.project.methodology}` : ''}
Organizație: ${input.organization.orgType}${input.organization.orgSize ? ` (${input.organization.orgSize})` : ''}
${input.project.budget ? `Buget: ${input.project.budget} EUR` : ''}
${input.project.durationMonths ? `Durată: ${input.project.durationMonths} luni` : ''}

Verifică toate aspectele de conformitate și oferă recomandări.`
    : `Check compliance for the following project:

Title: ${input.project.title}
${input.project.summary ? `Summary: ${input.project.summary}` : ''}
Organization: ${input.organization.orgType}
${input.project.budget ? `Budget: ${input.project.budget} EUR` : ''}

Check all compliance aspects and provide recommendations.`;

  const { object: aiResult, tokensUsed } = await aiGenerateObject({
    system: systemPrompt,
    prompt,
    schema: aiComplianceSchema,
    schemaName: 'ComplianceCheck',
    temperature: 0.2,
  });

  // Combine scores: 50% deterministic, 50% AI
  const aiPassRate = aiResult.checks.length > 0
    ? aiResult.checks.filter((c) => c.status === 'pass').length / aiResult.checks.length * 100
    : 100;

  const overallScore = Math.round(ruleScore * 0.5 + aiPassRate * 0.5);

  return {
    overallScore,
    deterministicResults,
    aiResults: aiResult.checks,
    ragSources: ragResults.length,
    tokensUsed,
    recommendations: aiResult.recommendations,
  };
}

// ─── Legal Compliance Validator ──────────────────────────────────
// Combines deterministic rules + AI validation for compliance checking

import { z } from 'zod';
import { aiGenerateObject } from './client';
import { runEligibilityRules, type RuleContext, type RuleResult } from '@/lib/rules/eligibility';
import { hybridSearch } from '@/lib/rag/pipeline';
import { assessDNSH, type DNSHAssessment } from '@/lib/rules/dnsh';
import { analyzeRomanianContent } from './romanian-specialist';
import { AI_INPUT_LIMITS, buildBoundaryInstruction, extractPromptBoundaries, sanitizeForAI } from './sanitize';

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
  dnshAssessment: DNSHAssessment;
  ragSources: number;
  sourceTrace: ComplianceSourceTrace[];
  tokensUsed: number;
  recommendations: string[];
  evaluatedAt: string;
  // NEW: Multi-provider metadata
  provider?: string;
  model?: string;
  tier?: string;
  romanianOptimized?: boolean;
}

// ─── AI Compliance Schema ────────────────────────────────────────

export interface ComplianceSourceTrace {
  sourceIndex: number;
  sourceId: string;
  title: string;
  sourceUrl?: string;
  snippet: string;
  score: number;
}

const aiComplianceSchema = z.object({
  checks: z.array(z.object({
    area: z.string(),
    status: z.enum(['pass', 'fail', 'warning']),
    finding: z.string(),
    recommendation: z.string(),
    legalReference: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    citations: z.array(z.number().int().min(1)).max(5).optional(),
  })),
  overallAssessment: z.string(),
  recommendations: z.array(z.string()),
});

export type AIComplianceCheck = z.infer<typeof aiComplianceSchema>['checks'][number];

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
    ? ragResults.map((r, i) => {
      const { sanitized } = sanitizeForAI(r.content, {
        maxLength: 500,
        label: `LEGAL_SOURCE_${i + 1}`,
      });
      return `[Sursa ${i + 1}]\n${sanitized}`;
    }).join('\n\n')
    : '';

  const sourceTrace: ComplianceSourceTrace[] = ragResults.map((source, index) => ({
    sourceIndex: index + 1,
    sourceId: source.id,
    title: typeof source.metadata.title === 'string' ? source.metadata.title : `Document ${index + 1}`,
    sourceUrl: typeof source.metadata.sourceUrl === 'string' ? source.metadata.sourceUrl : undefined,
    snippet: source.content.substring(0, 260),
    score: Math.round(source.score * 1000) / 1000,
  }));

  // Step 3: Romanian Specialization
  const romanianAnalysis = isRo ? await analyzeRomanianContent({
    content: `${input.project.title}\n${input.project.summary || ''}`,
    context: 'compliance_validation',
    additionalContext: {
      orgType: input.organization.orgType,
      budget: input.project.budget
    }
  }) : null;

  // Step 4: AI compliance check
  const systemPrompt = isRo
    ? `Ești un expert în conformitate juridică pentru fonduri europene. Verifici proiecte din perspectiva:
- Regulamentului CPR (2021/1060)
- Regulilor de ajutor de stat
- Eligibilitate cheltuieli
- GDPR și protecția datelor
- Legislația românească relevantă (OUG, HG)
Oferă evaluări concrete și referințe juridice.
Pentru fiecare verificare, include:
- confidence: scor între 0 și 1
- citations: lista numerelor de surse folosite (de ex. [1, 3], corespondente [Sursa N]).`
    : `You are an EU funding legal compliance expert. Check projects for:
- CPR Regulation (2021/1060)
- State aid rules
- Expenditure eligibility
- GDPR and data protection
- Relevant Romanian legislation
Provide concrete assessments and legal references.
For each check include:
- confidence: score between 0 and 1
- citations: source indexes used (e.g. [1, 3], matching [Sursa N]).`;

  const safeTitle = sanitizeForAI(input.project.title, {
    maxLength: AI_INPUT_LIMITS.genericField,
    label: 'PROJECT_TITLE',
  }).sanitized;
  const safeSummary = input.project.summary
    ? sanitizeForAI(input.project.summary, {
      maxLength: AI_INPUT_LIMITS.projectContext,
      label: 'PROJECT_SUMMARY',
    }).sanitized
    : '';
  const safeObjectives = input.project.objectives
    ? sanitizeForAI(input.project.objectives, {
      maxLength: AI_INPUT_LIMITS.projectContext,
      label: 'PROJECT_OBJECTIVES',
    }).sanitized
    : '';
  const safeMethodology = input.project.methodology
    ? sanitizeForAI(input.project.methodology, {
      maxLength: AI_INPUT_LIMITS.projectContext,
      label: 'PROJECT_METHODOLOGY',
    }).sanitized
    : '';

  const prompt = isRo
    ? `Verifică conformitatea următorului proiect:

Titlu: ${safeTitle}
${input.project.summary ? `Rezumat: ${safeSummary}` : ''}
${input.project.objectives ? `Obiective: ${safeObjectives}` : ''}
${input.project.methodology ? `Metodologie: ${safeMethodology}` : ''}
Organizație: ${input.organization.orgType}${input.organization.orgSize ? ` (${input.organization.orgSize})` : ''}
${input.project.budget ? `Buget: ${input.project.budget} EUR` : ''}
${input.project.durationMonths ? `Durată: ${input.project.durationMonths} luni` : ''}
${ragContext ? `\nContext legislativ relevant:\n${ragContext}` : ''}

Verifică toate aspectele de conformitate și oferă recomandări.`
    : `Check compliance for the following project:

Title: ${safeTitle}
${input.project.summary ? `Summary: ${safeSummary}` : ''}
${input.project.objectives ? `Objectives: ${safeObjectives}` : ''}
${input.project.methodology ? `Methodology: ${safeMethodology}` : ''}
Organization: ${input.organization.orgType}
${input.project.budget ? `Budget: ${input.project.budget} EUR` : ''}
${input.project.durationMonths ? `Duration: ${input.project.durationMonths} months` : ''}
${ragContext ? `\nRelevant legal context:\n${ragContext}` : ''}

Check all compliance aspects and provide recommendations.`;

  const boundaryInstruction = buildBoundaryInstruction(extractPromptBoundaries(prompt));

  const { 
    object: aiResult, 
    tokensUsed, 
    provider, 
    model, 
    tier, 
    romanianOptimized 
  } = await aiGenerateObject({
    system: boundaryInstruction ? `${systemPrompt}\n\n${boundaryInstruction}` : systemPrompt,
    prompt,
    schema: aiComplianceSchema,
    schemaName: 'ComplianceCheck',
    temperature: 0.2,
    taskType: 'classification',
    romanianContext: romanianAnalysis?.context,
  });

  const normalizedChecks = (aiResult?.checks || []).map((check) => {
    const defaultConfidence = check.status === 'pass' ? 0.75 : check.status === 'warning' ? 0.62 : 0.7;
    const uniqueCitations = [...new Set((check.citations || []).filter((idx: number) => idx >= 1 && idx <= sourceTrace.length))];
    return {
      ...check,
      confidence: typeof check.confidence === 'number' ? check.confidence : defaultConfidence,
      citations: uniqueCitations,
    };
  });

  const dnshAssessment = assessDNSH({
    title: input.project.title,
    summary: input.project.summary,
    objectives: input.project.objectives,
    methodology: input.project.methodology,
    locale: input.locale,
  });

  const dnshCitations = sourceTrace
    .filter((source) => /dnsh|do no significant harm|taxonomy|climate|mediu/i.test(source.snippet))
    .slice(0, 2)
    .map((source) => source.sourceIndex);

  normalizedChecks.push({
    area: 'DNSH',
    status: dnshAssessment.status,
    finding: dnshAssessment.finding,
    recommendation: dnshAssessment.recommendation,
    legalReference: dnshAssessment.legalReference,
    confidence: Math.max(0.45, Math.min(0.95, dnshAssessment.score / 100)),
    citations: dnshCitations,
  });

  // Combine scores: 50% deterministic, 50% AI
  const aiPassRate = normalizedChecks.length > 0
    ? normalizedChecks.filter((c) => c.status === 'pass').length / normalizedChecks.length * 100
    : 100;

  const overallScore = Math.round(ruleScore * 0.5 + aiPassRate * 0.5);

  return {
    overallScore,
    deterministicResults,
    aiResults: normalizedChecks,
    dnshAssessment,
    ragSources: ragResults.length,
    sourceTrace,
    tokensUsed,
    recommendations: aiResult?.recommendations || [],
    evaluatedAt: new Date().toISOString(),
    provider,
    model,
    tier,
    romanianOptimized,
  };
}

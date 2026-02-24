// ─── Phase 3: Predictive Success Analytics Engine ────────────────
// ML-inspired prediction of proposal success probability using
// historical patterns, Romanian context, and program-specific models.

import { aiGenerateObject } from './client';
import { z } from 'zod';
import { EU_PROGRAMS, type EUProgramKey } from './eu-knowledge-base';

// ─── Types ───────────────────────────────────────────────────────

export interface SuccessFactor {
  factor: string;
  impact: 'positive' | 'negative' | 'neutral';
  weight: number; // 0-1
  description: string;
  category: 'consortium' | 'budget' | 'methodology' | 'impact' | 'innovation' | 'management' | 'romanian_context';
}

export interface Improvement {
  area: string;
  currentScore: number;
  potentialScore: number;
  effort: 'low' | 'medium' | 'high';
  description: string;
  actionItems: string[];
  expectedImpact: number; // percentage points improvement
}

export interface BenchmarkData {
  programAverage: number;
  topQuartile: number;
  romanianAverage: number;
  sectorAverage: number;
  proposalRanking: 'top_10' | 'top_25' | 'above_average' | 'average' | 'below_average';
}

export interface PredictiveRisk {
  risk: string;
  probability: number;
  impact: 'critical' | 'high' | 'medium' | 'low';
  mitigation: string;
  category: string;
  timeHorizon: 'immediate' | 'short_term' | 'medium_term' | 'long_term';
}

export interface ProposalSuccessPrediction {
  successProbability: number;
  confidenceLevel: 'high' | 'medium' | 'low';
  criticalFactors: SuccessFactor[];
  improvementRecommendations: Improvement[];
  benchmarkComparison: BenchmarkData;
  riskFactors: PredictiveRisk[];
  programSpecificInsights: string[];
  romanianContextFactors: string[];
  budgetOptimality: number;
  timelineFeasibility: number;
  consortiumStrength: number;
  innovationScore: number;
  impactScore: number;
  overallReadiness: 'ready' | 'needs_improvement' | 'significant_gaps' | 'not_ready';
}

export interface PredictionInput {
  projectTitle: string;
  projectSummary: string;
  programType: EUProgramKey;
  totalBudget: number;
  durationMonths: number;
  sector: string;
  trl?: number; // Technology Readiness Level 1-9
  partners: {
    name: string;
    country: string;
    type: 'university' | 'research_institute' | 'sme' | 'large_enterprise' | 'ngo' | 'public_body';
    role: 'coordinator' | 'partner';
    previousEUProjects?: number;
    budgetShare?: number;
  }[];
  methodology?: string;
  expectedImpact?: string;
  innovation?: string;
  objectives?: string[];
  romanianLead?: boolean;
  locale?: 'ro' | 'en';
}

// ─── Historical Success Data (Romanian Context) ──────────────────

const ROMANIAN_SUCCESS_PATTERNS = {
  horizonEurope: {
    overallSuccessRate: 0.127, // ~12.7% for Romanian organizations
    coordinatorSuccessRate: 0.085,
    partnerSuccessRate: 0.152,
    topSectors: ['ict', 'energy', 'health', 'materials'],
    averageBudgetPerPartner: 450000,
    optimalConsortiumSize: { min: 6, max: 12 },
    strongInstitutions: [
      'Universitatea Politehnica București',
      'Universitatea Babeș-Bolyai',
      'INCDSB',
      'ICI București',
      'INCDTIM',
    ],
  },
  lifePlus: {
    overallSuccessRate: 0.22,
    coordinatorSuccessRate: 0.18,
    partnerSuccessRate: 0.25,
    topSectors: ['environment', 'climate', 'biodiversity', 'circular_economy'],
    averageBudgetPerPartner: 350000,
    optimalConsortiumSize: { min: 3, max: 8 },
    strongInstitutions: [
      'Ministerul Mediului',
      'APM',
      'WWF România',
      'Fundația Conservation Carpathia',
    ],
  },
  interreg: {
    overallSuccessRate: 0.35,
    coordinatorSuccessRate: 0.28,
    partnerSuccessRate: 0.38,
    topSectors: ['regional_development', 'cross_border', 'infrastructure', 'tourism'],
    averageBudgetPerPartner: 200000,
    optimalConsortiumSize: { min: 3, max: 6 },
    strongInstitutions: [
      'Consiliul Județean',
      'ADR Nord-Vest',
      'ADR Centru',
      'Universitatea de Vest Timișoara',
    ],
  },
  erasmusPlus: {
    overallSuccessRate: 0.28,
    coordinatorSuccessRate: 0.22,
    partnerSuccessRate: 0.32,
    topSectors: ['education', 'training', 'youth', 'sport'],
    averageBudgetPerPartner: 150000,
    optimalConsortiumSize: { min: 3, max: 8 },
    strongInstitutions: [
      'ANPCDEFP',
      'Universitatea București',
      'ASE București',
    ],
  },
};

type ProgramPatternKey = keyof typeof ROMANIAN_SUCCESS_PATTERNS;

const PROGRAM_TO_PATTERN: Partial<Record<EUProgramKey, ProgramPatternKey>> = {
  'horizon_europe': 'horizonEurope',
  'life_plus': 'lifePlus',
  'interreg': 'interreg',
};

// ─── Scoring Algorithms ──────────────────────────────────────────

function scoreConsortium(partners: PredictionInput['partners'], programType: EUProgramKey): number {
  if (partners.length === 0) return 30;

  const patternKey = PROGRAM_TO_PATTERN[programType];
  const pattern = patternKey ? ROMANIAN_SUCCESS_PATTERNS[patternKey] : ROMANIAN_SUCCESS_PATTERNS.horizonEurope;

  let score = 50;

  // Size optimization
  const { min, max } = pattern.optimalConsortiumSize;
  if (partners.length >= min && partners.length <= max) score += 15;
  else if (partners.length < min) score -= 10;
  else score -= 5;

  // Geographic diversity
  const countries = new Set(partners.map(p => p.country));
  if (countries.size >= 3) score += 10;
  if (countries.size >= 5) score += 5;

  // Partner type diversity
  const types = new Set(partners.map(p => p.type));
  if (types.has('university') || types.has('research_institute')) score += 5;
  if (types.has('sme')) score += 5;
  if (types.size >= 3) score += 5;

  // Experience
  const totalExperience = partners.reduce((s, p) => s + (p.previousEUProjects || 0), 0);
  if (totalExperience > 10) score += 10;
  else if (totalExperience > 5) score += 5;

  return Math.min(100, Math.max(0, score));
}

function scoreBudget(budget: number, partners: PredictionInput['partners'], programType: EUProgramKey): number {
  const patternKey = PROGRAM_TO_PATTERN[programType];
  const pattern = patternKey ? ROMANIAN_SUCCESS_PATTERNS[patternKey] : ROMANIAN_SUCCESS_PATTERNS.horizonEurope;

  const perPartner = partners.length > 0 ? budget / partners.length : budget;
  const optimal = pattern.averageBudgetPerPartner;
  const ratio = perPartner / optimal;

  if (ratio >= 0.7 && ratio <= 1.5) return 80;
  if (ratio >= 0.5 && ratio <= 2.0) return 60;
  return 40;
}

function scoreTimeline(durationMonths: number, programType: EUProgramKey): number {
  // Typical durations by program
  const optimalDurations: Partial<Record<EUProgramKey, { min: number; max: number }>> = {
    'horizon_europe': { min: 24, max: 48 },
    'life_plus': { min: 36, max: 60 },
    'interreg': { min: 18, max: 36 },
  };

  const optimal = optimalDurations[programType] || { min: 24, max: 48 };
  if (durationMonths >= optimal.min && durationMonths <= optimal.max) return 85;
  if (durationMonths < optimal.min) return 50;
  return 60;
}

// ─── AI-Enhanced Prediction ──────────────────────────────────────

const predictionSchema = z.object({
  successProbability: z.number().min(0).max(100),
  confidenceLevel: z.enum(['high', 'medium', 'low']),
  criticalFactors: z.array(z.object({
    factor: z.string(),
    impact: z.enum(['positive', 'negative', 'neutral']),
    weight: z.number(),
    description: z.string(),
    category: z.enum(['consortium', 'budget', 'methodology', 'impact', 'innovation', 'management', 'romanian_context']),
  })),
  improvementRecommendations: z.array(z.object({
    area: z.string(),
    currentScore: z.number(),
    potentialScore: z.number(),
    effort: z.enum(['low', 'medium', 'high']),
    description: z.string(),
    actionItems: z.array(z.string()),
    expectedImpact: z.number(),
  })),
  riskFactors: z.array(z.object({
    risk: z.string(),
    probability: z.number(),
    impact: z.enum(['critical', 'high', 'medium', 'low']),
    mitigation: z.string(),
    category: z.string(),
    timeHorizon: z.enum(['immediate', 'short_term', 'medium_term', 'long_term']),
  })),
  programSpecificInsights: z.array(z.string()),
  romanianContextFactors: z.array(z.string()),
  innovationScore: z.number().min(0).max(100),
  impactScore: z.number().min(0).max(100),
  overallReadiness: z.enum(['ready', 'needs_improvement', 'significant_gaps', 'not_ready']),
});

export async function predictProposalSuccess(input: PredictionInput): Promise<ProposalSuccessPrediction> {
  // Pre-compute algorithmic scores
  const consortiumStrength = scoreConsortium(input.partners, input.programType);
  const budgetOptimality = scoreBudget(input.totalBudget, input.partners, input.programType);
  const timelineFeasibility = scoreTimeline(input.durationMonths, input.programType);

  const patternKey = PROGRAM_TO_PATTERN[input.programType];
  const pattern = patternKey ? ROMANIAN_SUCCESS_PATTERNS[patternKey] : ROMANIAN_SUCCESS_PATTERNS.horizonEurope;

  const programInfo = EU_PROGRAMS[input.programType];
  const isRomanianLead = input.romanianLead ?? input.partners.some(p => p.country === 'RO' && p.role === 'coordinator');

  const systemPrompt = `You are an expert EU funding analyst specializing in predicting proposal success.
You have deep knowledge of EU funding programs, evaluation criteria, and Romanian organizations' participation patterns.

Pre-computed scores (use as baseline, adjust based on qualitative analysis):
- Consortium Strength: ${consortiumStrength}/100
- Budget Optimality: ${budgetOptimality}/100
- Timeline Feasibility: ${timelineFeasibility}/100
- Program base success rate: ${(pattern.overallSuccessRate * 100).toFixed(1)}%
- Romanian coordinator success rate: ${(pattern.coordinatorSuccessRate * 100).toFixed(1)}%
- Is Romanian-led: ${isRomanianLead}

Program: ${programInfo?.name || input.programType}
Evaluation criteria: ${programInfo?.evaluationCriteria?.join(', ') || 'Standard EU criteria'}

Analyze the proposal and provide accurate, actionable predictions.
${input.locale === 'ro' ? 'Provide insights in Romanian where appropriate.' : ''}`;

  const prompt = `Predict the success probability for this EU funding proposal:

Title: ${input.projectTitle}
Summary: ${input.projectSummary}
Program: ${input.programType}
Budget: €${input.totalBudget.toLocaleString()}
Duration: ${input.durationMonths} months
Sector: ${input.sector}
${input.trl ? `TRL: ${input.trl}` : ''}

Partners (${input.partners.length}):
${input.partners.map(p => `- ${p.name} (${p.country}, ${p.type}, ${p.role}${p.previousEUProjects ? `, ${p.previousEUProjects} prev projects` : ''})`).join('\n')}

${input.methodology ? `Methodology: ${input.methodology}` : ''}
${input.expectedImpact ? `Expected Impact: ${input.expectedImpact}` : ''}
${input.innovation ? `Innovation: ${input.innovation}` : ''}
${input.objectives?.length ? `Objectives:\n${input.objectives.map(o => `- ${o}`).join('\n')}` : ''}

Provide comprehensive success prediction with actionable improvement recommendations.`;

  const { object: aiPrediction } = await aiGenerateObject({
    system: systemPrompt,
    prompt,
    schema: predictionSchema,
    schemaName: 'ProposalSuccessPrediction',
    temperature: 0.3,
  });

  // Compute benchmark comparison
  const benchmarkComparison: BenchmarkData = {
    programAverage: Math.round(pattern.overallSuccessRate * 100),
    topQuartile: Math.round(pattern.overallSuccessRate * 100 * 2.5),
    romanianAverage: Math.round((isRomanianLead ? pattern.coordinatorSuccessRate : pattern.partnerSuccessRate) * 100),
    sectorAverage: Math.round(pattern.overallSuccessRate * 100 * (pattern.topSectors.includes(input.sector) ? 1.3 : 0.9)),
    proposalRanking: aiPrediction.successProbability >= 40 ? 'top_10' :
      aiPrediction.successProbability >= 30 ? 'top_25' :
      aiPrediction.successProbability >= 20 ? 'above_average' :
      aiPrediction.successProbability >= 12 ? 'average' : 'below_average',
  };

  return {
    ...aiPrediction,
    benchmarkComparison,
    budgetOptimality,
    timelineFeasibility,
    consortiumStrength,
  };
}

// ─── Quick Prediction (No AI Call) ───────────────────────────────

export function quickSuccessPrediction(input: PredictionInput): {
  estimatedProbability: number;
  confidence: 'low';
  keyFactors: string[];
} {
  const consortium = scoreConsortium(input.partners, input.programType);
  const budget = scoreBudget(input.totalBudget, input.partners, input.programType);
  const timeline = scoreTimeline(input.durationMonths, input.programType);

  const patternKey = PROGRAM_TO_PATTERN[input.programType];
  const pattern = patternKey ? ROMANIAN_SUCCESS_PATTERNS[patternKey] : ROMANIAN_SUCCESS_PATTERNS.horizonEurope;

  const baseRate = pattern.overallSuccessRate * 100;
  const qualityMultiplier = (consortium + budget + timeline) / 300;
  const estimatedProbability = Math.round(baseRate * (0.5 + qualityMultiplier));

  const keyFactors: string[] = [];
  if (consortium < 50) keyFactors.push('Weak consortium composition');
  if (consortium >= 75) keyFactors.push('Strong consortium');
  if (budget < 50) keyFactors.push('Budget misaligned with program norms');
  if (timeline < 60) keyFactors.push('Timeline outside optimal range');
  if (input.partners.length < 3) keyFactors.push('Too few partners');

  return { estimatedProbability, confidence: 'low', keyFactors };
}

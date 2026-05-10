// ─── Multi-Factor Risk Assessment Engine ────────────────────────
// Comprehensive risk analysis: timeline, budget, dependencies,
// partner capability, Romanian-specific factors, EUR-Lex compliance.

import { z } from 'zod';
import { aiGenerateObject } from './client';
import type { WorkPackageStatus } from './deadline-intelligence';

// ─── Types ───────────────────────────────────────────────────────

export interface RiskAssessmentInput {
  project: {
    title: string;
    summary: string;
    programType: string;
    totalBudget: number;
    spentBudget: number;
    durationMonths: number;
    elapsedMonths: number;
    startDate: string;
    endDate: string;
  };
  workPackages: WorkPackageStatus[];
  partners: PartnerInfo[];
  compliance?: {
    gdprStatus: 'compliant' | 'partial' | 'non-compliant';
    ethicsApproval: boolean;
    environmentalAssessment?: boolean;
    stateAidCleared?: boolean;
  };
  romanianContext?: {
    publicProcurement: boolean;
    governmentPartner: boolean;
    ruralArea: boolean;
    disadvantagedRegion: boolean;
  };
  locale?: 'ro' | 'en';
}

export interface PartnerInfo {
  name: string;
  country: string;
  type: 'university' | 'research' | 'sme' | 'large_enterprise' | 'ngo' | 'public_body';
  role: 'coordinator' | 'partner' | 'associated';
  budgetShare: number;
  previousEUProjects: number;
  capacityScore?: number; // 0-100
}

export interface RiskAssessment {
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  overallScore: number; // 0-100 (100 = highest risk)
  dimensions: {
    timeline: RiskDimension;
    budget: RiskDimension;
    technical: RiskDimension;
    partnership: RiskDimension;
    compliance: RiskDimension;
    external: RiskDimension;
  };
  romanianFactors: RomanianRiskFactor[];
  riskMatrix: RiskMatrixEntry[];
  predictedOutcome: PredictedOutcome;
  actionPlan: ActionItem[];
}

export interface RiskDimension {
  score: number; // 0-100
  level: 'low' | 'medium' | 'high' | 'critical';
  factors: string[];
  mitigations: string[];
}

export interface RomanianRiskFactor {
  factor: string;
  probability: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  description: string;
  mitigation: string;
}

export interface RiskMatrixEntry {
  risk: string;
  category: string;
  probability: number; // 1-5
  impact: number; // 1-5
  score: number; // probability * impact
  owner: string;
  response: string;
}

export interface PredictedOutcome {
  successProbability: number; // 0-1
  likelyCompletionDate: string;
  budgetForecast: number;
  scenarioBest: string;
  scenarioWorst: string;
  scenarioMostLikely: string;
}

export interface ActionItem {
  priority: 'immediate' | 'short_term' | 'medium_term';
  action: string;
  responsible: string;
  deadline: string;
  expectedImpact: string;
}

// ─── Deterministic Risk Scoring ──────────────────────────────────

function scoreTimelineRisk(input: RiskAssessmentInput): RiskDimension {
  const { elapsedMonths, durationMonths } = input.project;
  const timeProgress = (elapsedMonths / durationMonths) * 100;
  const wpProgress = input.workPackages.length > 0
    ? input.workPackages.reduce((s, wp) => s + wp.progress, 0) / input.workPackages.length
    : 0;
  const gap = timeProgress - wpProgress;
  const factors: string[] = [];
  const mitigations: string[] = [];

  let score = Math.min(100, Math.max(0, gap * 2));

  if (gap > 20) factors.push(`Progress ${gap.toFixed(0)}% behind schedule`);
  if (elapsedMonths / durationMonths > 0.8 && wpProgress < 70) {
    factors.push('Less than 20% time remaining with significant work outstanding');
    score = Math.max(score, 80);
  }

  const overdueWPs = input.workPackages.filter(wp =>
    wp.plannedEnd && new Date(wp.plannedEnd) < new Date() && wp.progress < 100
  );
  if (overdueWPs.length > 0) {
    factors.push(`${overdueWPs.length} work package(s) past planned end date`);
    mitigations.push('Request no-cost extension or rescope delayed work packages');
  }

  if (factors.length === 0) factors.push('Timeline on track');
  if (score > 30) mitigations.push('Consider reallocating resources to delayed activities');

  return { score, level: scoreToLevel(score), factors, mitigations };
}

function scoreBudgetRisk(input: RiskAssessmentInput): RiskDimension {
  const { totalBudget, spentBudget, elapsedMonths, durationMonths } = input.project;
  const budgetUsed = (spentBudget / totalBudget) * 100;
  const timeUsed = (elapsedMonths / durationMonths) * 100;
  const factors: string[] = [];
  const mitigations: string[] = [];

  let score = 0;

  // Overspending relative to time
  if (budgetUsed > timeUsed * 1.2) {
    score = Math.min(100, (budgetUsed - timeUsed) * 2);
    factors.push(`Budget consumption (${budgetUsed.toFixed(0)}%) exceeds time elapsed (${timeUsed.toFixed(0)}%)`);
    mitigations.push('Review cost categories and implement spending controls');
  }

  // Underspending (also a risk in EU projects - absorption problems)
  if (budgetUsed < timeUsed * 0.5 && elapsedMonths > 6) {
    score = Math.max(score, 40);
    factors.push(`Low budget absorption: ${budgetUsed.toFixed(0)}% spent at ${timeUsed.toFixed(0)}% timeline`);
    mitigations.push('Accelerate procurement and hiring to improve absorption rate');
  }

  // WP-level budget issues
  const overBudgetWPs = input.workPackages.filter(wp => wp.spent > wp.budget * 1.1);
  if (overBudgetWPs.length > 0) {
    score = Math.max(score, 60);
    factors.push(`${overBudgetWPs.length} work package(s) over budget`);
    mitigations.push('Request budget reallocation between work packages');
  }

  if (factors.length === 0) factors.push('Budget on track');

  return { score, level: scoreToLevel(score), factors, mitigations };
}

function scorePartnershipRisk(input: RiskAssessmentInput): RiskDimension {
  const factors: string[] = [];
  const mitigations: string[] = [];
  let score = 0;

  if (input.partners.length === 0) {
    return { score: 20, level: 'low', factors: ['No partnership data available'], mitigations: [] };
  }

  // Inexperienced partners
  const inexperienced = input.partners.filter(p => p.previousEUProjects === 0);
  if (inexperienced.length > 0) {
    score += 15 * inexperienced.length;
    factors.push(`${inexperienced.length} partner(s) with no prior EU project experience`);
    mitigations.push('Assign experienced mentors and provide EU project management training');
  }

  // Budget concentration
  const maxShare = Math.max(...input.partners.map(p => p.budgetShare));
  if (maxShare > 0.6) {
    score += 20;
    factors.push(`High budget concentration: one partner holds ${(maxShare * 100).toFixed(0)}% of budget`);
  }

  // Coordinator capacity
  const coordinator = input.partners.find(p => p.role === 'coordinator');
  if (coordinator && coordinator.previousEUProjects < 3) {
    score += 15;
    factors.push('Coordinator has limited EU project management experience');
    mitigations.push('Consider hiring experienced project manager or external support');
  }

  if (factors.length === 0) factors.push('Partnership structure appears solid');

  return { score: Math.min(100, score), level: scoreToLevel(Math.min(100, score)), factors, mitigations };
}

function scoreComplianceRisk(input: RiskAssessmentInput): RiskDimension {
  const factors: string[] = [];
  const mitigations: string[] = [];
  let score = 0;

  if (!input.compliance) {
    return { score: 50, level: 'medium', factors: ['Compliance status not assessed'], mitigations: ['Conduct compliance assessment immediately'] };
  }

  if (input.compliance.gdprStatus === 'non-compliant') {
    score += 40;
    factors.push('GDPR non-compliance detected');
    mitigations.push('Engage Data Protection Officer and implement GDPR action plan');
  } else if (input.compliance.gdprStatus === 'partial') {
    score += 20;
    factors.push('Partial GDPR compliance');
    mitigations.push('Complete GDPR gap analysis and remediation');
  }

  if (!input.compliance.ethicsApproval) {
    score += 25;
    factors.push('Ethics approval pending or missing');
    mitigations.push('Submit ethics self-assessment to funding authority');
  }

  if (input.compliance.stateAidCleared === false) {
    score += 30;
    factors.push('State aid clearance not obtained');
    mitigations.push('Consult with Competition Council (Consiliul Concurenței) for state aid assessment');
  }

  if (factors.length === 0) factors.push('All compliance requirements met');

  return { score: Math.min(100, score), level: scoreToLevel(Math.min(100, score)), factors, mitigations };
}

function assessRomanianFactors(input: RiskAssessmentInput): RomanianRiskFactor[] {
  const factors: RomanianRiskFactor[] = [];
  const ctx = input.romanianContext;

  // Universal Romanian factors
  factors.push({
    factor: 'Birocrație administrativă',
    probability: 'high',
    impact: 'medium',
    description: 'Romanian administrative processes typically add 2-4 weeks to standard timelines',
    mitigation: 'Build buffer time into project plan; prepare documents in advance',
  });

  if (ctx?.publicProcurement) {
    factors.push({
      factor: 'Achiziții publice',
      probability: 'high',
      impact: 'high',
      description: 'Public procurement in Romania averages 3-6 months (SICAP platform delays, contestations)',
      mitigation: 'Start procurement early; use framework agreements where possible; prepare for CNSC appeals',
    });
  }

  if (ctx?.governmentPartner) {
    factors.push({
      factor: 'Partener guvernamental',
      probability: 'medium',
      impact: 'high',
      description: 'Government partners subject to political changes, reorganizations, and slower decision-making',
      mitigation: 'Secure written commitments at multiple levels; maintain relationships across departments',
    });
  }

  if (ctx?.ruralArea) {
    factors.push({
      factor: 'Zonă rurală',
      probability: 'medium',
      impact: 'medium',
      description: 'Rural implementation may face infrastructure, connectivity, and human resource challenges',
      mitigation: 'Plan for remote work capabilities; identify local partners; budget for travel',
    });
  }

  if (ctx?.disadvantagedRegion) {
    factors.push({
      factor: 'Regiune dezavantajată',
      probability: 'low',
      impact: 'low',
      description: 'May qualify for higher co-financing rates and priority scoring',
      mitigation: 'Leverage regional development advantages in proposal; connect with ADR',
    });
  }

  // Exchange rate risk for non-Euro Romania
  factors.push({
    factor: 'Risc valutar RON/EUR',
    probability: 'medium',
    impact: 'medium',
    description: 'EU funding in EUR while costs partially in RON; exchange rate fluctuations affect real budget',
    mitigation: 'Use conservative exchange rate in budget; consider hedging for large procurements',
  });

  return factors;
}

function scoreToLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

// ─── AI Schema ───────────────────────────────────────────────────

const aiRiskSchema = z.object({
  technicalRiskFactors: z.array(z.string()),
  technicalMitigations: z.array(z.string()),
  externalRiskFactors: z.array(z.string()),
  externalMitigations: z.array(z.string()),
  riskMatrix: z.array(z.object({
    risk: z.string(),
    category: z.string(),
    probability: z.number().min(1).max(5),
    impact: z.number().min(1).max(5),
    owner: z.string(),
    response: z.string(),
  })),
  predictedOutcome: z.object({
    successProbability: z.number().min(0).max(1),
    scenarioBest: z.string(),
    scenarioWorst: z.string(),
    scenarioMostLikely: z.string(),
  }),
  actionPlan: z.array(z.object({
    priority: z.enum(['immediate', 'short_term', 'medium_term']),
    action: z.string(),
    responsible: z.string(),
    expectedImpact: z.string(),
  })),
});

// ─── Main Assessment Function ────────────────────────────────────

export async function assessRisk(input: RiskAssessmentInput): Promise<RiskAssessment> {
  const isRo = input.locale !== 'en';

  // Deterministic dimensions
  const timeline = scoreTimelineRisk(input);
  const budget = scoreBudgetRisk(input);
  const partnership = scorePartnershipRisk(input);
  const compliance = scoreComplianceRisk(input);
  const romanianFactors = assessRomanianFactors(input);

  // AI for technical + external risks
  const systemPrompt = isRo
    ? `Ești un expert în evaluarea riscurilor pentru proiecte finanțate din fonduri europene implementate în România. Analizează riscurile tehnice și externe și oferă un plan de acțiune concret. Răspunde în română.`
    : `You are an EU-funded project risk assessment expert with Romanian implementation context. Analyze technical and external risks and provide concrete action plans.`;

  const prompt = `Assess risks for this EU project:

Project: ${input.project.title}
Program: ${input.project.programType}
Budget: €${input.project.totalBudget.toLocaleString()} (€${input.project.spentBudget.toLocaleString()} spent)
Duration: ${input.project.durationMonths} months (${input.project.elapsedMonths} elapsed)
Partners: ${input.partners.map(p => `${p.name} (${p.type}, ${p.country})`).join(', ')}

Known risks:
- Timeline: ${timeline.level} (${timeline.factors.join('; ')})
- Budget: ${budget.level} (${budget.factors.join('; ')})
- Partnership: ${partnership.level} (${partnership.factors.join('; ')})
- Compliance: ${compliance.level} (${compliance.factors.join('; ')})
- Romanian factors: ${romanianFactors.map(f => f.factor).join(', ')}

Provide: technical risks, external risks, risk matrix, predicted outcomes, and action plan.`;

  let technical: RiskDimension = { score: 30, level: 'medium', factors: ['Not assessed'], mitigations: [] };
  let external: RiskDimension = { score: 30, level: 'medium', factors: ['Not assessed'], mitigations: [] };
  let riskMatrix: RiskMatrixEntry[] = [];
  let predictedOutcome: PredictedOutcome;
  let actionPlan: ActionItem[] = [];

  try {
    const result = await aiGenerateObject({
      system: systemPrompt,
      prompt,
      schema: aiRiskSchema,
      schemaName: 'RiskAssessment',
      temperature: 0.3,
    });

    const ai = result.object;

    if (!ai) {
      throw new Error('AI failed to produce a valid risk assessment result');
    }

    technical = {
      score: Math.min(100, ai.technicalRiskFactors.length * 20),
      level: scoreToLevel(Math.min(100, ai.technicalRiskFactors.length * 20)),
      factors: ai.technicalRiskFactors,
      mitigations: ai.technicalMitigations,
    };

    external = {
      score: Math.min(100, ai.externalRiskFactors.length * 20),
      level: scoreToLevel(Math.min(100, ai.externalRiskFactors.length * 20)),
      factors: ai.externalRiskFactors,
      mitigations: ai.externalMitigations,
    };

    riskMatrix = ai.riskMatrix.map(r => ({
      ...r,
      score: r.probability * r.impact,
    }));

    predictedOutcome = {
      ...ai.predictedOutcome,
      likelyCompletionDate: input.project.endDate,
      budgetForecast: input.project.spentBudget * (input.project.durationMonths / Math.max(1, input.project.elapsedMonths)),
    };

    actionPlan = ai.actionPlan.map(a => ({
      ...a,
      deadline: a.priority === 'immediate' ? '1 week' : a.priority === 'short_term' ? '1 month' : '3 months',
    }));
  } catch {
    predictedOutcome = {
      successProbability: 0.5,
      likelyCompletionDate: input.project.endDate,
      budgetForecast: input.project.totalBudget,
      scenarioBest: 'Project completes on time',
      scenarioWorst: 'Significant delays and budget overrun',
      scenarioMostLikely: 'Minor delays requiring mitigation',
    };
  }

  const dimensions = { timeline, budget, technical, partnership, compliance, external };
  const overallScore = Math.round(
    Object.values(dimensions).reduce((s, d) => s + d.score, 0) / 6
  );

  return {
    overallRisk: scoreToLevel(overallScore),
    overallScore,
    dimensions,
    romanianFactors,
    riskMatrix,
    predictedOutcome,
    actionPlan,
  };
}

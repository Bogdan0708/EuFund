// ─── Phase 3: Advanced Grant Lifecycle Prediction ────────────────
// Predictive lifecycle management with milestone risk, budget burn
// forecasting, partner attrition, and compliance drift detection.

import { aiGenerateObject } from './client';
import { z } from 'zod';
import { type EUProgramKey } from './eu-knowledge-base';

// ─── Types ───────────────────────────────────────────────────────

export interface MilestoneRisk {
  milestoneId: string;
  milestoneName: string;
  dueDate: string;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  delayProbability: number;
  estimatedDelay: number; // days
  riskFactors: string[];
  mitigation: string[];
  dependencies: string[];
  responsiblePartner: string;
}

export interface BudgetForecast {
  currentBurnRate: number; // € per month
  projectedBurnRate: number;
  totalBudget: number;
  spentToDate: number;
  projectedEndSpend: number;
  variance: number; // % over/under
  monthlyForecasts: { month: string; projected: number; cumulative: number }[];
  riskAreas: { category: string; risk: string; amount: number }[];
  recommendations: string[];
  underspendRisk: boolean;
  overspendRisk: boolean;
}

export interface PartnerForecast {
  partnerName: string;
  country: string;
  performanceScore: number;
  attritionRisk: number; // 0-100
  deliveryReliability: number;
  budgetAbsorption: number; // % of allocated budget used
  riskFactors: string[];
  interventions: string[];
}

export interface ComplianceRisk {
  area: string;
  currentStatus: 'compliant' | 'at_risk' | 'non_compliant';
  projectedStatus: 'compliant' | 'at_risk' | 'non_compliant';
  driftDate?: string; // when compliance may be lost
  riskFactors: string[];
  preventiveActions: string[];
  regulatoryReference: string;
}

export interface SuccessEvolution {
  month: number;
  date: string;
  successProbability: number;
  keyChanges: string[];
  recommendations: string[];
}

export interface InterventionAction {
  action: string;
  priority: 'immediate' | 'soon' | 'planned';
  category: 'milestone' | 'budget' | 'partner' | 'compliance' | 'quality' | 'communication';
  responsible: string;
  deadline: string;
  expectedImpact: string;
  effort: 'low' | 'medium' | 'high';
}

export interface LifecyclePrediction {
  milestoneRiskAssessment: MilestoneRisk[];
  budgetBurnPrediction: BudgetForecast;
  partnerPerformanceForecast: PartnerForecast[];
  complianceRiskTimeline: ComplianceRisk[];
  successProbabilityEvolution: SuccessEvolution[];
  interventionRecommendations: InterventionAction[];
  overallProjectHealth: number;
  criticalAlerts: string[];
  auditRiskScore: number;
}

export interface LifecyclePredictionInput {
  projectId: string;
  projectTitle: string;
  programType: EUProgramKey;
  totalBudget: number;
  spentBudget: number;
  durationMonths: number;
  elapsedMonths: number;
  startDate: string;
  endDate: string;
  milestones: {
    id: string;
    name: string;
    dueDate: string;
    status: 'completed' | 'in_progress' | 'not_started' | 'delayed';
    completionPercentage: number;
    responsiblePartner: string;
    dependencies?: string[];
  }[];
  partners: {
    name: string;
    country: string;
    allocatedBudget: number;
    spentBudget: number;
    deliverablesCompleted: number;
    deliverablesTotal: number;
    reportingOnTime: boolean;
  }[];
  recentIssues?: string[];
  locale?: 'ro' | 'en';
}

// ─── Budget Burn Analysis (No AI) ────────────────────────────────

function analyzeBurnRate(input: LifecyclePredictionInput): BudgetForecast {
  const monthlySpend = input.elapsedMonths > 0 ? input.spentBudget / input.elapsedMonths : 0;
  const remainingMonths = input.durationMonths - input.elapsedMonths;
  const remainingBudget = input.totalBudget - input.spentBudget;
  const projectedBurnRate = remainingMonths > 0 ? remainingBudget / remainingMonths : monthlySpend;

  const projectedEndSpend = input.spentBudget + (projectedBurnRate * remainingMonths);
  const variance = input.totalBudget > 0 ? ((projectedEndSpend - input.totalBudget) / input.totalBudget) * 100 : 0;

  const expectedSpendRatio = input.elapsedMonths / input.durationMonths;
  const actualSpendRatio = input.totalBudget > 0 ? input.spentBudget / input.totalBudget : 0;

  const monthlyForecasts: BudgetForecast['monthlyForecasts'] = [];
  let cumulative = input.spentBudget;
  const startDate = new Date(input.startDate);
  for (let i = 0; i < remainingMonths && i < 24; i++) {
    const date = new Date(startDate);
    date.setMonth(date.getMonth() + input.elapsedMonths + i + 1);
    const projected = projectedBurnRate;
    cumulative += projected;
    monthlyForecasts.push({
      month: date.toISOString().slice(0, 7),
      projected: Math.round(projected),
      cumulative: Math.round(cumulative),
    });
  }

  const riskAreas: BudgetForecast['riskAreas'] = [];
  if (actualSpendRatio < expectedSpendRatio * 0.7) {
    riskAreas.push({ category: 'absorption', risk: 'Significant underspend risk', amount: remainingBudget * 0.3 });
  }
  if (actualSpendRatio > expectedSpendRatio * 1.2) {
    riskAreas.push({ category: 'overrun', risk: 'Budget overrun risk', amount: projectedEndSpend - input.totalBudget });
  }

  // Partner-level risks
  for (const partner of input.partners) {
    const partnerAbsorption = partner.allocatedBudget > 0 ? partner.spentBudget / partner.allocatedBudget : 0;
    if (partnerAbsorption < expectedSpendRatio * 0.5) {
      riskAreas.push({ category: 'partner_underspend', risk: `${partner.name}: low budget absorption`, amount: partner.allocatedBudget - partner.spentBudget });
    }
  }

  return {
    currentBurnRate: Math.round(monthlySpend),
    projectedBurnRate: Math.round(projectedBurnRate),
    totalBudget: input.totalBudget,
    spentToDate: input.spentBudget,
    projectedEndSpend: Math.round(projectedEndSpend),
    variance: Math.round(variance * 10) / 10,
    monthlyForecasts,
    riskAreas,
    recommendations: riskAreas.map(r => `Address ${r.risk}`),
    underspendRisk: actualSpendRatio < expectedSpendRatio * 0.7,
    overspendRisk: actualSpendRatio > expectedSpendRatio * 1.2,
  };
}

// ─── Partner Performance (No AI) ─────────────────────────────────

function assessPartnerPerformance(input: LifecyclePredictionInput): PartnerForecast[] {
  return input.partners.map(partner => {
    const deliveryRate = partner.deliverablesTotal > 0
      ? partner.deliverablesCompleted / partner.deliverablesTotal
      : 0;
    const budgetAbsorption = partner.allocatedBudget > 0
      ? partner.spentBudget / partner.allocatedBudget
      : 0;

    const expectedDeliveryRate = input.elapsedMonths / input.durationMonths;
    const performanceScore = Math.round(
      (deliveryRate / Math.max(0.01, expectedDeliveryRate)) * 40 +
      (partner.reportingOnTime ? 30 : 10) +
      Math.min(30, budgetAbsorption * 100 * 0.3)
    );

    const attritionRisk = Math.max(0, Math.min(100,
      (deliveryRate < expectedDeliveryRate * 0.5 ? 30 : 0) +
      (!partner.reportingOnTime ? 25 : 0) +
      (budgetAbsorption < 0.1 && input.elapsedMonths > 6 ? 25 : 0) +
      (partner.country === 'RO' ? 5 : 0) // slight Romanian bureaucracy factor
    ));

    const riskFactors: string[] = [];
    if (deliveryRate < expectedDeliveryRate * 0.5) riskFactors.push('Behind on deliverables');
    if (!partner.reportingOnTime) riskFactors.push('Late reporting');
    if (budgetAbsorption < 0.1 && input.elapsedMonths > 6) riskFactors.push('Very low budget absorption');

    return {
      partnerName: partner.name,
      country: partner.country,
      performanceScore: Math.min(100, performanceScore),
      attritionRisk,
      deliveryReliability: Math.round(deliveryRate * 100),
      budgetAbsorption: Math.round(budgetAbsorption * 100),
      riskFactors,
      interventions: riskFactors.map(r => `Address: ${r}`),
    };
  });
}

// ─── AI-Enhanced Lifecycle Prediction ────────────────────────────

const lifecycleSchema = z.object({
  milestoneRisks: z.array(z.object({
    milestoneId: z.string(),
    riskLevel: z.enum(['critical', 'high', 'medium', 'low']),
    delayProbability: z.number(),
    estimatedDelay: z.number(),
    riskFactors: z.array(z.string()),
    mitigation: z.array(z.string()),
  })),
  complianceRisks: z.array(z.object({
    area: z.string(),
    currentStatus: z.enum(['compliant', 'at_risk', 'non_compliant']),
    projectedStatus: z.enum(['compliant', 'at_risk', 'non_compliant']),
    riskFactors: z.array(z.string()),
    preventiveActions: z.array(z.string()),
    regulatoryReference: z.string(),
  })),
  successEvolution: z.array(z.object({
    month: z.number(),
    successProbability: z.number(),
    keyChanges: z.array(z.string()),
    recommendations: z.array(z.string()),
  })),
  interventions: z.array(z.object({
    action: z.string(),
    priority: z.enum(['immediate', 'soon', 'planned']),
    category: z.enum(['milestone', 'budget', 'partner', 'compliance', 'quality', 'communication']),
    responsible: z.string(),
    expectedImpact: z.string(),
    effort: z.enum(['low', 'medium', 'high']),
  })),
  overallHealth: z.number(),
  criticalAlerts: z.array(z.string()),
  auditRiskScore: z.number(),
});

export async function predictLifecycle(input: LifecyclePredictionInput): Promise<LifecyclePrediction> {
  const budgetBurn = analyzeBurnRate(input);
  const partnerForecasts = assessPartnerPerformance(input);

  const { object: aiPrediction } = await aiGenerateObject({
    system: `You are an EU project lifecycle prediction expert. Analyze the project state and predict future risks,
compliance issues, and success probability evolution. Consider Romanian administrative context.
Focus on actionable predictions and early warning signals.`,
    prompt: `Project: ${input.projectTitle} (${input.programType})
Duration: ${input.durationMonths} months, ${input.elapsedMonths} elapsed
Budget: €${input.totalBudget.toLocaleString()} (€${input.spentBudget.toLocaleString()} spent)
Burn rate: €${budgetBurn.currentBurnRate}/month

Milestones:
${input.milestones.map(m => `- ${m.name} (${m.id}): ${m.status}, ${m.completionPercentage}% done, due ${m.dueDate}, owner: ${m.responsiblePartner}`).join('\n')}

Partner Performance:
${partnerForecasts.map(p => `- ${p.partnerName} (${p.country}): score ${p.performanceScore}, attrition risk ${p.attritionRisk}%, delivery ${p.deliveryReliability}%`).join('\n')}

${input.recentIssues?.length ? `Recent Issues:\n${input.recentIssues.map(i => `- ${i}`).join('\n')}` : ''}

Predict milestone risks, compliance drift, success evolution, and recommend interventions.`,
    schema: lifecycleSchema,
    schemaName: 'LifecyclePrediction',
    temperature: 0.3,
  });

  // Merge AI milestone risks with input data
  const milestoneRiskAssessment: MilestoneRisk[] = input.milestones.map(m => {
    const aiRisk = aiPrediction.milestoneRisks.find(r => r.milestoneId === m.id);
    return {
      milestoneId: m.id,
      milestoneName: m.name,
      dueDate: m.dueDate,
      riskLevel: aiRisk?.riskLevel || (m.status === 'delayed' ? 'high' : 'low'),
      delayProbability: aiRisk?.delayProbability || (m.status === 'delayed' ? 80 : 20),
      estimatedDelay: aiRisk?.estimatedDelay || 0,
      riskFactors: aiRisk?.riskFactors || [],
      mitigation: aiRisk?.mitigation || [],
      dependencies: m.dependencies || [],
      responsiblePartner: m.responsiblePartner,
    };
  });

  const startDate = new Date(input.startDate);
  const successEvolution: SuccessEvolution[] = aiPrediction.successEvolution.map(se => {
    const d = new Date(startDate);
    d.setMonth(d.getMonth() + se.month);
    return { ...se, date: d.toISOString().slice(0, 10) };
  });

  const interventions: InterventionAction[] = aiPrediction.interventions.map(i => ({
    ...i,
    deadline: new Date(Date.now() + (i.priority === 'immediate' ? 7 : i.priority === 'soon' ? 30 : 90) * 86400000).toISOString().slice(0, 10),
  }));

  return {
    milestoneRiskAssessment,
    budgetBurnPrediction: budgetBurn,
    partnerPerformanceForecast: partnerForecasts,
    complianceRiskTimeline: aiPrediction.complianceRisks.map(cr => ({
      ...cr,
      driftDate: cr.projectedStatus !== 'compliant' ? new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10) : undefined,
    })),
    successProbabilityEvolution: successEvolution,
    interventionRecommendations: interventions,
    overallProjectHealth: aiPrediction.overallHealth,
    criticalAlerts: aiPrediction.criticalAlerts,
    auditRiskScore: aiPrediction.auditRiskScore,
  };
}

// ─── Quick Lifecycle Check (No AI) ───────────────────────────────

export function quickLifecycleCheck(input: LifecyclePredictionInput): {
  health: number;
  alerts: string[];
  budgetStatus: 'on_track' | 'underspend' | 'overspend';
  delayedMilestones: number;
  atRiskPartners: number;
} {
  const budget = analyzeBurnRate(input);
  const partners = assessPartnerPerformance(input);
  const delayedMilestones = input.milestones.filter(m => m.status === 'delayed').length;
  const atRiskPartners = partners.filter(p => p.attritionRisk > 50).length;

  const alerts: string[] = [];
  if (delayedMilestones > 0) alerts.push(`${delayedMilestones} milestone(s) delayed`);
  if (atRiskPartners > 0) alerts.push(`${atRiskPartners} partner(s) at risk`);
  if (budget.underspendRisk) alerts.push('Budget underspend risk');
  if (budget.overspendRisk) alerts.push('Budget overrun risk');

  const health = Math.max(0, 100 - delayedMilestones * 15 - atRiskPartners * 10 - (budget.underspendRisk ? 10 : 0) - (budget.overspendRisk ? 15 : 0));

  return {
    health,
    alerts,
    budgetStatus: budget.overspendRisk ? 'overspend' : budget.underspendRisk ? 'underspend' : 'on_track',
    delayedMilestones,
    atRiskPartners,
  };
}

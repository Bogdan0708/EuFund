// ─── Multi-Partner Intelligence & Analytics ──────────────────────
// Partner performance tracking, collaboration health, capability
// gap analysis, and Romanian consortium context intelligence.

import { aiGenerateObject } from './client';
import { z } from 'zod';

// ─── Types ───────────────────────────────────────────────────────

export interface PartnerMetrics {
  partnerId: string;
  partnerName: string;
  country: string;
  type: 'university' | 'research' | 'sme' | 'large-enterprise' | 'ngo' | 'public-body';
  deliverableQuality: QualityScore;
  timelineAdherence: AdherenceScore;
  budgetManagement: BudgetScore;
  collaborationRating: number; // 0-100
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  overallScore: number; // 0-100
  trend: 'improving' | 'stable' | 'declining';
}

export interface QualityScore {
  score: number; // 0-100
  deliverablesSubmitted: number;
  deliverablesAccepted: number;
  revisionsRequired: number;
  averageRevisionCycles: number;
}

export interface AdherenceScore {
  score: number; // 0-100
  tasksOnTime: number;
  tasksLate: number;
  tasksEarly: number;
  averageDelayDays: number;
  longestDelay: number;
}

export interface BudgetScore {
  score: number; // 0-100
  allocatedBudget: number;
  spentBudget: number;
  burnRate: number; // monthly
  projectedOverrun: number;
  reportingAccuracy: number; // 0-100
}

export interface CollaborationScore {
  overallHealth: number; // 0-100
  communicationFrequency: number;
  responseTime: number; // hours average
  meetingAttendance: number; // percentage
  conflictCount: number;
  knowledgeSharingScore: number; // 0-100
  status: 'healthy' | 'needs-attention' | 'at-risk' | 'critical';
}

export interface PartnerRisk {
  partnerId: string;
  partnerName: string;
  riskCategory: 'financial' | 'operational' | 'compliance' | 'technical' | 'reputational';
  severity: 'low' | 'medium' | 'high' | 'critical';
  probability: number; // 0-1
  impact: string;
  impactRo: string;
  mitigationActions: string[];
  earlyWarningSignals: string[];
}

export interface BudgetOptimization {
  currentDistribution: { partnerId: string; allocated: number; optimal: number; delta: number }[];
  totalBudget: number;
  optimizedTotal: number;
  savings: number;
  recommendations: string[];
  recommendationsRo: string[];
}

export interface SkillGap {
  capability: string;
  requiredLevel: number;
  currentLevel: number;
  gap: number;
  coveredByPartners: string[];
  suggestedAction: string;
  suggestedActionRo: string;
}

export interface ConsortiumAnalysis {
  partnerPerformance: PartnerMetrics[];
  collaborationHealth: CollaborationScore;
  riskAssessment: PartnerRisk[];
  optimizationSuggestions: string[];
  optimizationSuggestionsRo: string[];
  budgetDistribution: BudgetOptimization;
  capabilityGaps: SkillGap[];
  smeCompliance: SMEComplianceStatus;
  geographicSpread: GeographicAnalysis;
  overallConsortiumScore: number;
}

export interface SMEComplianceStatus {
  smeCount: number;
  totalPartners: number;
  smePercentage: number;
  smeBudgetPercentage: number;
  meetsRequirement: boolean;
  requiredPercentage: number;
  gap: number;
}

export interface GeographicAnalysis {
  countries: string[];
  euCountryCount: number;
  nonEuCount: number;
  meetsSpreadRequirement: boolean;
  requiredCountries: number;
  underrepresentedRegions: string[];
}

// ─── Input Types ─────────────────────────────────────────────────

export interface PartnerData {
  id: string;
  name: string;
  country: string;
  type: PartnerMetrics['type'];
  budget: { allocated: number; spent: number; currency: 'EUR' | 'RON' };
  deliverables: {
    id: string;
    title: string;
    dueDate: string;
    submittedDate?: string;
    status: 'pending' | 'submitted' | 'accepted' | 'revision-needed' | 'rejected';
    qualityScore?: number;
    revisionCount?: number;
  }[];
  tasks: {
    id: string;
    name: string;
    plannedEnd: string;
    actualEnd?: string;
    status: 'not-started' | 'in-progress' | 'completed' | 'delayed';
  }[];
  capabilities: string[];
  communicationLog?: {
    meetingsAttended: number;
    totalMeetings: number;
    avgResponseHours: number;
    messagesExchanged: number;
  };
  romanianContext?: {
    isRomanian: boolean;
    publicProcurementRequired: boolean;
    anafRegistered: boolean;
    sicapRegistered: boolean;
  };
}

export interface ConsortiumAnalysisInput {
  projectId: string;
  partners: PartnerData[];
  programType: string;
  requiredCapabilities: string[];
  smeRequirementPercent?: number; // default 20%
  requiredCountries?: number; // default 3
  locale?: 'ro' | 'en';
}

// ─── Partner Performance Calculation ─────────────────────────────

function calculatePartnerMetrics(partner: PartnerData): PartnerMetrics {
  // Quality score
  const accepted = partner.deliverables.filter(d => d.status === 'accepted').length;
  const submitted = partner.deliverables.filter(d => ['submitted', 'accepted', 'revision-needed', 'rejected'].includes(d.status)).length;
  const totalRevisions = partner.deliverables.reduce((sum, d) => sum + (d.revisionCount ?? 0), 0);
  const qualityScore: QualityScore = {
    score: submitted > 0 ? Math.round((accepted / submitted) * 100 - (totalRevisions * 5)) : 50,
    deliverablesSubmitted: submitted,
    deliverablesAccepted: accepted,
    revisionsRequired: partner.deliverables.filter(d => d.status === 'revision-needed').length,
    averageRevisionCycles: submitted > 0 ? Math.round(totalRevisions / submitted * 10) / 10 : 0,
  };
  qualityScore.score = Math.max(0, Math.min(100, qualityScore.score));

  // Timeline adherence
  const completedTasks = partner.tasks.filter(t => t.status === 'completed' && t.actualEnd);
  let onTime = 0, late = 0, early = 0, totalDelay = 0, maxDelay = 0;
  for (const task of completedTasks) {
    const planned = new Date(task.plannedEnd);
    const actual = new Date(task.actualEnd!);
    const diff = Math.round((actual.getTime() - planned.getTime()) / (1000 * 60 * 60 * 24));
    if (diff <= 0) { early++; if (diff === 0) onTime++; }
    else { late++; totalDelay += diff; maxDelay = Math.max(maxDelay, diff); }
  }
  const adherenceScore: AdherenceScore = {
    score: completedTasks.length > 0
      ? Math.max(0, Math.min(100, 100 - (late / completedTasks.length) * 50 - Math.min(totalDelay, 50)))
      : 50,
    tasksOnTime: onTime,
    tasksLate: late,
    tasksEarly: early,
    averageDelayDays: late > 0 ? Math.round(totalDelay / late) : 0,
    longestDelay: maxDelay,
  };

  // Budget management
  const burnRate = partner.budget.spent / Math.max(1, completedTasks.length);
  const remainingTasks = partner.tasks.filter(t => t.status !== 'completed').length;
  const projectedTotal = partner.budget.spent + burnRate * remainingTasks;
  const budgetScore: BudgetScore = {
    score: Math.max(0, Math.min(100,
      100 - Math.abs((partner.budget.spent / Math.max(1, partner.budget.allocated)) * 100 - 50) * 0.5
    )),
    allocatedBudget: partner.budget.allocated,
    spentBudget: partner.budget.spent,
    burnRate,
    projectedOverrun: Math.max(0, projectedTotal - partner.budget.allocated),
    reportingAccuracy: 85, // default, would be calculated from actual reporting data
  };

  // Collaboration rating
  const comm = partner.communicationLog;
  const collaborationRating = comm
    ? Math.round(
        (comm.meetingsAttended / Math.max(1, comm.totalMeetings)) * 40 +
        Math.max(0, 30 - comm.avgResponseHours) * (30 / 30) +
        Math.min(30, comm.messagesExchanged / 10)
      )
    : 50;

  // Overall score (weighted)
  const overallScore = Math.round(
    qualityScore.score * 0.3 +
    adherenceScore.score * 0.3 +
    budgetScore.score * 0.2 +
    collaborationRating * 0.2
  );

  // Risk level
  const riskLevel: PartnerMetrics['riskLevel'] =
    overallScore < 30 ? 'critical' :
    overallScore < 50 ? 'high' :
    overallScore < 70 ? 'medium' : 'low';

  // Trend (simplified - would use historical data in production)
  const recentTasks = partner.tasks.filter(t => t.status === 'completed').slice(-3);
  const recentLate = recentTasks.filter(t => {
    if (!t.actualEnd) return false;
    return new Date(t.actualEnd) > new Date(t.plannedEnd);
  }).length;
  const trend: PartnerMetrics['trend'] =
    recentLate === 0 ? 'improving' :
    recentLate >= 2 ? 'declining' : 'stable';

  return {
    partnerId: partner.id,
    partnerName: partner.name,
    country: partner.country,
    type: partner.type,
    deliverableQuality: qualityScore,
    timelineAdherence: adherenceScore,
    budgetManagement: budgetScore,
    collaborationRating,
    riskLevel,
    overallScore,
    trend,
  };
}

// ─── Risk Assessment ─────────────────────────────────────────────

function assessPartnerRisks(partners: PartnerData[], metrics: PartnerMetrics[]): PartnerRisk[] {
  const risks: PartnerRisk[] = [];

  for (const partner of partners) {
    const m = metrics.find(pm => pm.partnerId === partner.id);
    if (!m) continue;

    // Financial risk
    if (m.budgetManagement.projectedOverrun > 0) {
      risks.push({
        partnerId: partner.id,
        partnerName: partner.name,
        riskCategory: 'financial',
        severity: m.budgetManagement.projectedOverrun > m.budgetManagement.allocatedBudget * 0.2 ? 'high' : 'medium',
        probability: 0.6,
        impact: `Projected budget overrun of €${m.budgetManagement.projectedOverrun.toLocaleString()}`,
        impactRo: `Depășire de buget estimată de €${m.budgetManagement.projectedOverrun.toLocaleString()}`,
        mitigationActions: ['Review spending patterns', 'Negotiate cost reductions', 'Reallocate from underspent categories'],
        earlyWarningSignals: ['Monthly burn rate exceeding plan', 'Unplanned expenditures', 'Late financial reports'],
      });
    }

    // Operational risk
    if (m.timelineAdherence.score < 60) {
      risks.push({
        partnerId: partner.id,
        partnerName: partner.name,
        riskCategory: 'operational',
        severity: m.timelineAdherence.score < 40 ? 'high' : 'medium',
        probability: 0.7,
        impact: `Average ${m.timelineAdherence.averageDelayDays} days delay per task`,
        impactRo: `Întârziere medie de ${m.timelineAdherence.averageDelayDays} zile pe sarcină`,
        mitigationActions: ['Increase monitoring frequency', 'Assign backup resources', 'Simplify task scope'],
        earlyWarningSignals: ['Missed intermediate milestones', 'Resource unavailability', 'Scope creep'],
      });
    }

    // Compliance risk for Romanian partners
    if (partner.romanianContext?.isRomanian) {
      if (!partner.romanianContext.anafRegistered || !partner.romanianContext.sicapRegistered) {
        risks.push({
          partnerId: partner.id,
          partnerName: partner.name,
          riskCategory: 'compliance',
          severity: 'high',
          probability: 0.8,
          impact: 'Missing Romanian regulatory registrations may block fund disbursement',
          impactRo: 'Lipsa înregistrărilor reglementare române poate bloca decontarea fondurilor',
          mitigationActions: [
            !partner.romanianContext.anafRegistered ? 'Complete ANAF registration immediately' : '',
            !partner.romanianContext.sicapRegistered ? 'Register in SICAP for public procurement eligibility' : '',
          ].filter(Boolean),
          earlyWarningSignals: ['Registration deadlines approaching', 'Regulatory changes', 'Audit notifications'],
        });
      }

      if (partner.romanianContext.publicProcurementRequired) {
        risks.push({
          partnerId: partner.id,
          partnerName: partner.name,
          riskCategory: 'compliance',
          severity: 'medium',
          probability: 0.5,
          impact: 'Public procurement process may cause 30-60 day delays',
          impactRo: 'Procesul de achiziție publică poate cauza întârzieri de 30-60 zile',
          mitigationActions: ['Start procurement planning early', 'Prepare documentation templates', 'Engage procurement specialist'],
          earlyWarningSignals: ['Procurement timeline slipping', 'Challenge/contestation filed', 'SICAP system issues'],
        });
      }
    }

    // Quality risk
    if (m.deliverableQuality.score < 50) {
      risks.push({
        partnerId: partner.id,
        partnerName: partner.name,
        riskCategory: 'technical',
        severity: m.deliverableQuality.score < 30 ? 'critical' : 'high',
        probability: 0.65,
        impact: `Low deliverable quality (${m.deliverableQuality.score}/100) - average ${m.deliverableQuality.averageRevisionCycles} revision cycles`,
        impactRo: `Calitate scăzută a livrabilelor (${m.deliverableQuality.score}/100) - medie ${m.deliverableQuality.averageRevisionCycles} cicluri de revizuire`,
        mitigationActions: ['Implement quality review process', 'Provide templates and guidelines', 'Assign technical mentor'],
        earlyWarningSignals: ['Increasing revision cycles', 'Reviewer complaints', 'Delayed submissions'],
      });
    }
  }

  return risks.sort((a, b) => {
    const sev = { critical: 0, high: 1, medium: 2, low: 3 };
    return sev[a.severity] - sev[b.severity];
  });
}

// ─── SME & Geographic Compliance ─────────────────────────────────

function analyzeSMECompliance(partners: PartnerData[], requiredPercent: number): SMEComplianceStatus {
  const smePartners = partners.filter(p => p.type === 'sme');
  const totalBudget = partners.reduce((sum, p) => sum + p.budget.allocated, 0);
  const smeBudget = smePartners.reduce((sum, p) => sum + p.budget.allocated, 0);

  return {
    smeCount: smePartners.length,
    totalPartners: partners.length,
    smePercentage: Math.round((smePartners.length / Math.max(1, partners.length)) * 100),
    smeBudgetPercentage: Math.round((smeBudget / Math.max(1, totalBudget)) * 100),
    meetsRequirement: (smePartners.length / Math.max(1, partners.length)) * 100 >= requiredPercent,
    requiredPercentage: requiredPercent,
    gap: Math.max(0, requiredPercent - (smePartners.length / Math.max(1, partners.length)) * 100),
  };
}

function analyzeGeographicSpread(partners: PartnerData[], requiredCountries: number): GeographicAnalysis {
  const EU_COUNTRIES = new Set([
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
    'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
    'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  ]);

  const countries = [...new Set(partners.map(p => p.country))];
  const euCountries = countries.filter(c => EU_COUNTRIES.has(c));
  const nonEuCountries = countries.filter(c => !EU_COUNTRIES.has(c));

  const underrepresented = ['EU13', 'Balkans', 'Baltic'].filter(region => {
    const regionCountries: Record<string, string[]> = {
      'EU13': ['BG', 'HR', 'CY', 'CZ', 'EE', 'HU', 'LV', 'LT', 'MT', 'PL', 'RO', 'SK', 'SI'],
      'Balkans': ['BG', 'HR', 'RO', 'SI'],
      'Baltic': ['EE', 'LV', 'LT'],
    };
    return !countries.some(c => regionCountries[region]?.includes(c));
  });

  return {
    countries,
    euCountryCount: euCountries.length,
    nonEuCount: nonEuCountries.length,
    meetsSpreadRequirement: euCountries.length >= requiredCountries,
    requiredCountries,
    underrepresentedRegions: underrepresented,
  };
}

// ─── Capability Gap Analysis ─────────────────────────────────────

function analyzeCapabilityGaps(
  partners: PartnerData[],
  requiredCapabilities: string[]
): SkillGap[] {
  const gaps: SkillGap[] = [];
  const allCapabilities = partners.flatMap(p => p.capabilities);

  for (const required of requiredCapabilities) {
    const coveringPartners = partners
      .filter(p => p.capabilities.some(c =>
        c.toLowerCase().includes(required.toLowerCase()) ||
        required.toLowerCase().includes(c.toLowerCase())
      ))
      .map(p => p.name);

    const currentLevel = Math.min(100, coveringPartners.length * 33);
    const requiredLevel = 66; // at least 2 partners should cover each capability

    if (currentLevel < requiredLevel) {
      gaps.push({
        capability: required,
        requiredLevel,
        currentLevel,
        gap: requiredLevel - currentLevel,
        coveredByPartners: coveringPartners,
        suggestedAction: coveringPartners.length === 0
          ? `No partner covers "${required}". Consider adding a specialized partner or subcontractor.`
          : `Only ${coveringPartners.length} partner(s) cover "${required}". Reduce single-point-of-failure risk.`,
        suggestedActionRo: coveringPartners.length === 0
          ? `Niciun partener nu acoperă "${required}". Luați în considerare adăugarea unui partener sau subcontractor specializat.`
          : `Doar ${coveringPartners.length} partener(i) acoperă "${required}". Reduceți riscul de dependență unică.`,
      });
    }
  }

  return gaps.sort((a, b) => b.gap - a.gap);
}

// ─── Budget Distribution Optimization ────────────────────────────

function optimizeBudgetDistribution(partners: PartnerData[], metrics: PartnerMetrics[]): BudgetOptimization {
  const totalBudget = partners.reduce((sum, p) => sum + p.budget.allocated, 0);
  const distribution: BudgetOptimization['currentDistribution'] = [];
  const recommendations: string[] = [];
  const recommendationsRo: string[] = [];

  for (const partner of partners) {
    const m = metrics.find(pm => pm.partnerId === partner.id);
    const currentAlloc = partner.budget.allocated;
    const performanceFactor = m ? m.overallScore / 100 : 0.5;
    // Optimal allocation considers performance and remaining work
    const remainingTasks = partner.tasks.filter(t => t.status !== 'completed').length;
    const totalTasks = partner.tasks.length || 1;
    const workFactor = remainingTasks / totalTasks;
    const optimal = Math.round(currentAlloc * (0.7 + performanceFactor * 0.3) * (0.5 + workFactor * 0.5));

    distribution.push({
      partnerId: partner.id,
      allocated: currentAlloc,
      optimal,
      delta: optimal - currentAlloc,
    });

    if (optimal < currentAlloc * 0.8) {
      recommendations.push(`Consider reducing allocation to ${partner.name} - underperforming (score: ${m?.overallScore}/100)`);
      recommendationsRo.push(`Luați în considerare reducerea alocării pentru ${partner.name} - performanță scăzută (scor: ${m?.overallScore}/100)`);
    }
  }

  const optimizedTotal = distribution.reduce((sum, d) => sum + d.optimal, 0);

  return {
    currentDistribution: distribution,
    totalBudget,
    optimizedTotal,
    savings: Math.max(0, totalBudget - optimizedTotal),
    recommendations,
    recommendationsRo,
  };
}

// ─── Main Analysis ───────────────────────────────────────────────

export async function analyzeConsortium(input: ConsortiumAnalysisInput): Promise<ConsortiumAnalysis> {
  // Calculate partner metrics
  const partnerPerformance = input.partners.map(calculatePartnerMetrics);

  // Collaboration health (aggregate)
  const comms = input.partners.map(p => p.communicationLog).filter(Boolean);
  const collaborationHealth: CollaborationScore = {
    overallHealth: comms.length > 0
      ? Math.round(comms.reduce((sum, c) => sum + (c!.meetingsAttended / Math.max(1, c!.totalMeetings)) * 100, 0) / comms.length)
      : 50,
    communicationFrequency: comms.length > 0
      ? Math.round(comms.reduce((sum, c) => sum + c!.messagesExchanged, 0) / comms.length)
      : 0,
    responseTime: comms.length > 0
      ? Math.round(comms.reduce((sum, c) => sum + c!.avgResponseHours, 0) / comms.length * 10) / 10
      : 24,
    meetingAttendance: comms.length > 0
      ? Math.round(comms.reduce((sum, c) => sum + (c!.meetingsAttended / Math.max(1, c!.totalMeetings)) * 100, 0) / comms.length)
      : 50,
    conflictCount: 0,
    knowledgeSharingScore: 50,
    status: 'healthy',
  };

  const avgHealth = collaborationHealth.overallHealth;
  collaborationHealth.status =
    avgHealth >= 75 ? 'healthy' :
    avgHealth >= 50 ? 'needs-attention' :
    avgHealth >= 25 ? 'at-risk' : 'critical';

  // Risk assessment
  const riskAssessment = assessPartnerRisks(input.partners, partnerPerformance);

  // Budget optimization
  const budgetDistribution = optimizeBudgetDistribution(input.partners, partnerPerformance);

  // Capability gaps
  const capabilityGaps = analyzeCapabilityGaps(input.partners, input.requiredCapabilities);

  // SME compliance
  const smeCompliance = analyzeSMECompliance(input.partners, input.smeRequirementPercent ?? 20);

  // Geographic analysis
  const geographicSpread = analyzeGeographicSpread(input.partners, input.requiredCountries ?? 3);

  // Overall suggestions
  const suggestions: string[] = [];
  const suggestionsRo: string[] = [];

  if (!smeCompliance.meetsRequirement) {
    suggestions.push(`SME participation at ${smeCompliance.smePercentage}% (need ${smeCompliance.requiredPercentage}%). Add SME partners.`);
    suggestionsRo.push(`Participarea IMM-urilor la ${smeCompliance.smePercentage}% (necesită ${smeCompliance.requiredPercentage}%). Adăugați parteneri IMM.`);
  }
  if (!geographicSpread.meetsSpreadRequirement) {
    suggestions.push(`Only ${geographicSpread.euCountryCount} EU countries (need ${geographicSpread.requiredCountries}). Expand geographic reach.`);
    suggestionsRo.push(`Doar ${geographicSpread.euCountryCount} țări UE (necesită ${geographicSpread.requiredCountries}). Extindeți acoperirea geografică.`);
  }
  if (capabilityGaps.length > 0) {
    suggestions.push(`${capabilityGaps.length} capability gaps identified. Address critical skill shortages.`);
    suggestionsRo.push(`${capabilityGaps.length} deficiențe de competențe identificate. Abordați lipsurile critice de competențe.`);
  }

  const criticalRisks = riskAssessment.filter(r => r.severity === 'critical').length;
  if (criticalRisks > 0) {
    suggestions.push(`${criticalRisks} critical partner risks require immediate attention.`);
    suggestionsRo.push(`${criticalRisks} riscuri critice ale partenerilor necesită atenție imediată.`);
  }

  // Overall score
  const overallConsortiumScore = Math.round(
    partnerPerformance.reduce((sum, p) => sum + p.overallScore, 0) / Math.max(1, partnerPerformance.length) * 0.4 +
    collaborationHealth.overallHealth * 0.2 +
    (smeCompliance.meetsRequirement ? 20 : 10) +
    (geographicSpread.meetsSpreadRequirement ? 20 : 10) -
    criticalRisks * 5
  );

  return {
    partnerPerformance,
    collaborationHealth,
    riskAssessment,
    optimizationSuggestions: suggestions,
    optimizationSuggestionsRo: suggestionsRo,
    budgetDistribution,
    capabilityGaps,
    smeCompliance,
    geographicSpread,
    overallConsortiumScore: Math.max(0, Math.min(100, overallConsortiumScore)),
  };
}

// ─── Quick Partner Health Check ──────────────────────────────────

export function quickPartnerCheck(partner: PartnerData): {
  score: number;
  status: 'good' | 'warning' | 'critical';
  topIssue?: string;
} {
  const metrics = calculatePartnerMetrics(partner);
  return {
    score: metrics.overallScore,
    status: metrics.overallScore >= 70 ? 'good' : metrics.overallScore >= 40 ? 'warning' : 'critical',
    topIssue: metrics.overallScore < 70
      ? metrics.deliverableQuality.score < metrics.timelineAdherence.score
        ? 'Deliverable quality needs improvement'
        : 'Timeline adherence is below target'
      : undefined,
  };
}

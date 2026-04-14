// ─── Project Intelligence Integration Layer ─────────────────────
// Centralized AI coordination: health monitoring, predictive analytics,
// and unified project analysis orchestrating all AI features.

import { analyzeDeadlines, quickRiskCheck, type WorkPackageStatus } from './deadline-intelligence';
import { assessRisk, type RiskAssessmentInput, type RiskAssessment } from './risk-assessment';
import { analyzeCompliance, type ComplianceCheckInput, type ComplianceAnalysis } from './compliance-engine';
import { EU_PROGRAMS, type EUProgramKey } from './eu-knowledge-base';
import { LRUCache } from 'lru-cache';

// ─── Types ───────────────────────────────────────────────────────

export interface ProjectHealthReport {
  projectId: string;
  projectTitle: string;
  timestamp: string;
  overallHealth: 'excellent' | 'good' | 'at_risk' | 'critical';
  healthScore: number; // 0-100
  summary: string;
  dimensions: {
    timeline: { score: number; status: string; alerts: string[] };
    budget: { score: number; status: string; alerts: string[] };
    compliance: { score: number; status: string; alerts: string[] };
    risk: { score: number; status: string; alerts: string[] };
  };
  topRecommendations: string[];
  nextActions: { action: string; priority: 'immediate' | 'soon' | 'planned'; owner?: string }[];
}

export interface ProjectAnalysisRequest {
  projectId: string;
  projectTitle: string;
  projectSummary: string;
  programType: EUProgramKey;
  budget: number;
  spentBudget: number;
  durationMonths: number;
  elapsedMonths: number;
  startDate: string;
  endDate: string;
  submissionDeadline?: string;
  workPackages: WorkPackageStatus[];
  partners: RiskAssessmentInput['partners'];
  organization: ComplianceCheckInput['organization'];
  compliance?: RiskAssessmentInput['compliance'];
  romanianContext?: RiskAssessmentInput['romanianContext'];
  dataProtection?: ComplianceCheckInput['dataProtection'];
  ethics?: ComplianceCheckInput['ethics'];
  objectives?: string[];
  methodology?: string;
  locale?: 'ro' | 'en';
}

export interface FullProjectAnalysis {
  health: ProjectHealthReport;
  deadlines: Awaited<ReturnType<typeof analyzeDeadlines>>;
  risk: RiskAssessment;
  compliance: ComplianceAnalysis;
  programInsights: ProgramInsights;
}

export interface ProgramInsights {
  program: string;
  successRate: string;
  keyTips: string[];
  romanianAdvantages: string[];
  commonPitfalls: string[];
}

// ─── Cache ───────────────────────────────────────────────────────

const ANALYSIS_CACHE_VERSION = 'v1';
const analysisCache = new LRUCache<string, FullProjectAnalysis>({
  max: 1000,
  ttl: 5 * 60 * 1000,
});

function getCached(key: string): FullProjectAnalysis | null {
  return analysisCache.get(key) ?? null;
}

// ─── Quick Health Check (no AI calls) ────────────────────────────

export function getProjectHealthQuick(
  projectId: string,
  projectTitle: string,
  workPackages: WorkPackageStatus[],
  deadline: string,
  budget: number,
  spentBudget: number,
): ProjectHealthReport {
  const risk = quickRiskCheck(workPackages, deadline);
  const budgetRatio = budget > 0 ? spentBudget / budget : 0;

  const timelineScore = Math.max(0, 100 - (risk.alerts.length * 25));
  const budgetScore = budgetRatio > 1 ? 20 : budgetRatio > 0.9 ? 50 : 80;
  const healthScore = Math.round((timelineScore + budgetScore) / 2);

  return {
    projectId,
    projectTitle,
    timestamp: new Date().toISOString(),
    overallHealth: healthScore >= 80 ? 'excellent' : healthScore >= 60 ? 'good' : healthScore >= 40 ? 'at_risk' : 'critical',
    healthScore,
    summary: `Progress: ${risk.progress.toFixed(0)}%, ${risk.daysRemaining} days remaining, Risk: ${risk.riskLevel}`,
    dimensions: {
      timeline: { score: timelineScore, status: risk.riskLevel, alerts: risk.alerts },
      budget: { score: budgetScore, status: budgetRatio > 1 ? 'over_budget' : 'on_track', alerts: budgetRatio > 0.9 ? ['Budget nearly exhausted'] : [] },
      compliance: { score: 50, status: 'not_assessed', alerts: [] },
      risk: { score: 100 - (risk.alerts.length * 20), status: risk.riskLevel, alerts: [] },
    },
    topRecommendations: risk.alerts,
    nextActions: risk.alerts.map(a => ({ action: a, priority: 'immediate' as const })),
  };
}

// ─── Full Project Analysis (orchestrates all AI features) ────────

export async function analyzeProject(request: ProjectAnalysisRequest): Promise<FullProjectAnalysis> {
  const cacheKey = `${ANALYSIS_CACHE_VERSION}:${request.projectId}-${request.locale ?? 'en'}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // Run all analyses in parallel
  const [deadlineResult, riskResult, complianceResult] = await Promise.allSettled([
    analyzeDeadlines({
      projectId: request.projectId,
      projectTitle: request.projectTitle,
      submissionDeadline: request.submissionDeadline,
      projectStart: request.startDate,
      projectEnd: request.endDate,
      workPackages: request.workPackages,
      locale: request.locale,
    }),
    assessRisk({
      project: {
        title: request.projectTitle,
        summary: request.projectSummary,
        programType: request.programType,
        totalBudget: request.budget,
        spentBudget: request.spentBudget,
        durationMonths: request.durationMonths,
        elapsedMonths: request.elapsedMonths,
        startDate: request.startDate,
        endDate: request.endDate,
      },
      workPackages: request.workPackages,
      partners: request.partners,
      compliance: request.compliance,
      romanianContext: request.romanianContext,
      locale: request.locale,
    }),
    analyzeCompliance({
      project: {
        title: request.projectTitle,
        summary: request.projectSummary,
        objectives: request.objectives,
        methodology: request.methodology,
        budget: request.budget,
        durationMonths: request.durationMonths,
      },
      organization: request.organization,
      consortium: request.partners.length > 0 ? {
        partners: request.partners.map(p => ({
          name: p.name,
          country: p.country,
          type: p.type,
          role: p.role,
        })),
      } : undefined,
      program: request.programType,
      dataProtection: request.dataProtection,
      ethics: request.ethics,
      locale: request.locale,
    }),
  ]);

  const deadlines = deadlineResult.status === 'fulfilled' ? deadlineResult.value : null;
  const risk = riskResult.status === 'fulfilled' ? riskResult.value : null;
  const compliance = complianceResult.status === 'fulfilled' ? complianceResult.value : null;

  // Program insights
  const programInfo = EU_PROGRAMS[request.programType];
  const programInsights: ProgramInsights = {
    program: programInfo?.name || request.programType,
    successRate: programInfo?.successRate || 'Unknown',
    keyTips: programInfo?.tips || [],
    romanianAdvantages: programInfo?.romanianAdvantages || [],
    commonPitfalls: programInfo?.commonPitfalls || [],
  };

  // Build health report
  const timelineScore = deadlines ? (deadlines.timeline.isOnTrack ? 80 : Math.max(10, 100 - deadlines.timeline.delayDays)) : 50;
  const budgetScore = risk?.dimensions.budget.score ?? 50;
  const complianceScore = compliance?.overallScore ?? 50;
  const riskScore = risk ? (100 - risk.overallScore) : 50;
  const healthScore = Math.round((timelineScore + budgetScore + complianceScore + riskScore) / 4);

  const health: ProjectHealthReport = {
    projectId: request.projectId,
    projectTitle: request.projectTitle,
    timestamp: new Date().toISOString(),
    overallHealth: healthScore >= 80 ? 'excellent' : healthScore >= 60 ? 'good' : healthScore >= 40 ? 'at_risk' : 'critical',
    healthScore,
    summary: [
      deadlines ? `Timeline: ${deadlines.riskLevel}` : null,
      risk ? `Risk: ${risk.overallRisk}` : null,
      compliance ? `Compliance: ${compliance.overallScore}/100` : null,
    ].filter(Boolean).join(' | '),
    dimensions: {
      timeline: {
        score: timelineScore,
        status: deadlines?.riskLevel || 'unknown',
        alerts: deadlines?.riskFactors.slice(0, 3) || [],
      },
      budget: {
        score: budgetScore,
        status: risk?.dimensions.budget.level || 'unknown',
        alerts: risk?.dimensions.budget.factors.slice(0, 3) || [],
      },
      compliance: {
        score: complianceScore,
        status: compliance?.criticalIssues.length ? 'issues_found' : 'ok',
        alerts: compliance?.criticalIssues.map(i => i.description).slice(0, 3) || [],
      },
      risk: {
        score: riskScore,
        status: risk?.overallRisk || 'unknown',
        alerts: risk?.actionPlan.filter(a => a.priority === 'immediate').map(a => a.action).slice(0, 3) || [],
      },
    },
    topRecommendations: [
      ...(deadlines?.recommendations.slice(0, 2) || []),
      ...(risk?.actionPlan.filter(a => a.priority === 'immediate').map(a => a.action).slice(0, 2) || []),
      ...(compliance?.improvementPlan.slice(0, 2).map(s => s.action) || []),
    ].slice(0, 5),
    nextActions: [
      ...(risk?.actionPlan.slice(0, 3).map(a => ({
        action: a.action,
        priority: a.priority === 'immediate' ? 'immediate' : a.priority === 'short_term' ? 'soon' : 'planned',
        owner: a.responsible,
      }) as { action: string; priority: 'immediate' | 'soon' | 'planned'; owner?: string }) || []),
    ],
  };

  // Assemble full result with fallbacks
  const fallbackDeadlines = {
    riskLevel: 'medium' as const,
    daysUntilDeadline: 0,
    completionProbability: 0.5,
    riskFactors: ['Analysis unavailable'],
    recommendations: [],
    mitigationSteps: [],
    bottlenecks: [],
    timeline: { overallProgress: 0, expectedCompletionDate: request.endDate, isOnTrack: false, delayDays: 0, criticalPath: [] },
  };

  const fallbackRisk: RiskAssessment = {
    overallRisk: 'medium',
    overallScore: 50,
    dimensions: {
      timeline: { score: 50, level: 'medium', factors: [], mitigations: [] },
      budget: { score: 50, level: 'medium', factors: [], mitigations: [] },
      technical: { score: 50, level: 'medium', factors: [], mitigations: [] },
      partnership: { score: 50, level: 'medium', factors: [], mitigations: [] },
      compliance: { score: 50, level: 'medium', factors: [], mitigations: [] },
      external: { score: 50, level: 'medium', factors: [], mitigations: [] },
    },
    romanianFactors: [],
    riskMatrix: [],
    predictedOutcome: { successProbability: 0.5, likelyCompletionDate: request.endDate, budgetForecast: request.budget, scenarioBest: '', scenarioWorst: '', scenarioMostLikely: '' },
    actionPlan: [],
  };

  const fallbackCompliance: ComplianceAnalysis = {
    overallScore: 50,
    criteriaScores: {},
    criticalIssues: [],
    improvementPlan: [],
    programSpecific: { program: request.programType, eligibilityMet: false, eligibilityGaps: [], evaluationCriteria: [], estimatedEvaluationScore: 0 },
    legalReferences: [],
    tokensUsed: 0,
  };

  const result: FullProjectAnalysis = {
    health,
    deadlines: deadlines || fallbackDeadlines,
    risk: risk || fallbackRisk,
    compliance: compliance || fallbackCompliance,
    programInsights,
  };

  analysisCache.set(cacheKey, result);
  return result;
}

// ─── Batch Analysis ──────────────────────────────────────────────

export async function analyzeProjectsBatch(
  requests: ProjectAnalysisRequest[],
  concurrency = 3,
): Promise<Map<string, FullProjectAnalysis>> {
  const results = new Map<string, FullProjectAnalysis>();

  for (let i = 0; i < requests.length; i += concurrency) {
    const batch = requests.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(r => analyzeProject(r)));
    batchResults.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        results.set(batch[idx].projectId, r.value);
      }
    });
  }

  return results;
}

// ─── Clear Cache ─────────────────────────────────────────────────

export function clearAnalysisCache(): void {
  analysisCache.clear();
}

// ─── Phase 3: Predictive Project Intelligence ───────────────────

export interface PredictiveProjectIntelligence {
  successPrediction: { successProbability: number; confidenceLevel: string; topFactors: string[] } | null;
  partnerRecommendationCount: number;
  lifecycleForecast: { health: number; criticalAlerts: string[] } | null;
  knowledgeInsights: { qualityScore: number; readiness: string } | null;
  marketIntelligence: { opportunityCount: number; trendingTopics: string[] } | null;
  actionPriorities: { action: string; priority: string; category: string }[];
}

/**
 * Phase 3 orchestration: combines predictive analytics with existing project analysis.
 * Returns lightweight summary suitable for dashboard integration.
 */
export async function getPredictiveIntelligence(
  projectAnalysis: FullProjectAnalysis,
  predictionData?: { successProbability: number; confidenceLevel: string; criticalFactors: { factor: string }[] },
  lifecycleData?: { overallProjectHealth: number; criticalAlerts: string[]; interventionRecommendations: { action: string; priority: string; category: string }[] },
  knowledgeData?: { overallQualityScore: number; readinessLevel: string },
  marketData?: { opportunityAlerts: { title: string }[]; realTimeMarketData: { trendingTopics: { topic: string }[] } },
): Promise<PredictiveProjectIntelligence> {
  return {
    successPrediction: predictionData ? {
      successProbability: predictionData.successProbability,
      confidenceLevel: predictionData.confidenceLevel,
      topFactors: predictionData.criticalFactors.slice(0, 3).map(f => f.factor),
    } : null,
    partnerRecommendationCount: 0,
    lifecycleForecast: lifecycleData ? {
      health: lifecycleData.overallProjectHealth,
      criticalAlerts: lifecycleData.criticalAlerts,
    } : null,
    knowledgeInsights: knowledgeData ? {
      qualityScore: knowledgeData.overallQualityScore,
      readiness: knowledgeData.readinessLevel,
    } : null,
    marketIntelligence: marketData ? {
      opportunityCount: marketData.opportunityAlerts.length,
      trendingTopics: marketData.realTimeMarketData.trendingTopics.slice(0, 5).map(t => t.topic),
    } : null,
    actionPriorities: [
      ...projectAnalysis.health.nextActions.map(a => ({ action: a.action, priority: a.priority, category: 'project' })),
      ...(lifecycleData?.interventionRecommendations.slice(0, 3).map(i => ({ action: i.action, priority: i.priority, category: i.category })) || []),
    ].slice(0, 10),
  };
}

// ─── Phase 2: Advanced Project Health Orchestration ──────────────

export interface ProjectHealthAnalysis {
  timelineHealth: { score: number; status: string; criticalPath: string[]; bottleneckCount: number };
  consortiumHealth: { score: number; status: string; partnerCount: number; atRiskPartners: number };
  budgetHealth: { score: number; status: string; burnRate: number; forecastAccuracy: number };
  overallRisk: { level: string; score: number; topRisks: string[] };
  actionPriorities: { action: string; priority: 'immediate' | 'soon' | 'planned'; owner?: string; category: string }[];
  executiveSummary: string;
  executiveSummaryRo: string;
}

/**
 * Phase 2 unified health analysis combining timeline, consortium, and budget intelligence.
 * Designed to power the real-time project health dashboard.
 */
export async function getAdvancedProjectHealth(
  projectAnalysis: FullProjectAnalysis,
  timelineData?: { criticalPath: string[]; bottlenecks: number; feasibilityScore: number },
  consortiumData?: { overallScore: number; atRiskPartners: number; partnerCount: number },
  budgetData?: { overallHealth: number; burnRate: number; forecastAccuracy: number },
): Promise<ProjectHealthAnalysis> {
  const { health } = projectAnalysis;

  const timelineHealth = {
    score: timelineData?.feasibilityScore ?? health.dimensions.timeline.score,
    status: health.dimensions.timeline.status,
    criticalPath: timelineData?.criticalPath ?? [],
    bottleneckCount: timelineData?.bottlenecks ?? 0,
  };

  const consortiumHealth = {
    score: consortiumData?.overallScore ?? 50,
    status: consortiumData ? (consortiumData.overallScore >= 70 ? 'healthy' : 'needs-attention') : 'not-assessed',
    partnerCount: consortiumData?.partnerCount ?? 0,
    atRiskPartners: consortiumData?.atRiskPartners ?? 0,
  };

  const budgetHealth = {
    score: budgetData?.overallHealth ?? health.dimensions.budget.score,
    status: health.dimensions.budget.status,
    burnRate: budgetData?.burnRate ?? 0,
    forecastAccuracy: budgetData?.forecastAccuracy ?? 0,
  };

  const overallScore = Math.round(
    timelineHealth.score * 0.3 +
    consortiumHealth.score * 0.25 +
    budgetHealth.score * 0.25 +
    health.dimensions.compliance.score * 0.2
  );

  const overallRisk = {
    level: overallScore >= 75 ? 'low' : overallScore >= 50 ? 'medium' : overallScore >= 25 ? 'high' : 'critical',
    score: overallScore,
    topRisks: health.dimensions.risk.alerts.slice(0, 3),
  };

  // Merge and prioritize actions from all sources
  const actionPriorities: ProjectHealthAnalysis['actionPriorities'] = [
    ...health.nextActions.map(a => ({ ...a, category: 'general' })),
    ...(timelineHealth.bottleneckCount > 2 ? [{ action: 'Review timeline bottlenecks - multiple critical path risks', priority: 'immediate' as const, category: 'timeline' }] : []),
    ...(consortiumHealth.atRiskPartners > 0 ? [{ action: `${consortiumHealth.atRiskPartners} partner(s) at risk - schedule performance review`, priority: 'soon' as const, category: 'consortium' }] : []),
    ...(budgetHealth.score < 50 ? [{ action: 'Budget health critical - initiate cost review', priority: 'immediate' as const, category: 'budget' }] : []),
  ].sort((a, b) => {
    const p = { immediate: 0, soon: 1, planned: 2 };
    return p[a.priority] - p[b.priority];
  }).slice(0, 10);

  const executiveSummary = `Project health: ${overallScore}/100 (${overallRisk.level}). Timeline: ${timelineHealth.score}/100, Budget: ${budgetHealth.score}/100, Consortium: ${consortiumHealth.score}/100. ${actionPriorities.filter(a => a.priority === 'immediate').length} immediate actions required.`;
  const executiveSummaryRo = `Sănătate proiect: ${overallScore}/100 (${overallRisk.level}). Cronologie: ${timelineHealth.score}/100, Buget: ${budgetHealth.score}/100, Consorțiu: ${consortiumHealth.score}/100. ${actionPriorities.filter(a => a.priority === 'immediate').length} acțiuni imediate necesare.`;

  return {
    timelineHealth,
    consortiumHealth,
    budgetHealth,
    overallRisk,
    actionPriorities,
    executiveSummary,
    executiveSummaryRo,
  };
}

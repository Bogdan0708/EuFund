// ─── Phase 3: Advanced Reporting & Analytics ─────────────────────
// Strategic intelligence reporting with portfolio analytics,
// competitive benchmarking, and executive-level insights.

import { aiGenerateObject } from './client';
import { z } from 'zod';
import { type EUProgramKey } from './eu-knowledge-base';

// ─── Types ───────────────────────────────────────────────────────

export interface ExecutiveReport {
  summary: string;
  summaryRo: string;
  keyMetrics: { label: string; value: string; trend: 'up' | 'down' | 'stable'; change?: string }[];
  strategicHighlights: string[];
  riskSummary: { level: string; topRisks: string[] };
  financialOverview: { totalBudget: number; totalSpent: number; absorption: number; forecast: string };
  recommendations: { action: string; priority: 'critical' | 'high' | 'medium'; timeline: string }[];
}

export interface PredictiveInsights {
  trends: { metric: string; direction: 'improving' | 'declining' | 'stable'; confidence: number; forecast: string }[];
  earlyWarnings: { warning: string; probability: number; timeframe: string; action: string }[];
  opportunities: { opportunity: string; potentialValue: number; effort: string; recommendation: string }[];
}

export interface BenchmarkReport {
  organizationScore: number;
  nationalAverage: number;
  euAverage: number;
  topQuartile: number;
  strengths: string[];
  improvementAreas: string[];
  peerComparison: { metric: string; ours: number; average: number; best: number }[];
}

export interface PortfolioInsights {
  totalProjects: number;
  activeProjects: number;
  totalBudget: number;
  successRate: number;
  programDistribution: Record<string, number>;
  sectorDistribution: Record<string, number>;
  riskDistribution: { low: number; medium: number; high: number; critical: number };
  performanceTrend: { period: string; score: number }[];
  diversificationScore: number;
  recommendations: string[];
}

export interface MarketAnalysis {
  marketPosition: 'leader' | 'strong' | 'average' | 'emerging' | 'newcomer';
  marketShare: number;
  growthRate: number;
  competitiveAdvantages: string[];
  strategicGaps: string[];
  opportunities: string[];
  threats: string[];
}

export interface StrategyRecommendation {
  area: string;
  recommendation: string;
  rationale: string;
  expectedROI: string;
  timeline: string;
  resources: string;
  priority: number;
}

export interface AdvancedReporting {
  executiveIntelligence: ExecutiveReport;
  predictiveInsights: PredictiveInsights;
  competitiveBenchmarking: BenchmarkReport;
  portfolioAnalytics: PortfolioInsights;
  marketPositioning: MarketAnalysis;
  strategicRecommendations: StrategyRecommendation[];
}

export interface AdvancedReportingInput {
  organizationName: string;
  projects: {
    id: string;
    title: string;
    program: EUProgramKey;
    budget: number;
    spent: number;
    status: 'active' | 'completed' | 'pipeline';
    healthScore: number;
    sector: string;
    startDate?: string;
    endDate?: string;
  }[];
  historicalSuccessRate?: number;
  sector: string;
  locale?: 'ro' | 'en';
}

// ─── Portfolio Analytics (No AI) ─────────────────────────────────

function computePortfolio(input: AdvancedReportingInput): PortfolioInsights {
  const active = input.projects.filter(p => p.status === 'active');
  const completed = input.projects.filter(p => p.status === 'completed');
  const totalBudget = input.projects.reduce((s, p) => s + p.budget, 0);

  const programDist: Record<string, number> = {};
  const sectorDist: Record<string, number> = {};
  let low = 0, medium = 0, high = 0, critical = 0;

  for (const p of input.projects) {
    programDist[p.program] = (programDist[p.program] || 0) + 1;
    sectorDist[p.sector] = (sectorDist[p.sector] || 0) + 1;
    if (p.healthScore >= 75) low++;
    else if (p.healthScore >= 50) medium++;
    else if (p.healthScore >= 25) high++;
    else critical++;
  }

  const uniquePrograms = Object.keys(programDist).length;
  const uniqueSectors = Object.keys(sectorDist).length;
  const diversificationScore = Math.min(100, (uniquePrograms * 15) + (uniqueSectors * 10) + (input.projects.length > 5 ? 20 : 0));

  return {
    totalProjects: input.projects.length,
    activeProjects: active.length,
    totalBudget,
    successRate: input.historicalSuccessRate || (completed.length > 0 ? completed.filter(p => p.healthScore >= 60).length / completed.length : 0),
    programDistribution: programDist,
    sectorDistribution: sectorDist,
    riskDistribution: { low, medium, high, critical },
    performanceTrend: [],
    diversificationScore,
    recommendations: [
      ...(uniquePrograms < 3 ? ['Diversify across more EU programs'] : []),
      ...(critical > 0 ? [`${critical} project(s) in critical health - immediate attention needed`] : []),
      ...(diversificationScore < 50 ? ['Increase portfolio diversification for risk mitigation'] : []),
    ],
  };
}

// ─── AI-Enhanced Reporting ───────────────────────────────────────

const reportingSchema = z.object({
  executiveSummary: z.string(),
  executiveSummaryRo: z.string(),
  keyMetrics: z.array(z.object({
    label: z.string(),
    value: z.string(),
    trend: z.enum(['up', 'down', 'stable']),
    change: z.string().optional(),
  })),
  strategicHighlights: z.array(z.string()),
  predictiveTrends: z.array(z.object({
    metric: z.string(),
    direction: z.enum(['improving', 'declining', 'stable']),
    confidence: z.number(),
    forecast: z.string(),
  })),
  earlyWarnings: z.array(z.object({
    warning: z.string(),
    probability: z.number(),
    timeframe: z.string(),
    action: z.string(),
  })),
  opportunities: z.array(z.object({
    opportunity: z.string(),
    potentialValue: z.number(),
    effort: z.string(),
    recommendation: z.string(),
  })),
  benchmarkStrengths: z.array(z.string()),
  benchmarkImprovements: z.array(z.string()),
  marketPosition: z.enum(['leader', 'strong', 'average', 'emerging', 'newcomer']),
  competitiveAdvantages: z.array(z.string()),
  strategicGaps: z.array(z.string()),
  swotOpportunities: z.array(z.string()),
  swotThreats: z.array(z.string()),
  strategicRecommendations: z.array(z.object({
    area: z.string(),
    recommendation: z.string(),
    rationale: z.string(),
    expectedROI: z.string(),
    timeline: z.string(),
    resources: z.string(),
    priority: z.number(),
  })),
});

export async function generateAdvancedReport(input: AdvancedReportingInput): Promise<AdvancedReporting> {
  const portfolio = computePortfolio(input);

  const totalSpent = input.projects.reduce((s, p) => s + p.spent, 0);
  const absorption = portfolio.totalBudget > 0 ? (totalSpent / portfolio.totalBudget) * 100 : 0;

  const { object: aiReport } = await aiGenerateObject({
    system: `You are a strategic EU funding advisor for Romanian organizations.
Generate executive-level intelligence reports with actionable strategic recommendations.
Consider the Romanian funding landscape, competitive positioning, and growth opportunities.`,
    prompt: `Generate strategic intelligence report for: ${input.organizationName}
Sector: ${input.sector}

Portfolio Summary:
- Total projects: ${portfolio.totalProjects} (${portfolio.activeProjects} active)
- Total budget: €${portfolio.totalBudget.toLocaleString()}
- Budget absorption: ${absorption.toFixed(1)}%
- Historical success rate: ${((input.historicalSuccessRate || 0) * 100).toFixed(0)}%
- Risk distribution: ${portfolio.riskDistribution.critical} critical, ${portfolio.riskDistribution.high} high, ${portfolio.riskDistribution.medium} medium, ${portfolio.riskDistribution.low} low

Projects:
${input.projects.map(p => `- ${p.title} (${p.program}): €${p.budget.toLocaleString()}, health: ${p.healthScore}/100, ${p.status}`).join('\n')}

Program distribution: ${JSON.stringify(portfolio.programDistribution)}
Sector distribution: ${JSON.stringify(portfolio.sectorDistribution)}

Provide comprehensive strategic analysis with Romanian market context.`,
    schema: reportingSchema,
    schemaName: 'AdvancedReport',
    temperature: 0.4,
  });

  return {
    executiveIntelligence: {
      summary: aiReport.executiveSummary,
      summaryRo: aiReport.executiveSummaryRo,
      keyMetrics: aiReport.keyMetrics,
      strategicHighlights: aiReport.strategicHighlights,
      riskSummary: {
        level: portfolio.riskDistribution.critical > 0 ? 'critical' : portfolio.riskDistribution.high > 0 ? 'high' : 'medium',
        topRisks: aiReport.earlyWarnings.slice(0, 3).map(w => w.warning),
      },
      financialOverview: {
        totalBudget: portfolio.totalBudget,
        totalSpent,
        absorption: Math.round(absorption),
        forecast: aiReport.predictiveTrends.find(t => t.metric.toLowerCase().includes('budget'))?.forecast || 'On track',
      },
      recommendations: aiReport.strategicRecommendations.slice(0, 5).map(r => ({
        action: r.recommendation,
        priority: r.priority <= 2 ? 'critical' as const : r.priority <= 4 ? 'high' as const : 'medium' as const,
        timeline: r.timeline,
      })),
    },
    predictiveInsights: {
      trends: aiReport.predictiveTrends,
      earlyWarnings: aiReport.earlyWarnings,
      opportunities: aiReport.opportunities,
    },
    competitiveBenchmarking: {
      organizationScore: Math.round(portfolio.successRate * 100),
      nationalAverage: 15,
      euAverage: 18,
      topQuartile: 35,
      strengths: aiReport.benchmarkStrengths,
      improvementAreas: aiReport.benchmarkImprovements,
      peerComparison: [
        { metric: 'Success Rate', ours: Math.round(portfolio.successRate * 100), average: 15, best: 40 },
        { metric: 'Budget Absorption', ours: Math.round(absorption), average: 75, best: 95 },
        { metric: 'Portfolio Diversity', ours: portfolio.diversificationScore, average: 50, best: 90 },
      ],
    },
    portfolioAnalytics: portfolio,
    marketPositioning: {
      marketPosition: aiReport.marketPosition,
      marketShare: portfolio.totalProjects > 10 ? 2.5 : portfolio.totalProjects > 5 ? 1.0 : 0.3,
      growthRate: 15,
      competitiveAdvantages: aiReport.competitiveAdvantages,
      strategicGaps: aiReport.strategicGaps,
      opportunities: aiReport.swotOpportunities,
      threats: aiReport.swotThreats,
    },
    strategicRecommendations: aiReport.strategicRecommendations,
  };
}

// ─── Quick Portfolio Summary (No AI) ─────────────────────────────

export function quickPortfolioSummary(input: AdvancedReportingInput): PortfolioInsights {
  return computePortfolio(input);
}

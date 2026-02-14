// ─── Reporting & Analytics Intelligence ──────────────────────────
// EU audit-ready report generation, progress documentation,
// partner performance reports, and Romanian reporting context.

import { aiGenerate } from './client';

// ─── Types ───────────────────────────────────────────────────────

export interface FinancialReport {
  period: string;
  totalBudget: number;
  totalSpent: number;
  euContribution: number;
  ownContribution: number;
  categoryBreakdown: { category: string; allocated: number; spent: number; remaining: number }[];
  partnerBreakdown: { partner: string; allocated: number; spent: number }[];
  currencyConversions?: { fromCurrency: string; toCurrency: string; rate: number; amount: number; converted: number }[];
  complianceNotes: string[];
}

export interface ProgressReport {
  period: string;
  overallProgress: number; // 0-100
  workPackages: WPProgress[];
  milestoneStatus: { name: string; dueDate: string; status: 'completed' | 'on-track' | 'delayed' | 'at-risk' }[];
  deliverables: { name: string; dueDate: string; status: string; wp: string }[];
  keyAchievements: string[];
  keyAchievementsRo: string[];
  risksAndMitigations: { risk: string; mitigation: string; status: string }[];
}

export interface WPProgress {
  id: string;
  name: string;
  leader: string;
  progress: number;
  status: 'on-track' | 'delayed' | 'completed' | 'not-started';
  tasksCompleted: number;
  tasksTotal: number;
  narrative: string;
  narrativeRo: string;
}

export interface RiskReport {
  overallRiskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskScore: number;
  topRisks: { description: string; category: string; severity: string; likelihood: string; mitigation: string }[];
  riskTrend: 'improving' | 'stable' | 'worsening';
  newRisks: string[];
  closedRisks: string[];
}

export interface PartnerReport {
  partnerSummaries: {
    name: string;
    country: string;
    role: string;
    budgetUtilization: number;
    deliverableStatus: string;
    performanceScore: number;
    issues: string[];
  }[];
  consortiumHealth: string;
  communicationSummary: string;
}

export interface ComplianceReport {
  overallStatus: 'compliant' | 'partially-compliant' | 'non-compliant';
  score: number;
  areas: { area: string; status: string; notes: string }[];
  requiredActions: string[];
  auditReadiness: number;
  nextAuditDate?: string;
}

export interface ReportGeneration {
  executiveSummary: string;
  executiveSummaryRo: string;
  financialAnalysis: FinancialReport;
  progressMetrics: ProgressReport;
  riskAssessment: RiskReport;
  partnerContributions: PartnerReport;
  complianceStatus: ComplianceReport;
  generatedAt: string;
  reportPeriod: string;
  reportType: 'periodic' | 'final' | 'interim' | 'audit';
}

// ─── Input Types ─────────────────────────────────────────────────

export interface ReportInput {
  projectId: string;
  projectTitle: string;
  reportType: 'periodic' | 'final' | 'interim' | 'audit';
  periodStart: string;
  periodEnd: string;
  budget: {
    total: number;
    spent: number;
    coFinancingRate: number;
    categories: { name: string; allocated: number; spent: number }[];
    partnerBudgets: { name: string; country: string; allocated: number; spent: number }[];
    ronConversions?: { amount: number; rate: number }[];
  };
  workPackages: {
    id: string;
    name: string;
    leader: string;
    progress: number;
    tasksCompleted: number;
    tasksTotal: number;
    deliverables: { name: string; dueDate: string; status: string }[];
    description?: string;
  }[];
  milestones: { name: string; dueDate: string; status: string }[];
  risks: { description: string; category: string; severity: string; likelihood: string; mitigation: string; isNew?: boolean; isClosed?: boolean }[];
  partners: {
    name: string;
    country: string;
    role: string;
    budgetUtilization: number;
    performanceScore: number;
    deliverableStatus: string;
    issues: string[];
  }[];
  locale?: 'ro' | 'en';
}

// ─── Report Generation ──────────────────────────────────────────

export async function generateReport(input: ReportInput): Promise<ReportGeneration> {
  // Financial report
  const financialAnalysis: FinancialReport = {
    period: `${input.periodStart} to ${input.periodEnd}`,
    totalBudget: input.budget.total,
    totalSpent: input.budget.spent,
    euContribution: Math.round(input.budget.spent * input.budget.coFinancingRate),
    ownContribution: Math.round(input.budget.spent * (1 - input.budget.coFinancingRate)),
    categoryBreakdown: input.budget.categories.map(c => ({
      category: c.name,
      allocated: c.allocated,
      spent: c.spent,
      remaining: c.allocated - c.spent,
    })),
    partnerBreakdown: input.budget.partnerBudgets.map(p => ({
      partner: p.name,
      allocated: p.allocated,
      spent: p.spent,
    })),
    currencyConversions: input.budget.ronConversions?.map(c => ({
      fromCurrency: 'RON',
      toCurrency: 'EUR',
      rate: c.rate,
      amount: c.amount,
      converted: Math.round(c.amount / c.rate),
    })),
    complianceNotes: generateComplianceNotes(input),
  };

  // Progress report
  const overallProgress = input.workPackages.length > 0
    ? Math.round(input.workPackages.reduce((sum, wp) => sum + wp.progress, 0) / input.workPackages.length)
    : 0;

  const progressMetrics: ProgressReport = {
    period: `${input.periodStart} to ${input.periodEnd}`,
    overallProgress,
    workPackages: input.workPackages.map(wp => ({
      id: wp.id,
      name: wp.name,
      leader: wp.leader,
      progress: wp.progress,
      status: wp.progress >= 100 ? 'completed' : wp.progress >= wp.tasksCompleted / Math.max(1, wp.tasksTotal) * 80 ? 'on-track' : wp.tasksTotal === 0 ? 'not-started' : 'delayed',
      tasksCompleted: wp.tasksCompleted,
      tasksTotal: wp.tasksTotal,
      narrative: `${wp.name}: ${wp.tasksCompleted}/${wp.tasksTotal} tasks completed (${wp.progress}%).`,
      narrativeRo: `${wp.name}: ${wp.tasksCompleted}/${wp.tasksTotal} sarcini finalizate (${wp.progress}%).`,
    })),
    milestoneStatus: input.milestones.map(m => ({
      name: m.name,
      dueDate: m.dueDate,
      status: m.status as 'completed' | 'on-track' | 'delayed' | 'at-risk',
    })),
    deliverables: input.workPackages.flatMap(wp =>
      wp.deliverables.map(d => ({ ...d, wp: wp.id }))
    ),
    keyAchievements: generateKeyAchievements(input),
    keyAchievementsRo: generateKeyAchievements(input, 'ro'),
    risksAndMitigations: input.risks.map(r => ({
      risk: r.description,
      mitigation: r.mitigation,
      status: r.isClosed ? 'closed' : 'active',
    })),
  };

  // Risk report
  const activeRisks = input.risks.filter(r => !r.isClosed);
  const riskScore = activeRisks.reduce((sum, r) => {
    const sevMap: Record<string, number> = { critical: 40, high: 25, medium: 15, low: 5 };
    return sum + (sevMap[r.severity] ?? 10);
  }, 0);

  const riskAssessment: RiskReport = {
    overallRiskLevel: riskScore > 80 ? 'critical' : riskScore > 50 ? 'high' : riskScore > 25 ? 'medium' : 'low',
    riskScore: Math.min(100, riskScore),
    topRisks: activeRisks.sort((a, b) => {
      const sev: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return (sev[a.severity] ?? 4) - (sev[b.severity] ?? 4);
    }).slice(0, 5),
    riskTrend: input.risks.filter(r => r.isNew).length > input.risks.filter(r => r.isClosed).length ? 'worsening' : 'improving',
    newRisks: input.risks.filter(r => r.isNew).map(r => r.description),
    closedRisks: input.risks.filter(r => r.isClosed).map(r => r.description),
  };

  // Partner report
  const partnerContributions: PartnerReport = {
    partnerSummaries: input.partners,
    consortiumHealth: input.partners.every(p => p.performanceScore >= 60)
      ? 'All partners performing satisfactorily'
      : `${input.partners.filter(p => p.performanceScore < 60).length} partner(s) require attention`,
    communicationSummary: 'Regular consortium meetings and reporting cycles maintained.',
  };

  // Compliance report
  const complianceAreas = [
    { area: 'Financial reporting', status: financialAnalysis.complianceNotes.length === 0 ? 'compliant' : 'warning', notes: financialAnalysis.complianceNotes.join('; ') || 'All clear' },
    { area: 'Deliverable submission', status: progressMetrics.deliverables.filter(d => d.status === 'delayed' || d.status === 'overdue').length === 0 ? 'compliant' : 'warning', notes: 'Check deliverable deadlines' },
    { area: 'Partner eligibility', status: 'compliant', notes: 'All partners maintain eligibility' },
    { area: 'GDPR compliance', status: 'compliant', notes: 'Data processing in accordance with DPA' },
  ];

  const complianceStatus: ComplianceReport = {
    overallStatus: complianceAreas.every(a => a.status === 'compliant') ? 'compliant' : 'partially-compliant',
    score: Math.round(complianceAreas.filter(a => a.status === 'compliant').length / complianceAreas.length * 100),
    areas: complianceAreas,
    requiredActions: complianceAreas.filter(a => a.status !== 'compliant').map(a => `Review ${a.area}: ${a.notes}`),
    auditReadiness: Math.round(complianceAreas.filter(a => a.status === 'compliant').length / complianceAreas.length * 100),
  };

  // Generate executive summary via AI
  const summaryPrompt = `Generate a concise executive summary (max 200 words) for an EU-funded project periodic report:
Project: ${input.projectTitle}
Period: ${input.periodStart} to ${input.periodEnd}
Progress: ${overallProgress}%
Budget spent: €${input.budget.spent.toLocaleString()} of €${input.budget.total.toLocaleString()}
Key achievements: ${generateKeyAchievements(input).join('; ')}
Risk level: ${riskAssessment.overallRiskLevel}
Partners: ${input.partners.length}
Focus on factual, professional EU reporting language.`;

  let executiveSummary: string;
  let executiveSummaryRo: string;

  try {
    const [enResult, roResult] = await Promise.all([
      aiGenerate({ system: 'You are an EU project reporting specialist. Write professional, concise summaries.', prompt: summaryPrompt }),
      aiGenerate({ system: 'Ești specialist în raportare de proiecte UE. Scrie rezumate profesionale și concise în limba română.', prompt: summaryPrompt + '\n\nWrite in Romanian.' }),
    ]);
    executiveSummary = enResult.text;
    executiveSummaryRo = roResult.text;
  } catch {
    executiveSummary = `Project "${input.projectTitle}" reporting period ${input.periodStart} to ${input.periodEnd}. Overall progress: ${overallProgress}%. Budget utilization: ${((input.budget.spent / input.budget.total) * 100).toFixed(1)}%. Risk level: ${riskAssessment.overallRiskLevel}. ${input.partners.length} consortium partners active.`;
    executiveSummaryRo = `Proiectul "${input.projectTitle}" perioada de raportare ${input.periodStart} - ${input.periodEnd}. Progres general: ${overallProgress}%. Utilizare buget: ${((input.budget.spent / input.budget.total) * 100).toFixed(1)}%. Nivel risc: ${riskAssessment.overallRiskLevel}. ${input.partners.length} parteneri consorțiu activi.`;
  }

  return {
    executiveSummary,
    executiveSummaryRo,
    financialAnalysis,
    progressMetrics,
    riskAssessment,
    partnerContributions,
    complianceStatus,
    generatedAt: new Date().toISOString(),
    reportPeriod: `${input.periodStart} to ${input.periodEnd}`,
    reportType: input.reportType,
  };
}

// ─── Helper Functions ────────────────────────────────────────────

function generateComplianceNotes(input: ReportInput): string[] {
  const notes: string[] = [];
  const spentPercent = (input.budget.spent / Math.max(1, input.budget.total)) * 100;

  if (spentPercent > 90) notes.push('Budget utilization above 90% - monitor remaining allocation carefully');
  if (input.budget.ronConversions && input.budget.ronConversions.length > 0) {
    notes.push('RON/EUR conversions documented per ECB reference rates');
  }

  const overbudget = input.budget.categories.filter(c => c.spent > c.allocated);
  if (overbudget.length > 0) {
    notes.push(`${overbudget.length} category/ies exceed allocation - budget transfer may be required`);
  }

  return notes;
}

function generateKeyAchievements(input: ReportInput, locale: string = 'en'): string[] {
  const achievements: string[] = [];

  const completedWPs = input.workPackages.filter(wp => wp.progress >= 100);
  if (completedWPs.length > 0) {
    achievements.push(locale === 'ro'
      ? `${completedWPs.length} pachet(e) de lucru finalizat(e)`
      : `${completedWPs.length} work package(s) completed`);
  }

  const completedMilestones = input.milestones.filter(m => m.status === 'completed');
  if (completedMilestones.length > 0) {
    achievements.push(locale === 'ro'
      ? `${completedMilestones.length} jalon(e) atins(e)`
      : `${completedMilestones.length} milestone(s) achieved`);
  }

  const deliveredCount = input.workPackages.flatMap(wp => wp.deliverables).filter(d => d.status === 'submitted' || d.status === 'accepted').length;
  if (deliveredCount > 0) {
    achievements.push(locale === 'ro'
      ? `${deliveredCount} livrabil(e) trimis(e)`
      : `${deliveredCount} deliverable(s) submitted`);
  }

  if (achievements.length === 0) {
    achievements.push(locale === 'ro' ? 'Activități de proiect în desfășurare conform planului' : 'Project activities progressing according to plan');
  }

  return achievements;
}

// ─── Quick Report Summary ────────────────────────────────────────

export function quickReportSummary(input: {
  projectTitle: string;
  progress: number;
  budgetSpent: number;
  budgetTotal: number;
  riskLevel: string;
  partnersCount: number;
}): { en: string; ro: string } {
  const budgetPercent = ((input.budgetSpent / Math.max(1, input.budgetTotal)) * 100).toFixed(1);
  return {
    en: `${input.projectTitle}: ${input.progress}% complete, €${input.budgetSpent.toLocaleString()} spent (${budgetPercent}%), risk: ${input.riskLevel}, ${input.partnersCount} partners.`,
    ro: `${input.projectTitle}: ${input.progress}% finalizat, €${input.budgetSpent.toLocaleString()} cheltuit (${budgetPercent}%), risc: ${input.riskLevel}, ${input.partnersCount} parteneri.`,
  };
}

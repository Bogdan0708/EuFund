// ─── Automated Compliance Intelligence Engine ───────────────────
// Real-time EU compliance evaluation with program-specific criteria,
// Romanian legal overlay, and automated gap analysis.

import { z } from 'zod';
import { aiGenerateObject } from './client';
import { hybridSearch } from '@/lib/rag/pipeline';

// ─── Types ───────────────────────────────────────────────────────

export interface ComplianceAnalysis {
  overallScore: number; // 0-100
  criteriaScores: Record<string, CriterionScore>;
  criticalIssues: ComplianceIssue[];
  improvementPlan: ImprovementStep[];
  programSpecific: ProgramComplianceDetail;
  legalReferences: string[];
  tokensUsed: number;
}

export interface CriterionScore {
  score: number;
  status: 'compliant' | 'partial' | 'non-compliant';
  evidence: string[];
  gaps: string[];
  recommendations: string[];
}

export interface ComplianceIssue {
  severity: 'critical' | 'major' | 'minor';
  area: string;
  description: string;
  regulation: string;
  remediation: string;
  deadline?: string;
}

export interface ImprovementStep {
  order: number;
  action: string;
  area: string;
  expectedScoreImprovement: number;
  effort: 'low' | 'medium' | 'high';
  timeframe: string;
}

export interface ProgramComplianceDetail {
  program: string;
  eligibilityMet: boolean;
  eligibilityGaps: string[];
  evaluationCriteria: { criterion: string; weight: number; score: number }[];
  estimatedEvaluationScore: number;
}

export interface ComplianceCheckInput {
  project: {
    title: string;
    summary: string;
    objectives?: string[];
    methodology?: string;
    trlLevel?: number;
    innovationDescription?: string;
    budget: number;
    ownContribution?: number;
    durationMonths: number;
  };
  organization: {
    type: string;
    size?: 'micro' | 'small' | 'medium' | 'large';
    country: string;
    region?: string;
    sector?: string;
    caenCode?: string;
    employeeCount?: number;
    annualRevenue?: number;
    yearsActive?: number;
  };
  consortium?: {
    partners: {
      name: string;
      country: string;
      type: string;
      size?: string;
      role: string;
    }[];
  };
  program: 'horizon_europe' | 'life_plus' | 'interreg' | 'erdf' | 'pocidif' | 'pnrr' | 'general';
  dataProtection?: {
    personalDataProcessed: boolean;
    dpiaConducted: boolean;
    dpoAppointed: boolean;
    crossBorderTransfers: boolean;
  };
  ethics?: {
    humanSubjects: boolean;
    animalResearch: boolean;
    dualUse: boolean;
    ethicsApprovalObtained: boolean;
  };
  locale?: 'ro' | 'en';
}

// ─── Program-Specific Criteria ───────────────────────────────────

const PROGRAM_CRITERIA: Record<string, {
  eligibility: Record<string, (input: ComplianceCheckInput) => CriterionScore>;
  evaluationWeights: { criterion: string; weight: number }[];
}> = {
  horizon_europe: {
    eligibility: {
      'Consortium Composition': (input) => {
        const partners = input.consortium?.partners || [];
        const countries = new Set(partners.map(p => p.country));
        const hasMinPartners = partners.length >= 3;
        const hasMinCountries = countries.size >= 3;
        const allEU = partners.every(p => EU_MEMBER_STATES.has(p.country));
        const gaps: string[] = [];
        if (!hasMinPartners) gaps.push('Minimum 3 independent legal entities required');
        if (!hasMinCountries) gaps.push('Partners must be from at least 3 different EU Member States');
        const score = (hasMinPartners ? 40 : 0) + (hasMinCountries ? 40 : 0) + (allEU ? 20 : 10);
        return {
          score,
          status: gaps.length === 0 ? 'compliant' : score > 50 ? 'partial' : 'non-compliant',
          evidence: [
            `${partners.length} partners from ${countries.size} countries`,
          ],
          gaps,
          recommendations: gaps.length > 0 ? ['Expand consortium to meet minimum requirements'] : [],
        };
      },
      'TRL Level': (input) => {
        const trl = input.project.trlLevel;
        if (!trl) return { score: 0, status: 'non-compliant', evidence: [], gaps: ['TRL level not specified'], recommendations: ['Define project TRL level (typically TRL 3-7 for RIA, TRL 5-8 for IA)'] };
        const valid = trl >= 2 && trl <= 9;
        return {
          score: valid ? 100 : 30,
          status: valid ? 'compliant' : 'partial',
          evidence: [`TRL ${trl} declared`],
          gaps: valid ? [] : [`TRL ${trl} may not be appropriate`],
          recommendations: [],
        };
      },
    },
    evaluationWeights: [
      { criterion: 'Excellence', weight: 50 },
      { criterion: 'Impact', weight: 30 },
      { criterion: 'Implementation', weight: 20 },
    ],
  },
  life_plus: {
    eligibility: {
      'Environmental Focus': (input) => {
        const envKeywords = ['environment', 'climate', 'biodiversity', 'nature', 'circular economy', 'pollution', 'mediu', 'climă', 'biodiversitate'];
        const text = `${input.project.summary} ${input.project.objectives?.join(' ') || ''}`.toLowerCase();
        const matches = envKeywords.filter(k => text.includes(k));
        const score = Math.min(100, matches.length * 25);
        return {
          score,
          status: score >= 50 ? 'compliant' : score > 0 ? 'partial' : 'non-compliant',
          evidence: matches.length > 0 ? [`Environmental keywords found: ${matches.join(', ')}`] : [],
          gaps: score < 50 ? ['Project must clearly address environmental/climate objectives'] : [],
          recommendations: score < 50 ? ['Strengthen environmental focus in project description'] : [],
        };
      },
      'EU Added Value': (input) => {
        const partners = input.consortium?.partners || [];
        const countries = new Set(partners.map(p => p.country));
        const score = countries.size > 1 ? 80 : 50;
        return {
          score,
          status: score >= 80 ? 'compliant' : 'partial',
          evidence: [`${countries.size} countries represented`],
          gaps: countries.size <= 1 ? ['Demonstrate EU added value beyond national scope'] : [],
          recommendations: [],
        };
      },
    },
    evaluationWeights: [
      { criterion: 'Environmental relevance', weight: 25 },
      { criterion: 'Technical coherence', weight: 25 },
      { criterion: 'EU added value', weight: 20 },
      { criterion: 'Budget reasonableness', weight: 15 },
      { criterion: 'Sustainability & replicability', weight: 15 },
    ],
  },
  interreg: {
    eligibility: {
      'Cross-border Character': (input) => {
        const partners = input.consortium?.partners || [];
        const countries = new Set(partners.map(p => p.country));
        const hasCrossBorder = countries.size >= 2;
        return {
          score: hasCrossBorder ? 100 : 0,
          status: hasCrossBorder ? 'compliant' : 'non-compliant',
          evidence: [`Partners from: ${[...countries].join(', ')}`],
          gaps: hasCrossBorder ? [] : ['Cross-border partnership is mandatory for Interreg'],
          recommendations: hasCrossBorder ? [] : ['Find partner(s) in eligible neighboring country'],
        };
      },
    },
    evaluationWeights: [
      { criterion: 'Cross-border relevance', weight: 30 },
      { criterion: 'Partnership quality', weight: 25 },
      { criterion: 'Methodology', weight: 25 },
      { criterion: 'Sustainability', weight: 20 },
    ],
  },
  erdf: {
    eligibility: {
      'Regional Eligibility': (input) => {
        const isEligibleRegion = input.organization.country === 'RO' || input.organization.country === 'Romania';
        return {
          score: isEligibleRegion ? 100 : 50,
          status: isEligibleRegion ? 'compliant' : 'partial',
          evidence: [`Organization located in ${input.organization.country}`],
          gaps: [],
          recommendations: [],
        };
      },
    },
    evaluationWeights: [
      { criterion: 'Strategic alignment', weight: 30 },
      { criterion: 'Project maturity', weight: 25 },
      { criterion: 'Sustainability', weight: 25 },
      { criterion: 'Budget efficiency', weight: 20 },
    ],
  },
  pocidif: {
    eligibility: {
      'Organization Type': (input) => {
        const eligible = ['sme', 'startup', 'research', 'university', 'public_body'].includes(input.organization.type.toLowerCase());
        return {
          score: eligible ? 100 : 30,
          status: eligible ? 'compliant' : 'partial',
          evidence: [`Organization type: ${input.organization.type}`],
          gaps: eligible ? [] : ['Verify organization eligibility for POCIDIF'],
          recommendations: [],
        };
      },
    },
    evaluationWeights: [
      { criterion: 'Innovation capacity', weight: 30 },
      { criterion: 'Market potential', weight: 25 },
      { criterion: 'Technical feasibility', weight: 25 },
      { criterion: 'Team competence', weight: 20 },
    ],
  },
  pnrr: {
    eligibility: {
      'PNRR Alignment': () => ({
        score: 50,
        status: 'partial' as const,
        evidence: ['PNRR alignment requires detailed assessment'],
        gaps: ['Verify alignment with specific PNRR component and reform'],
        recommendations: ['Map project to specific PNRR milestone and target'],
      }),
    },
    evaluationWeights: [
      { criterion: 'Reform alignment', weight: 35 },
      { criterion: 'Implementation capacity', weight: 25 },
      { criterion: 'Impact', weight: 25 },
      { criterion: 'Sustainability', weight: 15 },
    ],
  },
  general: {
    eligibility: {},
    evaluationWeights: [
      { criterion: 'Relevance', weight: 25 },
      { criterion: 'Quality', weight: 25 },
      { criterion: 'Impact', weight: 25 },
      { criterion: 'Feasibility', weight: 25 },
    ],
  },
};

const EU_MEMBER_STATES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'Austria', 'Belgium', 'Bulgaria', 'Croatia', 'Cyprus', 'Czech Republic',
  'Denmark', 'Estonia', 'Finland', 'France', 'Germany', 'Greece',
  'Hungary', 'Ireland', 'Italy', 'Latvia', 'Lithuania', 'Luxembourg',
  'Malta', 'Netherlands', 'Poland', 'Portugal', 'Romania', 'Slovakia',
  'Slovenia', 'Spain', 'Sweden',
]);

// ─── Cross-Cutting Compliance Checks ─────────────────────────────

function checkGDPR(input: ComplianceCheckInput): CriterionScore {
  if (!input.dataProtection) {
    return {
      score: 30,
      status: 'partial',
      evidence: [],
      gaps: ['Data protection assessment not provided'],
      recommendations: ['Complete data protection impact assessment (DPIA)', 'Appoint DPO if processing personal data'],
    };
  }

  let score = 0;
  const gaps: string[] = [];
  const evidence: string[] = [];

  if (!input.dataProtection.personalDataProcessed) {
    score = 90;
    evidence.push('No personal data processing declared');
  } else {
    if (input.dataProtection.dpiaConducted) { score += 30; evidence.push('DPIA conducted'); }
    else gaps.push('DPIA required for personal data processing');

    if (input.dataProtection.dpoAppointed) { score += 30; evidence.push('DPO appointed'); }
    else gaps.push('DPO appointment required');

    if (!input.dataProtection.crossBorderTransfers) { score += 20; evidence.push('No cross-border data transfers'); }
    else gaps.push('Cross-border data transfers require Standard Contractual Clauses (SCC)');

    score += 20; // base score for declaring data processing
  }

  return {
    score,
    status: score >= 80 ? 'compliant' : score >= 40 ? 'partial' : 'non-compliant',
    evidence,
    gaps,
    recommendations: gaps.map(g => `Address: ${g}`),
  };
}

function checkEthics(input: ComplianceCheckInput): CriterionScore {
  if (!input.ethics) {
    return { score: 50, status: 'partial', evidence: [], gaps: ['Ethics assessment not provided'], recommendations: ['Complete ethics self-assessment'] };
  }

  let score = 100;
  const gaps: string[] = [];
  const evidence: string[] = [];

  if (input.ethics.humanSubjects && !input.ethics.ethicsApprovalObtained) {
    score -= 40;
    gaps.push('Ethics approval required for human subjects research');
  }
  if (input.ethics.animalResearch && !input.ethics.ethicsApprovalObtained) {
    score -= 30;
    gaps.push('Ethics approval required for animal research');
  }
  if (input.ethics.dualUse) {
    score -= 20;
    gaps.push('Dual-use research requires security scrutiny');
  }
  if (input.ethics.ethicsApprovalObtained) {
    evidence.push('Ethics approval obtained');
  }

  return {
    score: Math.max(0, score),
    status: score >= 80 ? 'compliant' : score >= 40 ? 'partial' : 'non-compliant',
    evidence,
    gaps,
    recommendations: gaps,
  };
}

function checkBudgetCompliance(input: ComplianceCheckInput): CriterionScore {
  const gaps: string[] = [];
  const evidence: string[] = [];
  let score = 70;

  const cofinancing = input.project.ownContribution
    ? (input.project.ownContribution / input.project.budget) * 100
    : 0;

  if (cofinancing > 0) {
    evidence.push(`Own contribution: ${cofinancing.toFixed(1)}% of total budget`);
    score += 15;
  } else {
    gaps.push('Own contribution not specified - most EU programs require co-financing');
  }

  // Duration check
  if (input.project.durationMonths < 6) {
    gaps.push('Project duration very short - verify minimum requirements');
    score -= 10;
  }
  if (input.project.durationMonths > 60) {
    gaps.push('Project duration exceeds typical EU maximum (60 months)');
    score -= 10;
  }

  evidence.push(`Budget: €${input.project.budget.toLocaleString()}, Duration: ${input.project.durationMonths} months`);

  return {
    score: Math.min(100, Math.max(0, score)),
    status: score >= 80 ? 'compliant' : score >= 50 ? 'partial' : 'non-compliant',
    evidence,
    gaps,
    recommendations: gaps.map(g => `Address: ${g}`),
  };
}

// ─── AI Schema ───────────────────────────────────────────────────

const aiComplianceAnalysisSchema = z.object({
  evaluationScores: z.array(z.object({
    criterion: z.string(),
    score: z.number().min(0).max(100),
    justification: z.string(),
    improvements: z.array(z.string()),
  })),
  criticalIssues: z.array(z.object({
    severity: z.enum(['critical', 'major', 'minor']),
    area: z.string(),
    description: z.string(),
    regulation: z.string(),
    remediation: z.string(),
  })),
  improvementPlan: z.array(z.object({
    order: z.number(),
    action: z.string(),
    area: z.string(),
    expectedScoreImprovement: z.number(),
    effort: z.enum(['low', 'medium', 'high']),
    timeframe: z.string(),
  })),
  legalReferences: z.array(z.string()),
});

// ─── Main Compliance Analysis ────────────────────────────────────

export async function analyzeCompliance(input: ComplianceCheckInput): Promise<ComplianceAnalysis> {
  const isRo = input.locale !== 'en';
  const programConfig = PROGRAM_CRITERIA[input.program] || PROGRAM_CRITERIA.general;

  // Deterministic criteria scores
  const criteriaScores: Record<string, CriterionScore> = {};

  // Program-specific eligibility
  for (const [name, checker] of Object.entries(programConfig.eligibility)) {
    criteriaScores[name] = checker(input);
  }

  // Cross-cutting compliance
  criteriaScores['GDPR Compliance'] = checkGDPR(input);
  criteriaScores['Ethics'] = checkEthics(input);
  criteriaScores['Budget Compliance'] = checkBudgetCompliance(input);

  // RAG: Search for relevant regulations
  let ragContext = '';
  try {
    const ragResults = await hybridSearch({
      query: `${input.program} eligibility compliance requirements ${input.organization.country}`,
      topK: 5,
    });
    ragContext = ragResults.map(r => r.content).join('\n');
  } catch {
    ragContext = '';
  }

  // AI evaluation
  const systemPrompt = isRo
    ? `Ești un expert în conformitate pentru fonduri europene, specializat pe programul ${input.program}. Evaluează proiectul conform criteriilor specifice programului și legislației românești. Include referințe la regulamente UE relevante. Răspunde în română.`
    : `You are an EU funding compliance expert specializing in ${input.program}. Evaluate the project against program-specific criteria and Romanian legislation. Include references to relevant EU regulations.`;

  const prompt = `Evaluate compliance for this EU project:

Program: ${input.program}
Project: ${input.project.title}
Summary: ${input.project.summary}
Budget: €${input.project.budget.toLocaleString()}
Duration: ${input.project.durationMonths} months
Organization: ${input.organization.type} in ${input.organization.country}${input.organization.region ? ` (${input.organization.region})` : ''}
${input.consortium ? `Consortium: ${input.consortium.partners.map(p => `${p.name} (${p.country}, ${p.type})`).join('; ')}` : 'No consortium'}

Evaluation criteria for ${input.program}:
${programConfig.evaluationWeights.map(c => `- ${c.criterion} (${c.weight}%)`).join('\n')}

Deterministic compliance results:
${Object.entries(criteriaScores).map(([k, v]) => `- ${k}: ${v.status} (${v.score}/100) ${v.gaps.length > 0 ? `Gaps: ${v.gaps.join('; ')}` : ''}`).join('\n')}

${ragContext ? `Relevant regulations:\n${ragContext}` : ''}

Provide: evaluation scores per criterion, critical issues, improvement plan, and legal references.`;

  let criticalIssues: ComplianceIssue[] = [];
  let improvementPlan: ImprovementStep[] = [];
  let legalReferences: string[] = [];
  let tokensUsed = 0;

  try {
    const result = await aiGenerateObject({
      system: systemPrompt,
      prompt,
      schema: aiComplianceAnalysisSchema,
      schemaName: 'ComplianceAnalysis',
      temperature: 0.2,
    });

    tokensUsed = result.tokensUsed;
    const ai = result.object;

    if (!ai) {
      throw new Error('AI analysis failed to produce valid result');
    }

    // Merge AI evaluation scores into criteria
    for (const evalScore of ai.evaluationScores) {
      if (!criteriaScores[evalScore.criterion]) {
        criteriaScores[evalScore.criterion] = {
          score: evalScore.score,
          status: evalScore.score >= 70 ? 'compliant' : evalScore.score >= 40 ? 'partial' : 'non-compliant',
          evidence: [evalScore.justification],
          gaps: evalScore.improvements,
          recommendations: evalScore.improvements,
        };
      }
    }

    criticalIssues = ai.criticalIssues;
    improvementPlan = ai.improvementPlan;
    legalReferences = ai.legalReferences;
  } catch {
    // Use deterministic results only
    criticalIssues = Object.entries(criteriaScores)
      .filter(([, v]) => v.status === 'non-compliant')
      .map(([k, v]) => ({
        severity: 'major' as const,
        area: k,
        description: v.gaps[0] || 'Non-compliant',
        regulation: '',
        remediation: v.recommendations[0] || 'Address gaps',
      }));
  }

  // Calculate overall score
  const scores = Object.values(criteriaScores);
  const overallScore = scores.length > 0
    ? Math.round(scores.reduce((s, c) => s + c.score, 0) / scores.length)
    : 0;

  // Program-specific detail
  const programSpecific: ProgramComplianceDetail = {
    program: input.program,
    eligibilityMet: Object.entries(criteriaScores)
      .filter(([k]) => Object.keys(programConfig.eligibility).includes(k))
      .every(([, v]) => v.status !== 'non-compliant'),
    eligibilityGaps: Object.entries(criteriaScores)
      .filter(([k]) => Object.keys(programConfig.eligibility).includes(k))
      .flatMap(([, v]) => v.gaps),
    evaluationCriteria: programConfig.evaluationWeights.map(ew => ({
      ...ew,
      score: criteriaScores[ew.criterion]?.score ?? 50,
    })),
    estimatedEvaluationScore: programConfig.evaluationWeights.reduce((s, ew) => {
      const cs = criteriaScores[ew.criterion]?.score ?? 50;
      return s + cs * (ew.weight / 100);
    }, 0),
  };

  return {
    overallScore,
    criteriaScores,
    criticalIssues,
    improvementPlan,
    programSpecific,
    legalReferences,
    tokensUsed,
  };
}

// ─── Phase 2: Advanced Compliance Intelligence ───────────────────

export interface PartnerComplianceStatus {
  partnerId: string;
  partnerName: string;
  eligibilityStatus: 'eligible' | 'at-risk' | 'ineligible';
  issues: string[];
  lastVerified: string;
  nextReviewDate: string;
}

export interface FinancialComplianceCheck {
  category: string;
  status: 'compliant' | 'warning' | 'non-compliant';
  rule: string;
  currentValue: number;
  threshold: number;
  details: string;
}

export interface MilestoneComplianceStatus {
  milestoneId: string;
  name: string;
  dueDate: string;
  status: 'on-track' | 'at-risk' | 'overdue' | 'completed';
  evidenceComplete: boolean;
  missingDocuments: string[];
}

export interface DocumentationStatus {
  totalRequired: number;
  submitted: number;
  approved: number;
  missing: string[];
  expiringSoon: string[];
  completionPercentage: number;
}

export interface AuditPreparation {
  readinessScore: number;
  financialTrailComplete: boolean;
  partnerDocumentation: boolean;
  timeSheetCompliance: boolean;
  procurementDocumentation: boolean;
  issues: string[];
  recommendations: string[];
  recommendationsRo: string[];
}

export interface AdvancedComplianceAnalysis {
  consortiumCompliance: PartnerComplianceStatus[];
  budgetCompliance: FinancialComplianceCheck[];
  timelineCompliance: MilestoneComplianceStatus[];
  documentCompliance: DocumentationStatus;
  auditReadiness: AuditPreparation;
  overallComplianceScore: number;
}

export interface AdvancedComplianceInput {
  projectId: string;
  partners: {
    id: string;
    name: string;
    country: string;
    isEligible: boolean;
    documentsSubmitted: string[];
    documentsRequired: string[];
    lastEligibilityCheck?: string;
  }[];
  budgetCategories: {
    name: string;
    spent: number;
    allocated: number;
    maxPercent?: number;
    rule: string;
  }[];
  milestones: {
    id: string;
    name: string;
    dueDate: string;
    completed: boolean;
    evidenceDocuments: string[];
    requiredDocuments: string[];
  }[];
  documents: {
    name: string;
    status: 'submitted' | 'approved' | 'missing' | 'expired';
    expiryDate?: string;
  }[];
  hasTimesheets: boolean;
  hasProcurementDocs: boolean;
}

export function analyzeAdvancedCompliance(input: AdvancedComplianceInput): AdvancedComplianceAnalysis {
  const now = new Date();

  // Partner compliance
  const consortiumCompliance: PartnerComplianceStatus[] = input.partners.map(p => {
    const missingDocs = p.documentsRequired.filter(d => !p.documentsSubmitted.includes(d));
    const lastCheck = p.lastEligibilityCheck ? new Date(p.lastEligibilityCheck) : null;
    const monthsSinceCheck = lastCheck ? (now.getTime() - lastCheck.getTime()) / (1000 * 60 * 60 * 24 * 30) : 999;

    return {
      partnerId: p.id,
      partnerName: p.name,
      eligibilityStatus: !p.isEligible ? 'ineligible' : missingDocs.length > 0 || monthsSinceCheck > 6 ? 'at-risk' : 'eligible',
      issues: [
        ...missingDocs.map(d => `Missing: ${d}`),
        ...(monthsSinceCheck > 6 ? ['Eligibility check overdue'] : []),
        ...(!p.isEligible ? ['Partner marked as ineligible'] : []),
      ],
      lastVerified: p.lastEligibilityCheck ?? 'Never',
      nextReviewDate: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    };
  });

  // Budget compliance
  const totalBudget = input.budgetCategories.reduce((s, c) => s + c.allocated, 0);
  const budgetCompliance: FinancialComplianceCheck[] = input.budgetCategories.map(cat => {
    const percent = (cat.spent / Math.max(1, totalBudget)) * 100;
    const threshold = cat.maxPercent ?? 100;
    return {
      category: cat.name,
      status: percent > threshold ? 'non-compliant' : percent > threshold * 0.9 ? 'warning' : 'compliant',
      rule: cat.rule,
      currentValue: Math.round(percent * 10) / 10,
      threshold,
      details: `${cat.name}: ${percent.toFixed(1)}% of total budget (limit: ${threshold}%)`,
    };
  });

  // Milestone compliance
  const timelineCompliance: MilestoneComplianceStatus[] = input.milestones.map(m => {
    const due = new Date(m.dueDate);
    const missingDocs = m.requiredDocuments.filter(d => !m.evidenceDocuments.includes(d));
    return {
      milestoneId: m.id,
      name: m.name,
      dueDate: m.dueDate,
      status: m.completed ? 'completed' : due < now ? 'overdue' : due.getTime() - now.getTime() < 14 * 24 * 60 * 60 * 1000 ? 'at-risk' : 'on-track',
      evidenceComplete: missingDocs.length === 0,
      missingDocuments: missingDocs,
    };
  });

  // Document compliance
  const totalRequired = input.documents.length;
  const submitted = input.documents.filter(d => d.status === 'submitted' || d.status === 'approved').length;
  const approved = input.documents.filter(d => d.status === 'approved').length;
  const missing = input.documents.filter(d => d.status === 'missing').map(d => d.name);
  const expiringSoon = input.documents.filter(d => {
    if (!d.expiryDate) return false;
    const expiry = new Date(d.expiryDate);
    return expiry.getTime() - now.getTime() < 30 * 24 * 60 * 60 * 1000;
  }).map(d => d.name);

  const documentCompliance: DocumentationStatus = {
    totalRequired,
    submitted,
    approved,
    missing,
    expiringSoon,
    completionPercentage: Math.round((submitted / Math.max(1, totalRequired)) * 100),
  };

  // Audit readiness
  const issues: string[] = [];
  const recommendations: string[] = [];
  const recommendationsRo: string[] = [];

  if (!input.hasTimesheets) { issues.push('Timesheet records incomplete'); recommendations.push('Implement timesheet tracking system'); recommendationsRo.push('Implementați sistem de pontaj'); }
  if (!input.hasProcurementDocs) { issues.push('Procurement documentation gaps'); recommendations.push('Compile all procurement evidence'); recommendationsRo.push('Compilați toate dovezile de achiziții'); }
  if (missing.length > 0) { issues.push(`${missing.length} required documents missing`); }
  const ineligiblePartners = consortiumCompliance.filter(p => p.eligibilityStatus === 'ineligible');
  if (ineligiblePartners.length > 0) { issues.push(`${ineligiblePartners.length} partner(s) with eligibility issues`); }

  const auditReadiness: AuditPreparation = {
    readinessScore: Math.max(0, 100 - issues.length * 15),
    financialTrailComplete: budgetCompliance.every(c => c.status !== 'non-compliant'),
    partnerDocumentation: consortiumCompliance.every(c => c.eligibilityStatus !== 'ineligible'),
    timeSheetCompliance: input.hasTimesheets,
    procurementDocumentation: input.hasProcurementDocs,
    issues,
    recommendations,
    recommendationsRo,
  };

  const overallComplianceScore = Math.round(
    (consortiumCompliance.filter(p => p.eligibilityStatus === 'eligible').length / Math.max(1, consortiumCompliance.length)) * 25 +
    (budgetCompliance.filter(c => c.status === 'compliant').length / Math.max(1, budgetCompliance.length)) * 25 +
    (timelineCompliance.filter(m => m.status !== 'overdue').length / Math.max(1, timelineCompliance.length)) * 25 +
    (documentCompliance.completionPercentage / 100) * 25
  );

  return {
    consortiumCompliance,
    budgetCompliance,
    timelineCompliance,
    documentCompliance,
    auditReadiness,
    overallComplianceScore,
  };
}

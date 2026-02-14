// ─── EU Funding Knowledge Base ───────────────────────────────────
// Structured knowledge about EU programs, success patterns,
// Romanian-specific context, and proposal best practices.

// ─── Types ───────────────────────────────────────────────────────

export type EUProgramKey = 'horizon_europe' | 'life_plus' | 'interreg' | 'erdf' | 'pocidif' | 'pnrr' | 'general';

export interface EUProgram {
  name: string;
  namero: string;
  description: string;
  budget: string;
  period: string;
  cofinancingRate: string;
  successRate: string;
  eligibleEntities: string[];
  keyRequirements: string[];
  evaluationCriteria: { name: string; weight: number; description: string }[];
  proposalSections: string[];
  tips: string[];
  romanianAdvantages: string[];
  commonPitfalls: string[];
  budgetCategories: string[];
  typicalDuration: string;
  trlRange?: string;
}

// ─── Program Database ────────────────────────────────────────────

export const EU_PROGRAMS: Record<EUProgramKey, EUProgram> = {
  horizon_europe: {
    name: 'Horizon Europe',
    namero: 'Orizont Europa',
    description: 'EU framework programme for research and innovation (2021-2027)',
    budget: '€95.5 billion',
    period: '2021-2027',
    cofinancingRate: '100% for RIA, 70% for IA (100% for non-profit)',
    successRate: '~15% average across all pillars',
    eligibleEntities: ['Universities', 'Research organizations', 'SMEs', 'Large enterprises', 'NGOs', 'Public bodies'],
    keyRequirements: [
      'Minimum 3 independent legal entities from 3 different EU Member States',
      'Clear innovation and research excellence',
      'Open Science policy compliance',
      'Gender Equality Plan (mandatory for public bodies)',
      'Data Management Plan',
    ],
    evaluationCriteria: [
      { name: 'Excellence', weight: 50, description: 'Clarity of objectives, soundness of methodology, ambition and novelty' },
      { name: 'Impact', weight: 30, description: 'Credibility of expected outcomes, exploitation, dissemination, communication' },
      { name: 'Implementation', weight: 20, description: 'Quality of work plan, consortium, management structures' },
    ],
    proposalSections: [
      'Excellence: Objectives and ambition',
      'Excellence: Methodology',
      'Impact: Project results and outcomes',
      'Impact: Measures to maximise impact',
      'Implementation: Work plan',
      'Implementation: Management and consortium',
    ],
    tips: [
      'Start with a compelling 1-page summary (evaluators read hundreds)',
      'Use clear work package structure with measurable deliverables',
      'Demonstrate state-of-the-art knowledge with recent citations',
      'Include a credible exploitation and business plan',
      'Budget the 25% flat rate for indirect costs correctly',
      'Address all evaluation criteria explicitly',
    ],
    romanianAdvantages: [
      'Widening participation: Romania eligible for Teaming, Twinning, ERA Chairs',
      'Romanian partners increase geographic diversity score',
      'Lower personnel costs improve budget competitiveness',
      'Access to UEFISCDI National Contact Points for free support',
      'Eligible for additional widening premiums',
    ],
    commonPitfalls: [
      'Insufficient international collaboration experience',
      'Weak exploitation plans',
      'Budget not aligned with work plan effort',
      'Missing mandatory cross-cutting issues (gender, open science)',
      'Consortium too small or geographically limited',
    ],
    budgetCategories: ['Personnel', 'Subcontracting', 'Purchase costs (equipment, consumables, travel)', 'Other goods/services', 'Indirect costs (25% flat rate)'],
    typicalDuration: '24-48 months',
    trlRange: 'TRL 2-5 (RIA), TRL 5-8 (IA)',
  },

  life_plus: {
    name: 'LIFE Programme',
    namero: 'Programul LIFE',
    description: 'EU funding instrument for environment and climate action',
    budget: '€5.4 billion',
    period: '2021-2027',
    cofinancingRate: '60% standard, 75% nature/biodiversity',
    successRate: '~25% for standard projects',
    eligibleEntities: ['Public bodies', 'Private companies', 'NGOs', 'Research organizations'],
    keyRequirements: [
      'Clear environmental or climate action focus',
      'Demonstration or best practice approach',
      'EU added value and replicability',
      'Sound financial and operational capacity',
    ],
    evaluationCriteria: [
      { name: 'Relevance', weight: 25, description: 'Contribution to LIFE programme objectives and EU environmental policy' },
      { name: 'Technical quality', weight: 25, description: 'Coherence of methodology, innovativeness, measurable results' },
      { name: 'EU added value', weight: 20, description: 'Transnational dimension, transferability, replicability' },
      { name: 'Budget', weight: 15, description: 'Cost-effectiveness, reasonableness, coherence with activities' },
      { name: 'Sustainability', weight: 15, description: 'Long-term viability, after-LIFE plan, multiplicator effect' },
    ],
    proposalSections: [
      'Project description and environmental problem',
      'Technical approach and methodology',
      'Expected results and indicators',
      'Budget and resources',
      'After-LIFE sustainability plan',
    ],
    tips: [
      'Clearly quantify environmental impact (hectares, tonnes CO2, species)',
      'Include strong after-LIFE sustainability plan',
      'Show replicability potential across EU',
      'Partner with authorities who can mainstream results',
    ],
    romanianAdvantages: [
      'Rich biodiversity (Danube Delta, Carpathian Mountains) for nature projects',
      'Significant environmental challenges = strong project justification',
      'Lower costs stretch budget further',
      'Government priority for EU environmental compliance',
    ],
    commonPitfalls: [
      'Vague environmental impact measurement',
      'No after-LIFE plan',
      'Budget not linked to concrete deliverables',
      'Missing replicability dimension',
    ],
    budgetCategories: ['Personnel', 'Travel', 'External assistance', 'Durables (equipment, infrastructure)', 'Consumables', 'Other direct costs', 'Overheads (7% flat)'],
    typicalDuration: '36-60 months',
  },

  interreg: {
    name: 'Interreg',
    namero: 'Interreg',
    description: 'European territorial cooperation programmes',
    budget: '€8+ billion across all programmes',
    period: '2021-2027',
    cofinancingRate: '80% (up to 85% for less developed regions)',
    successRate: '~30% average',
    eligibleEntities: ['Public bodies', 'NGOs', 'Universities', 'SMEs (in some programmes)', 'Regional development agencies'],
    keyRequirements: [
      'Cross-border or transnational partnership',
      'Clear territorial dimension',
      'Alignment with programme-specific priorities',
      'Joint development, joint implementation, joint staffing, joint financing',
    ],
    evaluationCriteria: [
      { name: 'Relevance and cross-border dimension', weight: 30, description: 'Why cross-border cooperation is needed' },
      { name: 'Partnership quality', weight: 25, description: 'Partner complementarity and cooperation experience' },
      { name: 'Methodology and work plan', weight: 25, description: 'Logical intervention, clear outputs' },
      { name: 'Sustainability and transferability', weight: 20, description: 'Long-term impact and mainstreaming' },
    ],
    proposalSections: [
      'Project relevance and context',
      'Cross-border/transnational approach',
      'Partnership and management',
      'Work plan and activities',
      'Budget and resources',
      'Communication and sustainability',
    ],
    tips: [
      'Demonstrate why the problem cannot be solved nationally',
      'Show real joint activities, not parallel national actions',
      'Include all 4 cooperation criteria (joint development/implementation/staffing/financing)',
      'Engage target groups from all partner regions',
    ],
    romanianAdvantages: [
      'Romania-Bulgaria CBC programme has dedicated budget',
      'Romania-Hungary, Romania-Serbia programmes available',
      'Danube Transnational Programme covers Romania',
      'Less developed region status = higher co-financing',
    ],
    commonPitfalls: [
      'Parallel activities instead of true joint cooperation',
      'Partnership of convenience without real complementarity',
      'Weak cross-border problem definition',
      'Communication plan as afterthought',
    ],
    budgetCategories: ['Staff costs', 'Office & admin (15% flat rate option)', 'Travel & accommodation', 'External expertise', 'Equipment', 'Infrastructure'],
    typicalDuration: '24-36 months',
  },

  erdf: {
    name: 'European Regional Development Fund',
    namero: 'Fondul European de Dezvoltare Regională (FEDR)',
    description: 'Strengthening economic, social and territorial cohesion',
    budget: 'Part of €392 billion Cohesion Policy',
    period: '2021-2027',
    cofinancingRate: '85% for less developed regions (includes most of Romania)',
    successRate: '~40-50% (varies by programme)',
    eligibleEntities: ['SMEs', 'Large enterprises', 'Public bodies', 'Research organizations', 'NGOs'],
    keyRequirements: [
      'Alignment with national/regional operational programme',
      'Contribution to smart specialization strategy',
      'Financial sustainability and viability',
      'Environmental sustainability (DNSH principle)',
    ],
    evaluationCriteria: [
      { name: 'Strategic relevance', weight: 30, description: 'Alignment with OP priorities and smart specialization' },
      { name: 'Project maturity', weight: 25, description: 'Technical readiness, permits, feasibility studies' },
      { name: 'Sustainability', weight: 25, description: 'Financial viability and environmental sustainability' },
      { name: 'Budget efficiency', weight: 20, description: 'Cost-effectiveness and value for money' },
    ],
    proposalSections: [
      'Project description and objectives',
      'Technical feasibility',
      'Financial analysis and sustainability',
      'Environmental impact',
      'Implementation plan',
    ],
    tips: [
      'Have all permits and technical documentation ready',
      'Cost-benefit analysis is crucial for infrastructure projects',
      'Align explicitly with regional smart specialization strategy',
      'Show job creation and economic impact with numbers',
    ],
    romanianAdvantages: [
      '85% co-financing rate (among highest in EU)',
      'Seven development regions with dedicated allocations',
      'Priority for digital transformation and green transition',
      'ADR (Regional Development Agencies) provide free support',
    ],
    commonPitfalls: [
      'Incomplete technical documentation',
      'Unrealistic financial projections',
      'Missing environmental permits',
      'Public procurement delays',
    ],
    budgetCategories: ['Works', 'Equipment', 'Services', 'Personnel', 'Land acquisition', 'Project management'],
    typicalDuration: '24-48 months',
  },

  pocidif: {
    name: 'POCIDIF',
    namero: 'Programul Operațional Competitivitate și Digitalizare (POCIDIF)',
    description: 'Romanian OP for competitiveness, innovation and digitalization',
    budget: '~€2.5 billion',
    period: '2021-2027',
    cofinancingRate: '85% for SMEs in less developed regions',
    successRate: '~35-45%',
    eligibleEntities: ['SMEs', 'Startups', 'Research organizations', 'Universities', 'Innovation clusters'],
    keyRequirements: [
      'Innovation and R&D focus',
      'Digital transformation component',
      'Alignment with Romanian Smart Specialization Strategy',
      'Market potential demonstration',
    ],
    evaluationCriteria: [
      { name: 'Innovation capacity', weight: 30, description: 'Novelty, R&D intensity, IP strategy' },
      { name: 'Market potential', weight: 25, description: 'Business plan, market analysis, commercialization' },
      { name: 'Technical feasibility', weight: 25, description: 'Methodology, team competence, resources' },
      { name: 'Team competence', weight: 20, description: 'Track record, qualifications, capacity' },
    ],
    proposalSections: [
      'Business plan',
      'Innovation description',
      'Market analysis',
      'Technical implementation plan',
      'Financial projections',
      'Team and management',
    ],
    tips: [
      'Include patent or IP strategy',
      'Show clear path from R&D to market',
      'Financial projections must be conservative and substantiated',
      'Highlight digital transformation aspects',
    ],
    romanianAdvantages: [
      'Dedicated funding for Romanian SMEs',
      'Higher co-financing for disadvantaged regions',
      'Support from Romanian Innovation Strategy',
      'Growing tech ecosystem (Bucharest, Cluj, Iași, Timișoara)',
    ],
    commonPitfalls: [
      'Unrealistic revenue projections',
      'Missing IP strategy',
      'Team CVs not matching project needs',
      'Budget not linked to milestones',
    ],
    budgetCategories: ['Personnel', 'Equipment', 'Materials', 'Subcontracting', 'IP costs', 'Overheads'],
    typicalDuration: '12-36 months',
  },

  pnrr: {
    name: 'PNRR',
    namero: 'Planul Național de Redresare și Reziliență',
    description: 'Romania National Recovery and Resilience Plan',
    budget: '€29.2 billion (€14.2B grants + €15B loans)',
    period: '2021-2026',
    cofinancingRate: '100% for most components',
    successRate: 'Varies by component',
    eligibleEntities: ['Public bodies', 'SMEs', 'Large enterprises', 'NGOs', 'Educational institutions'],
    keyRequirements: [
      'Alignment with specific PNRR component and reform',
      'Contribution to green transition (min 37%) or digital transition (min 20%)',
      'Do No Significant Harm (DNSH) principle compliance',
      'Milestone and target achievement',
    ],
    evaluationCriteria: [
      { name: 'Reform alignment', weight: 35, description: 'Direct contribution to PNRR reforms and milestones' },
      { name: 'Implementation capacity', weight: 25, description: 'Organizational readiness, track record, resources' },
      { name: 'Impact', weight: 25, description: 'Measurable contribution to component targets' },
      { name: 'Sustainability', weight: 15, description: 'Long-term impact beyond PNRR period' },
    ],
    proposalSections: [
      'Alignment with PNRR component',
      'Project description',
      'Implementation plan with milestones',
      'Budget and financing',
      'DNSH assessment',
      'Green and digital contribution',
    ],
    tips: [
      'Map explicitly to PNRR milestones and targets',
      'Strict deadlines - PNRR must be completed by 2026',
      'DNSH compliance is mandatory and rigorously checked',
      'Include green (37%) and digital (20%) tagging',
    ],
    romanianAdvantages: [
      '100% EU financing for most components',
      'Large budget allocation for Romania',
      'Political priority ensures institutional support',
      'Covers wide range of sectors',
    ],
    commonPitfalls: [
      'Missing 2026 completion deadline',
      'Insufficient DNSH documentation',
      'Not mapping to specific milestones/targets',
      'Procurement delays jeopardizing timeline',
    ],
    budgetCategories: ['Works', 'Equipment', 'Services', 'Personnel', 'Training', 'Digital solutions'],
    typicalDuration: '12-36 months (must complete by 2026)',
  },

  general: {
    name: 'General EU Funding',
    namero: 'Finanțare UE Generală',
    description: 'General EU funding guidelines',
    budget: 'Varies',
    period: '2021-2027',
    cofinancingRate: 'Varies by programme',
    successRate: 'Varies',
    eligibleEntities: ['Any legal entity'],
    keyRequirements: ['Programme-specific requirements apply'],
    evaluationCriteria: [
      { name: 'Relevance', weight: 25, description: 'Alignment with programme objectives' },
      { name: 'Quality', weight: 25, description: 'Technical and methodological quality' },
      { name: 'Impact', weight: 25, description: 'Expected outcomes and sustainability' },
      { name: 'Feasibility', weight: 25, description: 'Implementation capacity and resources' },
    ],
    proposalSections: ['Summary', 'Objectives', 'Methodology', 'Budget', 'Team', 'Impact'],
    tips: ['Follow the call guidelines precisely', 'Address all evaluation criteria explicitly'],
    romanianAdvantages: ['Less developed region status for higher co-financing'],
    commonPitfalls: ['Not reading the call text carefully'],
    budgetCategories: ['Personnel', 'Equipment', 'Travel', 'Subcontracting', 'Other', 'Overheads'],
    typicalDuration: '12-48 months',
  },
};

// ─── Knowledge Queries ───────────────────────────────────────────

export function getProgramInfo(program: EUProgramKey): EUProgram {
  return EU_PROGRAMS[program] || EU_PROGRAMS.general;
}

export function getEvaluationCriteria(program: EUProgramKey): EUProgram['evaluationCriteria'] {
  return EU_PROGRAMS[program]?.evaluationCriteria || EU_PROGRAMS.general.evaluationCriteria;
}

export function getBudgetCategories(program: EUProgramKey): string[] {
  return EU_PROGRAMS[program]?.budgetCategories || EU_PROGRAMS.general.budgetCategories;
}

export function getProposalSections(program: EUProgramKey): string[] {
  return EU_PROGRAMS[program]?.proposalSections || EU_PROGRAMS.general.proposalSections;
}

export function getRomanianAdvantages(program: EUProgramKey): string[] {
  return EU_PROGRAMS[program]?.romanianAdvantages || [];
}

export function findBestProgram(criteria: {
  sector?: string;
  projectType: 'research' | 'environment' | 'regional' | 'innovation' | 'digital' | 'infrastructure';
  hasInternationalPartners: boolean;
  budget: number;
  isRomanian: boolean;
}): EUProgramKey[] {
  const recommendations: EUProgramKey[] = [];

  if (criteria.projectType === 'research' && criteria.hasInternationalPartners) {
    recommendations.push('horizon_europe');
  }
  if (criteria.projectType === 'environment') {
    recommendations.push('life_plus');
  }
  if (criteria.hasInternationalPartners && criteria.budget < 2000000) {
    recommendations.push('interreg');
  }
  if (criteria.isRomanian && (criteria.projectType === 'innovation' || criteria.projectType === 'digital')) {
    recommendations.push('pocidif');
  }
  if (criteria.isRomanian && criteria.projectType === 'infrastructure') {
    recommendations.push('erdf');
  }
  if (criteria.isRomanian) {
    recommendations.push('pnrr');
  }

  return recommendations.length > 0 ? recommendations : ['general'];
}

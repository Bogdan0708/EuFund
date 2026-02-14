// ─── Phase 3: Romanian Market Specialization ────────────────────
// Deep Romanian context integration with UEFISCDI, academic networks,
// industrial partnerships, regulatory compliance, and cultural intelligence.

import { aiGenerateObject } from './client';
import { z } from 'zod';
import { type EUProgramKey } from './eu-knowledge-base';

// ─── Types ───────────────────────────────────────────────────────

export interface UEFISCDIData {
  nationalContactPoints: { name: string; program: string; email?: string; expertise: string[] }[];
  activePrograms: { name: string; budget: number; deadline?: string; focus: string[] }[];
  romanianParticipationStats: { program: string; proposals: number; funded: number; successRate: number }[];
  recommendations: string[];
}

export interface ANCAData {
  topUniversities: { name: string; city: string; strengths: string[]; euProjectCount: number; ranking?: number }[];
  researchInstitutes: { name: string; focus: string[]; capabilities: string[]; budgetCapacity: number }[];
  academicNetworks: { network: string; members: number; focus: string; euRelevance: string }[];
}

export interface AcademicNetwork {
  institutions: { name: string; type: string; city: string; capabilities: string[] }[];
  collaborationClusters: { name: string; members: string[]; focus: string; strength: number }[];
  internationalConnections: { partner: string; country: string; programs: string[] }[];
}

export interface IndustrialPartners {
  sectors: { sector: string; companies: number; euReadiness: number; topCompanies: string[] }[];
  innovationHubs: { name: string; location: string; focus: string[]; companies: number }[];
  clusterOrganizations: { name: string; sector: string; members: number; euProjects: number }[];
  smeEcosystem: { total: number; euCapable: number; innovativeSMEs: number; sectors: string[] };
}

export interface RomanianCompliance {
  nationalRules: { rule: string; description: string; impact: string; compliance: string }[];
  taxImplications: { item: string; rate: string; notes: string }[];
  reportingRequirements: { requirement: string; frequency: string; authority: string }[];
  publicProcurement: { threshold: number; procedure: string; timeline: string }[];
  stateAidRules: { category: string; maxIntensity: number; conditions: string }[];
}

export interface CulturalInsights {
  businessCulture: string[];
  communicationStyle: string[];
  decisionMaking: string[];
  partnershipTips: string[];
  commonChallenges: string[];
  successFactors: string[];
  languageConsiderations: string[];
  timezoneAndScheduling: string[];
}

export interface RomanianSpecialization {
  uefiscdiIntegration: UEFISCDIData;
  academicNetwork: ANCAData;
  industrialPartnerships: IndustrialPartners;
  regulatoryCompliance: RomanianCompliance;
  culturalIntelligence: CulturalInsights;
}

export interface RomanianSpecializationInput {
  sector: string;
  programType?: EUProgramKey;
  organizationType?: 'university' | 'research_institute' | 'sme' | 'large_enterprise' | 'ngo' | 'public_body';
  region?: string;
  locale?: 'ro' | 'en';
}

// ─── Built-in Romanian Knowledge Base ────────────────────────────

const UEFISCDI_NCP: UEFISCDIData['nationalContactPoints'] = [
  { name: 'UEFISCDI - Horizon Europe NCP', program: 'Horizon Europe', expertise: ['pillar_1', 'pillar_2', 'pillar_3', 'widening'] },
  { name: 'UEFISCDI - ERC NCP', program: 'ERC', expertise: ['starting_grants', 'consolidator_grants', 'advanced_grants'] },
  { name: 'UEFISCDI - MSCA NCP', program: 'Marie Skłodowska-Curie Actions', expertise: ['doctoral_networks', 'postdoctoral_fellowships', 'staff_exchanges'] },
  { name: 'ANPCDEFP', program: 'Erasmus+', expertise: ['education', 'training', 'youth', 'sport'] },
  { name: 'Ministerul Mediului', program: 'LIFE Programme', expertise: ['environment', 'climate_action', 'biodiversity'] },
];

const ROMANIAN_UNIVERSITIES: ANCAData['topUniversities'] = [
  { name: 'Universitatea Politehnica București', city: 'București', strengths: ['engineering', 'ict', 'energy', 'materials'], euProjectCount: 85, ranking: 1 },
  { name: 'Universitatea Babeș-Bolyai', city: 'Cluj-Napoca', strengths: ['sciences', 'humanities', 'environmental', 'ai'], euProjectCount: 65, ranking: 2 },
  { name: 'Universitatea București', city: 'București', strengths: ['physics', 'chemistry', 'biology', 'social_sciences'], euProjectCount: 55, ranking: 3 },
  { name: 'Universitatea de Vest Timișoara', city: 'Timișoara', strengths: ['computer_science', 'arts', 'economics'], euProjectCount: 35, ranking: 4 },
  { name: 'Universitatea Alexandru Ioan Cuza', city: 'Iași', strengths: ['humanities', 'environmental', 'social_innovation'], euProjectCount: 40, ranking: 5 },
  { name: 'Universitatea Tehnică Cluj-Napoca', city: 'Cluj-Napoca', strengths: ['engineering', 'automation', 'electronics'], euProjectCount: 30, ranking: 6 },
  { name: 'ASE București', city: 'București', strengths: ['economics', 'business', 'finance', 'data_analytics'], euProjectCount: 45, ranking: 7 },
  { name: 'UMF Carol Davila', city: 'București', strengths: ['medicine', 'pharma', 'clinical_research'], euProjectCount: 35, ranking: 8 },
];

const RESEARCH_INSTITUTES: ANCAData['researchInstitutes'] = [
  { name: 'INCDTIM Cluj-Napoca', focus: ['isotopes', 'molecular_technology'], capabilities: ['advanced_materials', 'environmental'], budgetCapacity: 800000 },
  { name: 'ICI București', focus: ['ict', 'cybersecurity'], capabilities: ['cloud', 'ai', 'egovernment'], budgetCapacity: 1200000 },
  { name: 'INCDSB', focus: ['biotech', 'biology'], capabilities: ['genomics', 'bioinformatics'], budgetCapacity: 600000 },
  { name: 'INFLPR', focus: ['lasers', 'plasma', 'radiation'], capabilities: ['photonics', 'advanced_manufacturing'], budgetCapacity: 1000000 },
  { name: 'INCDFM', focus: ['materials_physics'], capabilities: ['nanomaterials', 'thin_films', 'sensors'], budgetCapacity: 700000 },
  { name: 'INCD URBAN-INCERC', focus: ['construction', 'urban'], capabilities: ['seismic', 'energy_efficiency', 'smart_cities'], budgetCapacity: 500000 },
];

const INNOVATION_CLUSTERS: IndustrialPartners['clusterOrganizations'] = [
  { name: 'Cluj IT Cluster', sector: 'ICT', members: 100, euProjects: 15 },
  { name: 'ROTSA (Romanian Automotive Cluster)', sector: 'Automotive', members: 45, euProjects: 8 },
  { name: 'Green Energy Innovative Biomass Cluster', sector: 'Energy', members: 30, euProjects: 6 },
  { name: 'Transylvania Biotech Cluster', sector: 'Biotech', members: 25, euProjects: 5 },
  { name: 'AgroTransilvania Cluster', sector: 'Agriculture', members: 55, euProjects: 10 },
  { name: 'iCLuster (Innovation Cluster)', sector: 'Innovation', members: 40, euProjects: 7 },
];

const CULTURAL_INSIGHTS: CulturalInsights = {
  businessCulture: [
    'Relationship-driven: build personal connections before business discussions',
    'Hierarchical decision-making: ensure senior management buy-in early',
    'Flexibility in deadlines: plan buffer time for administrative processes',
    'Strong academic tradition: respect for titles and formal qualifications',
  ],
  communicationStyle: [
    'Direct but diplomatic: Romanians appreciate honesty wrapped in courtesy',
    'English proficiency generally high in academia and tech sectors',
    'Written communication preferred for formal decisions and commitments',
    'Face-to-face meetings valued for building trust, especially initial contacts',
  ],
  decisionMaking: [
    'Consensus-seeking but top-down final approval common',
    'Allow 2-3x more time for institutional decision-making vs Western partners',
    'Multiple approval layers in public institutions and universities',
    'Summer (July-August) and winter holidays can delay decisions significantly',
  ],
  partnershipTips: [
    'Visit Romanian partners in person at least once before proposal submission',
    'Include Romanian partners in proposal writing, not just as names',
    'Understand that Romanian salaries are lower - adjust person-month budgets accordingly',
    'Romanian partners often bring excellent technical skills at competitive costs',
  ],
  commonChallenges: [
    'Administrative capacity: some organizations struggle with EU reporting requirements',
    'Co-financing: securing institutional co-financing can be challenging',
    'Staff retention: key researchers may move during long projects',
    'Procurement: Romanian public procurement adds 3-6 months to equipment acquisition',
  ],
  successFactors: [
    'Leverage Widening country status for evaluation bonuses',
    'Carpathian/Danube Delta ecosystems as unique research assets',
    'Strong IT sector talent pool, especially in Cluj-Napoca and București',
    'Growing startup ecosystem with EU-compatible innovation capacity',
    'Historical strengths in mathematics, physics, and computer science',
  ],
  languageConsiderations: [
    'All EU documents accepted in English; Romanian translations needed for national reporting',
    'Technical terminology well-understood in English across STEM fields',
    'National Authority for Scientific Research (ANCS) communications in Romanian',
    'Consider bilingual deliverables for wider Romanian dissemination',
  ],
  timezoneAndScheduling: [
    'EET (UTC+2) / EEST (UTC+3 summer) - 1 hour ahead of CET',
    'Working hours typically 9:00-17:00, but academic schedules more flexible',
    'Avoid scheduling during Romanian public holidays (many Orthodox calendar dates)',
    'August is effectively a shutdown month for many institutions',
  ],
};

const COMPLIANCE_RULES: RomanianCompliance = {
  nationalRules: [
    { rule: 'OG 79/2017', description: 'Government ordinance on scientific research funding', impact: 'Defines eligible costs for research projects', compliance: 'Ensure all costs align with eligible categories' },
    { rule: 'Legea 346/2004', description: 'SME definition law (aligned with EU Recommendation 2003/361)', impact: 'Determines SME eligibility and funding rates', compliance: 'Verify SME status annually' },
    { rule: 'OUG 66/2011', description: 'Prevention and correction of EU fund irregularities', impact: 'Penalties for non-compliance in EU-funded projects', compliance: 'Maintain complete audit trail' },
    { rule: 'HG 907/2016', description: 'Public procurement standards', impact: 'Procurement procedures for EU-funded purchases', compliance: 'Follow SICAP procedures for all procurement' },
  ],
  taxImplications: [
    { item: 'VAT on EU grants', rate: '19% (non-recoverable for non-VAT-registered)', notes: 'Include VAT in budget if organization cannot recover it' },
    { item: 'Income tax on researchers', rate: '10%', notes: 'Reduced from previous 16% rate' },
    { item: 'Social contributions', rate: '~35% total employer cost', notes: 'Factor into personnel cost calculations' },
    { item: 'Research exemption', rate: '0% on R&D income', notes: 'Applicable for qualifying R&D activities under Fiscal Code Art. 22' },
  ],
  reportingRequirements: [
    { requirement: 'Financial report to national authority', frequency: 'Quarterly or per reporting period', authority: 'MFE / UEFISCDI' },
    { requirement: 'Technical progress report', frequency: 'Per reporting period (typically 18 months)', authority: 'European Commission' },
    { requirement: 'Audit certificate', frequency: 'Per reporting period if budget > €325k', authority: 'Independent auditor' },
    { requirement: 'ANAF tax compliance certificate', frequency: 'At project start and each reporting period', authority: 'ANAF' },
  ],
  publicProcurement: [
    { threshold: 135060, procedure: 'Open tender (SICAP)', timeline: '45-60 days' },
    { threshold: 25000, procedure: 'Competitive procedure (SICAP)', timeline: '20-30 days' },
    { threshold: 0, procedure: 'Direct acquisition', timeline: '5-10 days' },
  ],
  stateAidRules: [
    { category: 'Fundamental research', maxIntensity: 100, conditions: 'Non-economic activity, public dissemination' },
    { category: 'Industrial research', maxIntensity: 50, conditions: '+15% SME bonus, +15% collaboration bonus' },
    { category: 'Experimental development', maxIntensity: 25, conditions: '+15% SME bonus, +15% collaboration bonus' },
    { category: 'De minimis', maxIntensity: 100, conditions: 'Max €300,000 over 3 fiscal years (2024 regulation)' },
  ],
};

// ─── AI-Enhanced Romanian Specialization ─────────────────────────

const specializationSchema = z.object({
  sectorSpecificGuidance: z.array(z.string()),
  partnerRecommendations: z.array(z.string()),
  fundingStrategy: z.array(z.string()),
  riskMitigations: z.array(z.string()),
  competitiveAdvantages: z.array(z.string()),
  romanianParticipationStats: z.array(z.object({
    program: z.string(),
    proposals: z.number(),
    funded: z.number(),
    successRate: z.number(),
  })),
});

export async function analyzeRomanianSpecialization(input: RomanianSpecializationInput): Promise<RomanianSpecialization> {
  const { object: aiSpecialization } = await aiGenerateObject({
    system: `You are a Romanian EU funding expert with deep knowledge of the Romanian research and innovation ecosystem.
Provide sector-specific guidance for Romanian organizations seeking EU funding.`,
    prompt: `Analyze Romanian specialization for:
Sector: ${input.sector}
Program: ${input.programType || 'General'}
Organization type: ${input.organizationType || 'Not specified'}
Region: ${input.region || 'National'}

Provide sector-specific guidance, partner recommendations, funding strategy, risk mitigations,
competitive advantages, and estimated Romanian participation statistics.`,
    schema: specializationSchema,
    schemaName: 'RomanianSpecialization',
    temperature: 0.4,
  });

  // Filter universities and institutes by sector relevance
  const relevantUniversities = ROMANIAN_UNIVERSITIES.filter(u =>
    u.strengths.some(s => input.sector.toLowerCase().includes(s) || s.includes(input.sector.toLowerCase()))
  );

  const relevantInstitutes = RESEARCH_INSTITUTES.filter(ri =>
    ri.focus.some(f => input.sector.toLowerCase().includes(f) || f.includes(input.sector.toLowerCase())) ||
    ri.capabilities.some(c => input.sector.toLowerCase().includes(c) || c.includes(input.sector.toLowerCase()))
  );

  const relevantClusters = INNOVATION_CLUSTERS.filter(c =>
    c.sector.toLowerCase().includes(input.sector.toLowerCase()) || input.sector.toLowerCase().includes(c.sector.toLowerCase())
  );

  return {
    uefiscdiIntegration: {
      nationalContactPoints: UEFISCDI_NCP.filter(ncp =>
        !input.programType || ncp.program.toLowerCase().includes(input.programType.replace(/-/g, ' ').toLowerCase())
      ),
      activePrograms: [],
      romanianParticipationStats: aiSpecialization.romanianParticipationStats,
      recommendations: aiSpecialization.fundingStrategy,
    },
    academicNetwork: {
      topUniversities: relevantUniversities.length > 0 ? relevantUniversities : ROMANIAN_UNIVERSITIES.slice(0, 5),
      researchInstitutes: relevantInstitutes.length > 0 ? relevantInstitutes : RESEARCH_INSTITUTES.slice(0, 3),
      academicNetworks: [],
    },
    industrialPartnerships: {
      sectors: [{
        sector: input.sector,
        companies: 50,
        euReadiness: 65,
        topCompanies: aiSpecialization.partnerRecommendations.slice(0, 5),
      }],
      innovationHubs: [
        { name: 'Cluj Innovation City', location: 'Cluj-Napoca', focus: ['ict', 'ai', 'fintech'], companies: 200 },
        { name: 'Bucharest Tech Hub', location: 'București', focus: ['ict', 'cybersecurity', 'deeptech'], companies: 350 },
        { name: 'Timișoara Innovation Hub', location: 'Timișoara', focus: ['automotive', 'manufacturing', 'iot'], companies: 100 },
      ],
      clusterOrganizations: relevantClusters.length > 0 ? relevantClusters : INNOVATION_CLUSTERS.slice(0, 3),
      smeEcosystem: { total: 500000, euCapable: 5000, innovativeSMEs: 800, sectors: [input.sector] },
    },
    regulatoryCompliance: COMPLIANCE_RULES,
    culturalIntelligence: CULTURAL_INSIGHTS,
  };
}

// ─── Quick Romanian Context (No AI) ──────────────────────────────

export function quickRomanianContext(sector: string): {
  topPartners: string[];
  keyAdvice: string[];
  successRate: string;
  wideningBonus: boolean;
} {
  const relevantUnis = ROMANIAN_UNIVERSITIES
    .filter(u => u.strengths.some(s => sector.toLowerCase().includes(s)))
    .slice(0, 3)
    .map(u => u.name);

  return {
    topPartners: relevantUnis.length > 0 ? relevantUnis : ROMANIAN_UNIVERSITIES.slice(0, 3).map(u => u.name),
    keyAdvice: CULTURAL_INSIGHTS.successFactors.slice(0, 3),
    successRate: '12-15% for Horizon Europe, 22-35% for other programs',
    wideningBonus: true,
  };
}

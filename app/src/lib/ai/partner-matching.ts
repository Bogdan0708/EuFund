// ─── Phase 3: Smart Partner Matching Engine ──────────────────────
// AI-powered partner recommendations with capability gap analysis,
// geographic optimization, and Romanian ecosystem intelligence.

import { aiGenerateObject } from './client';
import { z } from 'zod';
import { type EUProgramKey } from './eu-knowledge-base';

// ─── Types ───────────────────────────────────────────────────────

export interface Partner {
  name: string;
  country: string;
  type: 'university' | 'research_institute' | 'sme' | 'large_enterprise' | 'ngo' | 'public_body';
  capabilities: string[];
  previousEUProjects: number;
  successRate: number;
  budgetCapacity: number;
  matchScore: number;
  matchReasons: string[];
  contactInfo?: string;
  specializations: string[];
}

export interface ConsortiumAnalysis {
  overallScore: number;
  strengthAreas: string[];
  weaknessAreas: string[];
  capabilityGaps: CapabilityGap[];
  diversityScore: number;
  experienceScore: number;
  geographicScore: number;
  smeRatio: number;
  recommendations: string[];
}

export interface CapabilityGap {
  capability: string;
  importance: 'critical' | 'important' | 'nice_to_have';
  suggestedPartnerTypes: string[];
  suggestedCountries: string[];
}

export interface GeographicOptimization {
  currentDistribution: Record<string, number>;
  requiredCountries: number;
  currentCountries: number;
  missingRegions: string[];
  eu13Representation: boolean;
  wideningCountryBonus: boolean;
  recommendations: string[];
}

export interface SkillMatrix {
  requiredSkills: string[];
  coveredSkills: string[];
  missingSkills: string[];
  coveragePercentage: number;
  skillsByPartner: Record<string, string[]>;
}

export interface OptimalBudgetDistribution {
  totalBudget: number;
  suggestedAllocations: { partner: string; amount: number; percentage: number; justification: string }[];
  coordinatorShare: number;
  smeShare: number;
  researchShare: number;
  managementOverhead: number;
}

export interface PartnershipRisk {
  risk: string;
  severity: 'high' | 'medium' | 'low';
  affectedPartners: string[];
  mitigation: string;
}

export interface PartnerRecommendation {
  recommendedPartners: Partner[];
  consortiumOptimization: ConsortiumAnalysis;
  geographicDistribution: GeographicOptimization;
  capabilityMatrix: SkillMatrix;
  budgetAllocation: OptimalBudgetDistribution;
  riskMitigation: PartnershipRisk[];
}

export interface PartnerMatchingInput {
  projectTitle: string;
  projectSummary: string;
  programType: EUProgramKey;
  totalBudget: number;
  requiredCapabilities: string[];
  existingPartners: {
    name: string;
    country: string;
    type: Partner['type'];
    capabilities: string[];
    budgetShare?: number;
    role: 'coordinator' | 'partner';
  }[];
  preferredCountries?: string[];
  sector: string;
  locale?: 'ro' | 'en';
}

// ─── Romanian Partner Database ───────────────────────────────────

const ROMANIAN_PARTNER_DATABASE: Partner[] = [
  {
    name: 'Universitatea Politehnica București',
    country: 'RO', type: 'university',
    capabilities: ['engineering', 'ict', 'materials', 'energy', 'robotics', 'ai'],
    previousEUProjects: 85, successRate: 0.72, budgetCapacity: 2000000,
    matchScore: 0, matchReasons: [], specializations: ['computer_science', 'electrical_engineering', 'mechanical_engineering'],
  },
  {
    name: 'Universitatea Babeș-Bolyai Cluj',
    country: 'RO', type: 'university',
    capabilities: ['chemistry', 'physics', 'biology', 'environmental', 'social_sciences', 'ai'],
    previousEUProjects: 65, successRate: 0.68, budgetCapacity: 1500000,
    matchScore: 0, matchReasons: [], specializations: ['natural_sciences', 'humanities', 'interdisciplinary'],
  },
  {
    name: 'INCDTIM Cluj-Napoca',
    country: 'RO', type: 'research_institute',
    capabilities: ['isotopes', 'molecular_technology', 'environmental', 'nuclear', 'materials'],
    previousEUProjects: 30, successRate: 0.65, budgetCapacity: 800000,
    matchScore: 0, matchReasons: [], specializations: ['advanced_materials', 'environmental_monitoring'],
  },
  {
    name: 'ICI București',
    country: 'RO', type: 'research_institute',
    capabilities: ['ict', 'cybersecurity', 'cloud', 'ai', 'big_data', 'digital_transformation'],
    previousEUProjects: 40, successRate: 0.70, budgetCapacity: 1200000,
    matchScore: 0, matchReasons: [], specializations: ['digital_infrastructure', 'egovernment'],
  },
  {
    name: 'Siveco Romania',
    country: 'RO', type: 'sme',
    capabilities: ['software_development', 'elearning', 'erp', 'digital_transformation'],
    previousEUProjects: 25, successRate: 0.75, budgetCapacity: 600000,
    matchScore: 0, matchReasons: [], specializations: ['education_technology', 'enterprise_software'],
  },
  {
    name: 'Fundația Conservation Carpathia',
    country: 'RO', type: 'ngo',
    capabilities: ['biodiversity', 'conservation', 'forestry', 'wildlife', 'environmental'],
    previousEUProjects: 12, successRate: 0.80, budgetCapacity: 500000,
    matchScore: 0, matchReasons: [], specializations: ['carpathian_ecosystems', 'rewilding'],
  },
  {
    name: 'ASE București',
    country: 'RO', type: 'university',
    capabilities: ['economics', 'business', 'finance', 'management', 'data_analytics'],
    previousEUProjects: 45, successRate: 0.65, budgetCapacity: 1000000,
    matchScore: 0, matchReasons: [], specializations: ['economic_modeling', 'business_innovation'],
  },
  {
    name: 'Universitatea de Medicină și Farmacie Carol Davila',
    country: 'RO', type: 'university',
    capabilities: ['health', 'medicine', 'pharma', 'clinical_trials', 'biotech'],
    previousEUProjects: 35, successRate: 0.60, budgetCapacity: 1200000,
    matchScore: 0, matchReasons: [], specializations: ['clinical_research', 'public_health'],
  },
  {
    name: 'Bitdefender',
    country: 'RO', type: 'large_enterprise',
    capabilities: ['cybersecurity', 'ai', 'iot_security', 'threat_intelligence'],
    previousEUProjects: 8, successRate: 0.85, budgetCapacity: 3000000,
    matchScore: 0, matchReasons: [], specializations: ['cybersecurity_research', 'ai_security'],
  },
  {
    name: 'ADR Nord-Vest',
    country: 'RO', type: 'public_body',
    capabilities: ['regional_development', 'innovation', 'smart_specialization', 'policy'],
    previousEUProjects: 50, successRate: 0.72, budgetCapacity: 800000,
    matchScore: 0, matchReasons: [], specializations: ['regional_innovation', 'cluster_development'],
  },
];

// ─── EU Widening Countries ───────────────────────────────────────

const EU_WIDENING_COUNTRIES = ['BG', 'HR', 'CY', 'CZ', 'EE', 'EL', 'HU', 'LV', 'LT', 'MT', 'PL', 'PT', 'RO', 'SK', 'SI'];

// ─── Matching Algorithm ──────────────────────────────────────────

function matchPartner(partner: Partner, requiredCapabilities: string[], sector: string): Partner {
  const matched = { ...partner, matchReasons: [] as string[] };
  let score = 0;

  // Capability matching
  const capabilityOverlap = partner.capabilities.filter(c =>
    requiredCapabilities.some(rc => rc.toLowerCase().includes(c) || c.includes(rc.toLowerCase()))
  );
  const capabilityScore = requiredCapabilities.length > 0 ? (capabilityOverlap.length / requiredCapabilities.length) * 40 : 20;
  score += capabilityScore;
  if (capabilityOverlap.length > 0) matched.matchReasons.push(`Covers: ${capabilityOverlap.join(', ')}`);

  // Experience
  const expScore = Math.min(20, partner.previousEUProjects * 0.4);
  score += expScore;
  if (partner.previousEUProjects > 10) matched.matchReasons.push(`${partner.previousEUProjects} EU projects`);

  // Success rate
  score += partner.successRate * 20;
  if (partner.successRate >= 0.7) matched.matchReasons.push(`${(partner.successRate * 100).toFixed(0)}% success rate`);

  // Sector alignment
  if (partner.specializations.some(s => sector.toLowerCase().includes(s) || s.includes(sector.toLowerCase()))) {
    score += 15;
    matched.matchReasons.push('Sector specialist');
  }

  // Budget capacity
  score += Math.min(5, partner.budgetCapacity / 1000000 * 5);

  matched.matchScore = Math.round(Math.min(100, score));
  return matched;
}

// ─── AI-Enhanced Partner Matching ────────────────────────────────

const matchingSchema = z.object({
  additionalPartnerSuggestions: z.array(z.object({
    name: z.string(),
    country: z.string(),
    type: z.enum(['university', 'research_institute', 'sme', 'large_enterprise', 'ngo', 'public_body']),
    capabilities: z.array(z.string()),
    matchReasons: z.array(z.string()),
    specializations: z.array(z.string()),
  })),
  consortiumAnalysis: z.object({
    overallScore: z.number(),
    strengthAreas: z.array(z.string()),
    weaknessAreas: z.array(z.string()),
    diversityScore: z.number(),
    experienceScore: z.number(),
    recommendations: z.array(z.string()),
  }),
  capabilityGaps: z.array(z.object({
    capability: z.string(),
    importance: z.enum(['critical', 'important', 'nice_to_have']),
    suggestedPartnerTypes: z.array(z.string()),
    suggestedCountries: z.array(z.string()),
  })),
  budgetRecommendations: z.array(z.object({
    partnerName: z.string(),
    suggestedPercentage: z.number(),
    justification: z.string(),
  })),
  risks: z.array(z.object({
    risk: z.string(),
    severity: z.enum(['high', 'medium', 'low']),
    affectedPartners: z.array(z.string()),
    mitigation: z.string(),
  })),
});

export async function recommendPartners(input: PartnerMatchingInput): Promise<PartnerRecommendation> {
  // Score Romanian partners from database
  const scoredPartners = ROMANIAN_PARTNER_DATABASE
    .filter(p => !input.existingPartners.some(ep => ep.name === p.name))
    .map(p => matchPartner(p, input.requiredCapabilities, input.sector))
    .sort((a, b) => b.matchScore - a.matchScore);

  // Geographic analysis
  const existingCountries = new Set(input.existingPartners.map(p => p.country));
  const hasWidening = input.existingPartners.some(p => EU_WIDENING_COUNTRIES.includes(p.country));

  const geographicDistribution: GeographicOptimization = {
    currentDistribution: input.existingPartners.reduce((acc, p) => {
      acc[p.country] = (acc[p.country] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    requiredCountries: input.programType === 'horizon_europe' ? 3 : 2,
    currentCountries: existingCountries.size,
    missingRegions: existingCountries.size < 3 ? ['Need more EU member states'] : [],
    eu13Representation: hasWidening,
    wideningCountryBonus: hasWidening,
    recommendations: [],
  };

  if (!hasWidening) geographicDistribution.recommendations.push('Add a Widening country partner for bonus points');
  if (existingCountries.size < 3) geographicDistribution.recommendations.push('Minimum 3 countries recommended for most EU programs');

  // Skill matrix
  const coveredSkills = [...new Set(input.existingPartners.flatMap(p => p.capabilities))];
  const missingSkills = input.requiredCapabilities.filter(s =>
    !coveredSkills.some(cs => cs.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(cs.toLowerCase()))
  );

  const capabilityMatrix: SkillMatrix = {
    requiredSkills: input.requiredCapabilities,
    coveredSkills,
    missingSkills,
    coveragePercentage: input.requiredCapabilities.length > 0
      ? Math.round(((input.requiredCapabilities.length - missingSkills.length) / input.requiredCapabilities.length) * 100)
      : 100,
    skillsByPartner: input.existingPartners.reduce((acc, p) => {
      acc[p.name] = p.capabilities;
      return acc;
    }, {} as Record<string, string[]>),
  };

  // AI-enhanced analysis
  const { object: aiAnalysis } = await aiGenerateObject({
    system: `You are an EU funding consortium expert. Analyze the consortium and recommend improvements.
Focus on Romanian organizations' strengths and EU funding requirements.
Consider geographic distribution, capability coverage, and program-specific requirements.`,
    prompt: `Project: ${input.projectTitle}
Summary: ${input.projectSummary}
Program: ${input.programType}
Budget: €${input.totalBudget.toLocaleString()}
Sector: ${input.sector}
Required capabilities: ${input.requiredCapabilities.join(', ')}

Existing partners:
${input.existingPartners.map(p => `- ${p.name} (${p.country}, ${p.type}, ${p.role}): ${p.capabilities.join(', ')}`).join('\n')}

Missing skills: ${missingSkills.join(', ') || 'None identified'}
Geographic coverage: ${[...existingCountries].join(', ')}

Top matching Romanian partners from database:
${scoredPartners.slice(0, 5).map(p => `- ${p.name} (${p.type}, score: ${p.matchScore}): ${p.capabilities.join(', ')}`).join('\n')}

Provide consortium optimization analysis and additional partner suggestions from across Europe.`,
    schema: matchingSchema,
    schemaName: 'PartnerMatchingAnalysis',
    temperature: 0.4,
  });

  // Build budget allocation
  const budgetAllocation: OptimalBudgetDistribution = {
    totalBudget: input.totalBudget,
    suggestedAllocations: aiAnalysis.budgetRecommendations.map(br => ({
      partner: br.partnerName,
      amount: Math.round(input.totalBudget * br.suggestedPercentage / 100),
      percentage: br.suggestedPercentage,
      justification: br.justification,
    })),
    coordinatorShare: 25,
    smeShare: 20,
    researchShare: 40,
    managementOverhead: 7,
  };

  // Merge AI suggestions with database partners
  const aiPartners: Partner[] = aiAnalysis.additionalPartnerSuggestions.map(s => ({
    ...s,
    previousEUProjects: 0,
    successRate: 0,
    budgetCapacity: 0,
    matchScore: 70,
    contactInfo: undefined,
  }));

  const allRecommended = [...scoredPartners.slice(0, 5), ...aiPartners]
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 10);

  return {
    recommendedPartners: allRecommended,
    consortiumOptimization: {
      overallScore: aiAnalysis.consortiumAnalysis.overallScore,
      strengthAreas: aiAnalysis.consortiumAnalysis.strengthAreas,
      weaknessAreas: aiAnalysis.consortiumAnalysis.weaknessAreas,
      capabilityGaps: aiAnalysis.capabilityGaps,
      diversityScore: aiAnalysis.consortiumAnalysis.diversityScore,
      experienceScore: aiAnalysis.consortiumAnalysis.experienceScore,
      geographicScore: Math.min(100, existingCountries.size * 20 + (hasWidening ? 20 : 0)),
      smeRatio: input.existingPartners.filter(p => p.type === 'sme').length / Math.max(1, input.existingPartners.length),
      recommendations: aiAnalysis.consortiumAnalysis.recommendations,
    },
    geographicDistribution,
    capabilityMatrix,
    budgetAllocation,
    riskMitigation: aiAnalysis.risks,
  };
}

// ─── Quick Partner Check (No AI) ─────────────────────────────────

export function quickPartnerMatch(
  requiredCapabilities: string[],
  sector: string,
  limit = 5,
): Partner[] {
  return ROMANIAN_PARTNER_DATABASE
    .map(p => matchPartner(p, requiredCapabilities, sector))
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit);
}

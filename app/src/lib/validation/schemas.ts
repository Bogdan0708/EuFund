import { z } from 'zod';

export const documentTypeSchema = z.enum([
  'proposal',
  'business_plan',
  'feasibility_study',
  'budget',
  'compliance',
  'other',
]);

export const analyzeDocumentSchema = z.object({
  documentText: z.string().min(1).max(10000),
  documentType: documentTypeSchema,
});

export const forecastLifecycleSchema = z.object({
  projectId: z.string().min(1),
  parameters: z.object({
    timeframeMonths: z.number().int().positive().max(120).optional(),
    budgetEuros: z.number().nonnegative().optional(),
    riskLevel: z.enum(['low', 'medium', 'high']).optional(),
    sector: z.string().max(100).optional(),
    region: z.string().max(100).optional(),
  }),
});

export const generateProposalSchema = z.object({
  // Accept both field names (frontend sends projectIdea, legacy sends businessDescription)
  projectIdea: z.string().min(1).max(10000).optional(),
  businessDescription: z.string().min(1).max(10000).optional(),
  programType: z.string().min(1).optional(),
  fundingProgram: z.string().min(1).optional(),
  organizationName: z.string().optional(),
  organizationType: z.string().optional(),
  sector: z.string().optional(),
  budget: z.number().optional(),
  duration: z.number().optional(),
  locale: z.string().optional(),
}).refine(
  (data) => data.projectIdea || data.businessDescription,
  { message: 'projectIdea or businessDescription is required', path: ['projectIdea'] }
);

export const companyProfileSchema = z.object({
  companyName: z.string().min(1),
  companyType: z.enum(['startup', 'sme', 'large_enterprise', 'ngo', 'public_body']),
  country: z.string().min(2),
  sector: z.string().min(1),
  employeeCount: z.number().int().nonnegative(),
  annualRevenue: z.number().nonnegative(),
});

export const matchGrantsSchema = z.object({
  companyProfile: companyProfileSchema,
});

export const predictSuccessSchema = z.object({
  applicationId: z.string().min(1),
});

export const validateComplianceSchema = z.object({
  proposalText: z.string().min(1).max(10000),
  regulations: z.array(z.string().min(1)).min(1),
});

export const checkEligibilitySchema = z.object({
  organization: z.object({
    orgType: z.string().min(1),
    orgSize: z.string().optional(),
    caenPrimary: z.string().optional(),
    caenSecondary: z.array(z.string()).optional(),
    nutsRegion: z.string().optional(),
    employeeCount: z.number().optional(),
    annualRevenue: z.number().optional(),
    foundedDate: z.string().optional(),
  }),
  project: z.object({
    totalBudget: z.number().optional(),
    ownContrib: z.number().optional(),
    durationMonths: z.number().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
  call: z.object({
    eligibleTypes: z.array(z.string()).optional(),
    eligibleRegions: z.array(z.string()).optional(),
    eligibleCaen: z.array(z.string()).optional(),
    budgetMin: z.number().optional(),
    budgetMax: z.number().optional(),
    cofinancingRate: z.number().optional(),
    durationMin: z.number().optional(),
    durationMax: z.number().optional(),
    submissionEnd: z.string().optional(),
  }),
});

export const enhanceIdeaSchema = z.object({
  projectIdea: z.string().min(20).max(8000),
  locale: z.enum(['ro', 'en']).default('ro'),
});

export const wizardMatchCallsSchema = z.object({
  projectIdea: z.string().min(20).max(8000),
  organization: z.object({
    orgType: z.string().min(1),
    employeeCount: z.number().int().nonnegative().optional(),
    annualRevenue: z.number().nonnegative().optional(),
  }),
  budget: z.number().nonnegative().optional(),
  locale: z.enum(['ro', 'en']).default('ro'),
});

export const wizardGenerateProjectSchema = z.object({
  projectIdea: z.string().min(20).max(8000),
  callId: z.string().uuid(),
  organization: z.object({
    orgName: z.string().min(1),
    orgType: z.string().min(1),
    sector: z.string().optional(),
  }),
  locale: z.enum(['ro', 'en']).default('ro'),
});

export const wizardSaveProjectSchema = z.object({
  callId: z.string().uuid(),
  orgId: z.string().uuid(),
  proposal: z.any(), // Detailed validation handled by mapping logic
});

export type EnhanceIdeaInput = z.infer<typeof enhanceIdeaSchema>;
export type WizardMatchCallsInput = z.infer<typeof wizardMatchCallsSchema>;
export type WizardGenerateProjectInput = z.infer<typeof wizardGenerateProjectSchema>;
export type WizardSaveProjectInput = z.infer<typeof wizardSaveProjectSchema>;

export type CheckEligibilityInput = z.infer<typeof checkEligibilitySchema>;

export type AnalyzeDocumentInput = z.infer<typeof analyzeDocumentSchema>;
export type ForecastLifecycleInput = z.infer<typeof forecastLifecycleSchema>;
export type GenerateProposalInput = z.infer<typeof generateProposalSchema>;
export type MatchGrantsInput = z.infer<typeof matchGrantsSchema>;
export type PredictSuccessInput = z.infer<typeof predictSuccessSchema>;
export type ValidateComplianceInput = z.infer<typeof validateComplianceSchema>;

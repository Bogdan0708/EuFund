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

export type AnalyzeDocumentInput = z.infer<typeof analyzeDocumentSchema>;
export type ForecastLifecycleInput = z.infer<typeof forecastLifecycleSchema>;
export type GenerateProposalInput = z.infer<typeof generateProposalSchema>;
export type MatchGrantsInput = z.infer<typeof matchGrantsSchema>;
export type PredictSuccessInput = z.infer<typeof predictSuccessSchema>;
export type ValidateComplianceInput = z.infer<typeof validateComplianceSchema>;

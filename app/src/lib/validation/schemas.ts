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
  parameters: z.record(z.string(), z.unknown()),
});

export const generateProposalSchema = z.object({
  businessDescription: z.string().min(1).max(10000),
  fundingProgram: z.string().min(1),
});

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

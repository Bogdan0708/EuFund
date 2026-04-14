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

export const predictSuccessSchema = z.object({
  applicationId: z.string().min(1),
});

export const validateComplianceSchema = z.object({
  proposalText: z.string().min(1).max(10000),
  regulations: z.array(z.string().min(1)).min(1),
});

export const enhanceIdeaSchema = z.object({
  projectIdea: z.string().min(20).max(8000),
  locale: z.enum(['ro', 'en']).default('ro'),
});


export const extractedCallSchema = z.object({
  callCode: z.string().min(1),
  titleRo: z.string().min(5),
  titleEn: z.string().optional(),
  descriptionRo: z.string().min(10),
  eligibleTypes: z.array(z.string()),
  eligibleRegions: z.array(z.string()).optional(),
  eligibleCaen: z.array(z.string()).optional(),
  budgetMin: z.number().optional(),
  budgetMax: z.number().optional(),
  cofinancingRate: z.number().optional(),
  durationMin: z.number().optional(),
  durationMax: z.number().optional(),
  submissionStart: z.string().optional(),
  submissionEnd: z.string().optional(),
  isCompetitive: z.boolean().default(true),
});

export type ExtractedCall = z.infer<typeof extractedCallSchema>;

export type EnhanceIdeaInput = z.infer<typeof enhanceIdeaSchema>;

export type AnalyzeDocumentInput = z.infer<typeof analyzeDocumentSchema>;
export type ForecastLifecycleInput = z.infer<typeof forecastLifecycleSchema>;
export type PredictSuccessInput = z.infer<typeof predictSuccessSchema>;
export type ValidateComplianceInput = z.infer<typeof validateComplianceSchema>;

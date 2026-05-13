import { z } from 'zod'

export const generateSectionBody = z.object({
  sectionKey: z.string().min(1).max(200).optional(),
  projectSummary: z.string().min(1).max(20_000).optional(),
  expectedStateVersion: z.number().int().nonnegative(),
})

export type GenerateSectionBody = z.infer<typeof generateSectionBody>

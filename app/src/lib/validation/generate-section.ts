import { z } from 'zod'

export const generateSectionBody = z.object({
  // Matches agent_sections.section_key column (varchar(100)).
  sectionKey: z.string().min(1).max(100).optional(),
  projectSummary: z.string().min(1).max(20_000).optional(),
  expectedStateVersion: z.number().int().nonnegative(),
})

export type GenerateSectionBody = z.infer<typeof generateSectionBody>

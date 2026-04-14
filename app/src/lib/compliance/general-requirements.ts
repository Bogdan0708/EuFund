/**
 * General EU requirements that apply to every Romanian EU-funded project.
 * These are always included in the submission dossier regardless of the call.
 * Each references a template in form-templates.ts by templateId.
 */
export interface GeneralRequirement {
  templateId: string
  title: string
  order: number
}

export const GENERAL_REQUIREMENTS: GeneralRequirement[] = [
  { templateId: 'tpl-declaratie-gdpr', title: 'Declarație privind prelucrarea datelor cu caracter personal', order: 1 },
  { templateId: 'tpl-declaratie-anti-frauda', title: 'Declarație anti-fraudă', order: 2 },
  { templateId: 'tpl-obligatii-publicitate', title: 'Declarație privind obligațiile de publicitate', order: 3 },
  { templateId: 'tpl-declaratie-beneficiar-real', title: 'Declarație privind beneficiarul real', order: 4 },
]

const V1_TO_V2: Record<string, string> = {
  ciorna: 'draft',
  in_lucru: 'action_plan',
  verificare: 'action_plan',
  finalizat: 'built',
  depus: 'exported',
  aprobat: 'exported',
  respins: 'draft',
  arhivat: 'exported',
  draft: 'draft',
  action_plan: 'action_plan',
  built: 'built',
  exported: 'exported',
}

export function normalizeProjectStatus(status: string): string {
  return V1_TO_V2[status] || 'draft'
}

export type ProjectDisplayStatus = 'draft' | 'action_plan' | 'built' | 'exported'

export const STATUS_VARIANT: Record<string, 'default' | 'warning' | 'accent' | 'success'> = {
  draft: 'default',
  action_plan: 'warning',
  built: 'accent',
  exported: 'success',
}

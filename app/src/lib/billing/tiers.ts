export interface TierLimits {
  workflowsPerMonth: number
  editsPerMonth: number
  maxActiveSessions: number
  fileStorageMB: number
  exportFormats: ('docx' | 'pdf')[]
  buildModel: 'standard' | 'premium'
  maxTeamMembers: number
  isLifetimeLimit: boolean
  priceGBP: number
}

export const TIER_LIMITS: Record<string, TierLimits> = {
  free: {
    workflowsPerMonth: 1,
    editsPerMonth: 5,
    maxActiveSessions: 1,
    fileStorageMB: 50,
    exportFormats: ['docx'],
    buildModel: 'standard',
    maxTeamMembers: 1,
    isLifetimeLimit: true,
    priceGBP: 0,
  },
  plus: {
    workflowsPerMonth: 10,
    editsPerMonth: 50,
    maxActiveSessions: 2,
    fileStorageMB: 500,
    exportFormats: ['docx'],
    buildModel: 'standard',
    maxTeamMembers: 1,
    isLifetimeLimit: false,
    priceGBP: 10,
  },
  pro: {
    workflowsPerMonth: 50,
    editsPerMonth: 300,
    maxActiveSessions: 3,
    fileStorageMB: 5120,
    exportFormats: ['docx', 'pdf'],
    buildModel: 'premium',
    maxTeamMembers: 1,
    isLifetimeLimit: false,
    priceGBP: 50,
  },
  ultra: {
    workflowsPerMonth: 200,
    editsPerMonth: Number.MAX_SAFE_INTEGER,
    maxActiveSessions: 10,
    fileStorageMB: 25600,
    exportFormats: ['docx', 'pdf'],
    buildModel: 'premium',
    maxTeamMembers: 5,
    isLifetimeLimit: false,
    priceGBP: 200,
  },
}

export function getTierLimits(tier: string): TierLimits {
  return TIER_LIMITS[tier] || TIER_LIMITS.free
}

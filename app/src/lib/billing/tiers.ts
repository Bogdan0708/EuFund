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
    workflowsPerMonth: 3,
    editsPerMonth: 5,
    maxActiveSessions: 1,
    fileStorageMB: 50,
    exportFormats: ['docx'],
    buildModel: 'standard',
    maxTeamMembers: 1,
    isLifetimeLimit: false,
    priceGBP: 0,
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
  enterprise: {
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

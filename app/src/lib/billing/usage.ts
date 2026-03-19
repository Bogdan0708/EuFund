// ─── Workflow and Edit Usage Tracking ───────────────────────────
import { getRedis } from '@/lib/redis/client'
import { getTierLimits } from './tiers'

function workflowKey(userId: string): string {
  return `usage:workflows:${userId}`
}

function editKey(userId: string): string {
  return `usage:edits:${userId}`
}

export async function checkWorkflowLimit(
  userId: string,
  tier: string
): Promise<{ allowed: boolean; used: number; limit: number; message?: string }> {
  const limits = getTierLimits(tier)
  const redis = getRedis()
  const raw = redis ? await redis.get(workflowKey(userId)) : null
  const used = parseInt(raw || '0', 10)

  if (used >= limits.workflowsPerMonth) {
    return {
      allowed: false,
      used,
      limit: limits.workflowsPerMonth,
      message: `You've used ${used}/${limits.workflowsPerMonth} ${limits.isLifetimeLimit ? 'total' : 'monthly'} workflows. Upgrade for more.`,
    }
  }

  return { allowed: true, used, limit: limits.workflowsPerMonth }
}

export async function incrementWorkflowCount(userId: string): Promise<number> {
  const redis = getRedis()
  if (!redis) return 0
  const key = workflowKey(userId)
  const count = await redis.incr(key)
  const ttl = await redis.ttl(key)
  if (ttl === -1) {
    await redis.expire(key, 30 * 24 * 60 * 60)
  }
  return count
}

export async function checkEditLimit(
  userId: string,
  tier: string
): Promise<{ allowed: boolean; used: number; limit: number; message?: string }> {
  const limits = getTierLimits(tier)
  if (limits.editsPerMonth === Number.MAX_SAFE_INTEGER) {
    return { allowed: true, used: 0, limit: Number.MAX_SAFE_INTEGER }
  }
  const redis = getRedis()
  const raw = redis ? await redis.get(editKey(userId)) : null
  const used = parseInt(raw || '0', 10)

  if (used >= limits.editsPerMonth) {
    return {
      allowed: false,
      used,
      limit: limits.editsPerMonth,
      message: `You've used ${used}/${limits.editsPerMonth} monthly edits. Upgrade for more.`,
    }
  }

  return { allowed: true, used, limit: limits.editsPerMonth }
}

export async function incrementEditCount(userId: string): Promise<number> {
  const redis = getRedis()
  if (!redis) return 0
  const key = editKey(userId)
  const count = await redis.incr(key)
  const ttl = await redis.ttl(key)
  if (ttl === -1) {
    await redis.expire(key, 30 * 24 * 60 * 60)
  }
  return count
}

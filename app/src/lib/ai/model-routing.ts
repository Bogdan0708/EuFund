// ─── Centralized AI Model Routing ────────────────────────────────
// Single source of truth for all model selection across agent tools
// and orchestrator agents. See plan: vast-moseying-milner.md

import type { ProviderName } from './providers/types'
import { MODEL_CONFIGS } from './providers/types'
import { db } from '@/lib/db'
import { userPreferences } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { isFeatureEnabled } from '@/lib/feature-flags'

// ─── Types ──────────────────────────────────────────────────────

export type RoutingTier = 'critical' | 'standard' | 'budget' | 'qa' | 'research'

export type TaskType =
  | 'section_generation'
  | 'structure_extraction'
  | 'freshness_check'
  | 'quality_check'
  | 'planning'
  | 'matching'
  | 'enhancement'
  | 'editing'
  | 'classification'
  | 'document_analysis'
  | 'grant_matching'

export interface ModelRoutingContext {
  modelPreference?: string
  featureFlags: { geminiPreview: boolean }
}

export interface ModelRoutingInput {
  task: TaskType
  importance?: 'critical' | 'standard' | 'supplementary'
  ctx?: ModelRoutingContext
  isEscalation?: boolean
}

export type RoutingSource = 'default' | 'user_override' | 'escalation'

export type OverrideBlockedReason =
  | 'preview_flag_disabled'
  | 'tier_not_overridable'
  | 'unknown_preference'
  | null

export interface ResolvedModel {
  provider: ProviderName
  model: string
  tier: RoutingTier
  source: RoutingSource
  overrideApplied: boolean
  overrideBlockedReason: OverrideBlockedReason
}

// ─── Routing Defaults ───────────────────────────────────────────
// The one real table. All other routing derives from this.

export const ROUTING_DEFAULTS: Record<RoutingTier, { provider: ProviderName; model: string }> = {
  critical: { provider: 'anthropic', model: 'claude-opus-4-6' },
  standard: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  budget:   { provider: 'openai',    model: 'gpt-5.4' },
  qa:       { provider: 'anthropic', model: 'claude-haiku-4-5' },
  research: { provider: 'perplexity', model: 'sonar-pro' },
}

// Derived compatibility export — replaces the old independent definition
// in providers/types.ts. Old callers can still import this shape.
export const SECTION_MODEL_ROUTING = {
  critical: ROUTING_DEFAULTS.critical.model,
  standard: ROUTING_DEFAULTS.standard.model,
  budget:   ROUTING_DEFAULTS.budget.model,
  qa:       ROUTING_DEFAULTS.qa.model,
  research: ROUTING_DEFAULTS.research.model,
} as const

// ─── Task → Tier Mapping ───────────────────────────────────────

const ESCALATION_ALLOWED_TASKS: ReadonlySet<TaskType> = new Set([
  'section_generation',
  'editing',
])

const OVERRIDABLE_TIERS: ReadonlySet<RoutingTier> = new Set([
  'standard',
  'qa',
])

function mapTaskToTier(task: TaskType, importance?: string): RoutingTier {
  switch (task) {
    case 'section_generation':
      if (importance === 'critical') return 'critical'
      if (importance === 'supplementary') return 'budget'
      return 'standard'
    case 'structure_extraction':
    case 'matching':
    case 'enhancement':
    case 'classification':
    case 'document_analysis':
    case 'grant_matching':
      return 'budget'
    case 'freshness_check':
      return 'research'
    case 'quality_check':
      return 'qa'
    case 'planning':
      return 'critical'
    case 'editing':
      return 'standard'
  }
}

// ─── Preference → Model Resolution ─────────────────────────────

const GEMINI_MODELS = new Set(['gemini-3.1-pro', 'gemini-3-flash', 'nano-banana'])

function resolvePreference(preference: string): { provider: ProviderName; model: string } | null {
  switch (preference) {
    case 'claude-sonnet':
      return { provider: 'anthropic', model: 'claude-sonnet-4-6' }
    case 'claude-haiku':
      return { provider: 'anthropic', model: 'claude-haiku-4-5' }
    case 'gpt-4o':
      return { provider: 'openai', model: 'gpt-5.4' }
    case 'gpt-4o-mini':
      return { provider: 'openai', model: 'gpt-5.4-mini' }
    case 'gpt-4o-nano':
      return { provider: 'openai', model: 'gpt-5.4-nano' }
    case 'gemini-pro':
      return { provider: 'google', model: 'gemini-3.1-pro' }
    case 'gemini-flash':
      return { provider: 'google', model: 'gemini-3-flash' }
    case 'nano-banana':
      return { provider: 'google', model: 'nano-banana' }
    case 'perplexity':
      return { provider: 'perplexity', model: 'sonar-pro' }
    default:
      return null
  }
}

// ─── Core Resolver ──────────────────────────────────────────────

export function resolveAgentModel(input: ModelRoutingInput): ResolvedModel {
  const { task, importance, ctx, isEscalation } = input

  // 1. Map task to tier
  const tier = mapTaskToTier(task, importance)

  // 2. Task-specific escalation
  if (isEscalation && ESCALATION_ALLOWED_TASKS.has(task)) {
    const defaults = ROUTING_DEFAULTS.critical
    return {
      provider: defaults.provider,
      model: defaults.model,
      tier: 'critical',
      source: 'escalation',
      overrideApplied: false,
      overrideBlockedReason: null,
    }
  }

  // 3. Look up defaults
  const defaults = ROUTING_DEFAULTS[tier]
  let { provider, model } = defaults

  // 4. User preference override (standard and qa only)
  let source: RoutingSource = 'default'
  let overrideApplied = false
  let overrideBlockedReason: OverrideBlockedReason = null

  const preference = ctx?.modelPreference
  if (preference && preference !== 'auto') {
    if (!OVERRIDABLE_TIERS.has(tier)) {
      overrideBlockedReason = 'tier_not_overridable'
    } else {
      const resolved = resolvePreference(preference)
      if (!resolved) {
        overrideBlockedReason = 'unknown_preference'
      } else if (GEMINI_MODELS.has(resolved.model) && !ctx?.featureFlags?.geminiPreview) {
        overrideBlockedReason = 'preview_flag_disabled'
      } else {
        provider = resolved.provider
        model = resolved.model
        source = 'user_override'
        overrideApplied = true
      }
    }
  }

  // 5. Capability validation
  if (!MODEL_CONFIGS[model]) {
    throw new Error(`Model routing: unknown model "${model}" for task "${task}" tier "${tier}"`)
  }
  if (tier === 'research' && provider !== 'perplexity') {
    throw new Error(`Model routing: research tier requires perplexity provider, got "${provider}"`)
  }

  return { provider, model, tier, source, overrideApplied, overrideBlockedReason }
}

// ─── Context Loader ─────────────────────────────────────────────
// Call once per request, pass the result through ToolContext/WorkflowContext.

export async function getAIModelRoutingContext(userId: string): Promise<ModelRoutingContext> {
  const [prefs] = await db
    .select({ defaultModel: userPreferences.defaultModel })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1)

  const geminiPreview = await isFeatureEnabled('gemini-3-preview', { userId })

  return {
    modelPreference: prefs?.defaultModel ?? undefined,
    featureFlags: { geminiPreview },
  }
}

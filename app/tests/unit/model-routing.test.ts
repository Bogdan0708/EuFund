import { describe, it, expect } from 'vitest'
import {
  resolveAgentModel,
  ROUTING_DEFAULTS,
  SECTION_MODEL_ROUTING,
  type TaskType,
  type ModelRoutingContext,
  type ModelRoutingInput,
} from '@/lib/ai/model-routing'
import { MODEL_CONFIGS } from '@/lib/ai/providers/types'

// ─── Helpers ────────────────────────────────────────────────────

const NO_CTX: ModelRoutingContext = { featureFlags: { geminiPreview: false } }

function resolve(overrides: Partial<ModelRoutingInput> = {}) {
  return resolveAgentModel({ task: 'section_generation', ctx: NO_CTX, ...overrides })
}

// ─── Task → Tier Mapping ───────────────────────────────────────

describe('task to tier mapping', () => {
  const cases: [TaskType, string | undefined, string][] = [
    ['section_generation', 'critical', 'critical'],
    ['section_generation', 'standard', 'standard'],
    ['section_generation', 'supplementary', 'budget'],
    ['section_generation', undefined, 'standard'],
    ['structure_extraction', undefined, 'budget'],
    ['matching', undefined, 'budget'],
    ['enhancement', undefined, 'budget'],
    ['classification', undefined, 'budget'],
    ['freshness_check', undefined, 'research'],
    ['quality_check', undefined, 'qa'],
    ['planning', undefined, 'critical'],
    ['editing', undefined, 'standard'],
  ]

  it.each(cases)('%s (importance=%s) → tier %s', (task, importance, expectedTier) => {
    const result = resolve({ task, importance: importance as ModelRoutingInput['importance'] })
    expect(result.tier).toBe(expectedTier)
  })
})

// ─── Default Model Selection ───────────────────────────────────

describe('default model selection', () => {
  it('critical tier uses claude-opus-4-6', () => {
    const r = resolve({ task: 'planning' })
    expect(r.model).toBe('claude-opus-4-6')
    expect(r.provider).toBe('anthropic')
    expect(r.source).toBe('default')
  })

  it('standard tier uses claude-sonnet-4-6', () => {
    const r = resolve({ task: 'editing' })
    expect(r.model).toBe('claude-sonnet-4-6')
    expect(r.provider).toBe('anthropic')
  })

  it('budget tier uses gpt-5.4', () => {
    const r = resolve({ task: 'structure_extraction' })
    expect(r.model).toBe('gpt-5.4')
    expect(r.provider).toBe('openai')
  })

  it('qa tier uses claude-haiku-4-5', () => {
    const r = resolve({ task: 'quality_check' })
    expect(r.model).toBe('claude-haiku-4-5')
    expect(r.provider).toBe('anthropic')
  })

  it('research tier uses sonar-pro', () => {
    const r = resolve({ task: 'freshness_check' })
    expect(r.model).toBe('sonar-pro')
    expect(r.provider).toBe('perplexity')
  })
})

// ─── User Preference Override ──────────────────────────────────

describe('user preference override', () => {
  it('overrides standard tier when preference is set', () => {
    const ctx: ModelRoutingContext = { modelPreference: 'gpt-4o', featureFlags: { geminiPreview: false } }
    const r = resolve({ task: 'editing', ctx })
    expect(r.model).toBe('gpt-5.4')
    expect(r.provider).toBe('openai')
    expect(r.source).toBe('user_override')
    expect(r.overrideApplied).toBe(true)
  })

  it('overrides qa tier when preference is set', () => {
    const ctx: ModelRoutingContext = { modelPreference: 'claude-sonnet', featureFlags: { geminiPreview: false } }
    const r = resolve({ task: 'quality_check', ctx })
    expect(r.model).toBe('claude-sonnet-4-6')
    expect(r.provider).toBe('anthropic')
    expect(r.overrideApplied).toBe(true)
  })

  it('ignores override on critical tier', () => {
    const ctx: ModelRoutingContext = { modelPreference: 'gpt-4o', featureFlags: { geminiPreview: false } }
    const r = resolve({ task: 'planning', ctx })
    expect(r.model).toBe('claude-opus-4-6')
    expect(r.overrideApplied).toBe(false)
    expect(r.overrideBlockedReason).toBe('tier_not_overridable')
  })

  it('ignores override on budget tier', () => {
    const ctx: ModelRoutingContext = { modelPreference: 'claude-sonnet', featureFlags: { geminiPreview: false } }
    const r = resolve({ task: 'structure_extraction', ctx })
    expect(r.model).toBe('gpt-5.4')
    expect(r.overrideBlockedReason).toBe('tier_not_overridable')
  })

  it('ignores override on research tier', () => {
    const ctx: ModelRoutingContext = { modelPreference: 'gpt-4o', featureFlags: { geminiPreview: false } }
    const r = resolve({ task: 'freshness_check', ctx })
    expect(r.model).toBe('sonar-pro')
    expect(r.overrideBlockedReason).toBe('tier_not_overridable')
  })

  it('ignores auto preference', () => {
    const ctx: ModelRoutingContext = { modelPreference: 'auto', featureFlags: { geminiPreview: false } }
    const r = resolve({ task: 'editing', ctx })
    expect(r.model).toBe('claude-sonnet-4-6')
    expect(r.overrideApplied).toBe(false)
    expect(r.overrideBlockedReason).toBeNull()
  })

  it('reports unknown preference', () => {
    const ctx: ModelRoutingContext = { modelPreference: 'nonexistent-model', featureFlags: { geminiPreview: false } }
    const r = resolve({ task: 'editing', ctx })
    expect(r.model).toBe('claude-sonnet-4-6')
    expect(r.overrideBlockedReason).toBe('unknown_preference')
  })
})

// ─── Gemini Preview Gating ─────────────────────────────────────

describe('gemini preview gating', () => {
  it('blocks gemini override when preview flag is off', () => {
    const ctx: ModelRoutingContext = { modelPreference: 'gemini-pro', featureFlags: { geminiPreview: false } }
    const r = resolve({ task: 'editing', ctx })
    expect(r.model).toBe('claude-sonnet-4-6')
    expect(r.overrideBlockedReason).toBe('preview_flag_disabled')
  })

  it('allows gemini override when preview flag is on', () => {
    const ctx: ModelRoutingContext = { modelPreference: 'gemini-pro', featureFlags: { geminiPreview: true } }
    const r = resolve({ task: 'editing', ctx })
    expect(r.model).toBe('gemini-3.1-pro')
    expect(r.provider).toBe('google')
    expect(r.overrideApplied).toBe(true)
  })

  it('blocks gemini-flash when preview flag is off', () => {
    const ctx: ModelRoutingContext = { modelPreference: 'gemini-flash', featureFlags: { geminiPreview: false } }
    const r = resolve({ task: 'quality_check', ctx })
    expect(r.model).toBe('claude-haiku-4-5')
    expect(r.overrideBlockedReason).toBe('preview_flag_disabled')
  })

  it('allows non-gemini override regardless of flag', () => {
    const ctx: ModelRoutingContext = { modelPreference: 'gpt-4o-mini', featureFlags: { geminiPreview: false } }
    const r = resolve({ task: 'editing', ctx })
    expect(r.model).toBe('gpt-5.4-mini')
    expect(r.overrideApplied).toBe(true)
  })
})

// ─── Escalation ────────────────────────────────────────────────

describe('escalation', () => {
  it('escalates section_generation to critical', () => {
    const r = resolve({ task: 'section_generation', importance: 'standard', isEscalation: true })
    expect(r.tier).toBe('critical')
    expect(r.model).toBe('claude-opus-4-6')
    expect(r.source).toBe('escalation')
  })

  it('escalates editing to critical', () => {
    const r = resolve({ task: 'editing', isEscalation: true })
    expect(r.tier).toBe('critical')
    expect(r.model).toBe('claude-opus-4-6')
    expect(r.source).toBe('escalation')
  })

  it('ignores escalation for structure_extraction', () => {
    const r = resolve({ task: 'structure_extraction', isEscalation: true })
    expect(r.tier).toBe('budget')
    expect(r.model).toBe('gpt-5.4')
    expect(r.source).toBe('default')
  })

  it('ignores escalation for classification', () => {
    const r = resolve({ task: 'classification', isEscalation: true })
    expect(r.tier).toBe('budget')
  })

  it('ignores escalation for matching', () => {
    const r = resolve({ task: 'matching', isEscalation: true })
    expect(r.tier).toBe('budget')
  })

  it('ignores escalation for freshness_check', () => {
    const r = resolve({ task: 'freshness_check', isEscalation: true })
    expect(r.tier).toBe('research')
  })
})

// ─── Capability Validation ─────────────────────────────────────

describe('capability validation', () => {
  it('all default models exist in MODEL_CONFIGS', () => {
    for (const [tier, { model }] of Object.entries(ROUTING_DEFAULTS)) {
      expect(MODEL_CONFIGS[model], `model "${model}" for tier "${tier}" missing from MODEL_CONFIGS`).toBeDefined()
    }
  })

  it('all resolved providers match MODEL_CONFIGS', () => {
    const tasks: TaskType[] = [
      'section_generation', 'structure_extraction', 'freshness_check',
      'quality_check', 'planning', 'matching', 'enhancement', 'editing', 'classification',
    ]
    for (const task of tasks) {
      const r = resolve({ task })
      const config = MODEL_CONFIGS[r.model]
      expect(config.provider, `provider mismatch for task "${task}": resolved ${r.provider}, config ${config.provider}`).toBe(r.provider)
    }
  })

  it('research tier always returns perplexity', () => {
    const r = resolve({ task: 'freshness_check' })
    expect(r.provider).toBe('perplexity')
  })
})

// ─── Derived Compatibility Export ──────────────────────────────

describe('SECTION_MODEL_ROUTING compatibility', () => {
  it('matches ROUTING_DEFAULTS models', () => {
    expect(SECTION_MODEL_ROUTING.critical).toBe(ROUTING_DEFAULTS.critical.model)
    expect(SECTION_MODEL_ROUTING.standard).toBe(ROUTING_DEFAULTS.standard.model)
    expect(SECTION_MODEL_ROUTING.budget).toBe(ROUTING_DEFAULTS.budget.model)
    expect(SECTION_MODEL_ROUTING.qa).toBe(ROUTING_DEFAULTS.qa.model)
    expect(SECTION_MODEL_ROUTING.research).toBe(ROUTING_DEFAULTS.research.model)
  })
})

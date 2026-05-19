// Regression tests for app/src/lib/ai/agent/services/section-generation.ts
//
// Pins two policy invariants on the live /sections/generate path:
//
// 1. NEVER routes to a non-Anthropic model (prior commit accidentally let
//    importance='supplementary' fan out through the multi-provider resolver
//    to gpt-5.4, which the Anthropic SDK would have rejected at runtime).
// 2. With interactive_section_sonnet_default OFF, the token cap stays at
//    the conservative legacy 4096 — raising it while Opus is still the
//    default for modelHint='heavy' sections would reintroduce the very 300s
//    timeout we just fixed.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const isFeatureEnabledMock = vi.hoisted(() => vi.fn())
const streamMock = vi.hoisted(() =>
  vi.fn(() => ({
    async *[Symbol.asyncIterator]() {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'A draft paragraph that is comfortably above the eighty character minimum length requirement so the generator does not raise GenerationInvalidError.' } }
    },
  })),
)

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: isFeatureEnabledMock,
}))

vi.mock('@/lib/ai/anthropic-client', () => ({
  getAnthropicClient: () => ({
    messages: { stream: streamMock },
  }),
}))

vi.mock('@/lib/ai/agent/services/evidence', () => ({
  retrieveEvidence: vi.fn().mockResolvedValue({ chunks: [] }),
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

import { streamSectionGeneration } from '@/lib/ai/agent/services/section-generation'
import type { AgentSession, AgentSection, SectionSpec } from '@/lib/ai/agent/types'

const SESSION: AgentSession = {
  id: 's-1',
  userId: 'u-1',
  projectId: null,
  status: 'active',
  locale: 'ro',
  selectedCallId: 'call-1',
  currentPhase: 'drafting',
  blueprint: null,
  eligibility: null,
  outline: null,
  warnings: [],
  planningArtifact: null,
  outlineFrozen: true,
  messageSummary: null,
  stateVersion: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const SVC_CTX = {
  userId: 'u-1',
  sessionId: 's-1',
  projectId: undefined,
  requestId: 'r-1',
  now: new Date(),
  allowWrites: true,
}

function makeSpec(overrides: Partial<SectionSpec> = {}): SectionSpec {
  return {
    id: 'a',
    title: 'A',
    description: '',
    order: 1,
    generationOrder: 1,
    importance: 'standard',
    expectedLength: 'long',
    dependsOn: [],
    modelHint: 'light',
    mandatory: true,
    confidence: 0.9,
    ...overrides,
  }
}

async function drain(spec: SectionSpec) {
  const out: unknown[] = []
  for await (const d of streamSectionGeneration(SVC_CTX, {
    session: SESSION,
    spec,
    priorSections: [] as AgentSection[],
  })) {
    out.push(d)
  }
  return out
}

describe('streamSectionGeneration routing policy', () => {
  beforeEach(() => {
    isFeatureEnabledMock.mockReset()
    streamMock.mockClear()
  })

  it('supplementary sections still call Anthropic (NEVER fans out to gpt-5.4)', async () => {
    // The bug: prior commit routed supplementary through the multi-provider
    // resolver which returned the budget tier (OpenAI). This service only
    // calls anthropic.messages.stream, so supplementary MUST stay Anthropic.
    isFeatureEnabledMock.mockResolvedValue(false)
    await drain(makeSpec({ importance: 'supplementary', modelHint: 'light' }))
    expect(streamMock).toHaveBeenCalledTimes(1)
    const call = (streamMock.mock.calls[0] as unknown as [{ model: string; max_tokens: number }])[0]
    expect(call.model).toBe('claude-sonnet-4-6')
    expect(call.model).not.toMatch(/gpt-/)
  })

  it('flag OFF + modelHint=heavy keeps Opus (legacy path)', async () => {
    isFeatureEnabledMock.mockResolvedValue(false)
    await drain(makeSpec({ modelHint: 'heavy', importance: 'critical' }))
    const call = (streamMock.mock.calls[0] as unknown as [{ model: string; max_tokens: number }])[0]
    expect(call.model).toBe('claude-opus-4-6')
  })

  it('flag OFF + modelHint=light routes to Sonnet (legacy path)', async () => {
    isFeatureEnabledMock.mockResolvedValue(false)
    await drain(makeSpec({ modelHint: 'light', importance: 'critical' }))
    const call = (streamMock.mock.calls[0] as unknown as [{ model: string; max_tokens: number }])[0]
    expect(call.model).toBe('claude-sonnet-4-6')
  })

  it('flag ON forces Sonnet regardless of importance or modelHint', async () => {
    isFeatureEnabledMock.mockImplementation(async (key: string) =>
      key === 'interactive_section_sonnet_default',
    )
    await drain(makeSpec({ importance: 'critical', modelHint: 'heavy' }))
    const call = (streamMock.mock.calls[0] as unknown as [{ model: string; max_tokens: number }])[0]
    expect(call.model).toBe('claude-sonnet-4-6')
  })

  it('flag OFF caps max_tokens at the conservative legacy 4096', async () => {
    // Raising the cap to 12000 while Opus is still in play would push
    // long-section turns past Cloud Run's 300s. The cap MUST unlock with
    // the Sonnet rollout, not before.
    isFeatureEnabledMock.mockResolvedValue(false)
    await drain(makeSpec({ expectedLength: 'long' }))
    const call = (streamMock.mock.calls[0] as unknown as [{ model: string; max_tokens: number }])[0]
    expect(call.max_tokens).toBe(4_096)
  })

  it('flag ON unlocks tiered caps (long → 12000)', async () => {
    isFeatureEnabledMock.mockImplementation(async (key: string) =>
      key === 'interactive_section_sonnet_default',
    )
    await drain(makeSpec({ expectedLength: 'long' }))
    const call = (streamMock.mock.calls[0] as unknown as [{ model: string; max_tokens: number }])[0]
    expect(call.max_tokens).toBe(12_000)
  })

  it('extra_long without section_extra_long_enabled falls back to long cap', async () => {
    isFeatureEnabledMock.mockImplementation(async (key: string) =>
      key === 'interactive_section_sonnet_default',
    )
    await drain(makeSpec({ expectedLength: 'extra_long' }))
    const call = (streamMock.mock.calls[0] as unknown as [{ model: string; max_tokens: number }])[0]
    expect(call.max_tokens).toBe(12_000)
  })

  it('extra_long WITH section_extra_long_enabled unlocks 20000', async () => {
    isFeatureEnabledMock.mockImplementation(async (key: string) =>
      key === 'interactive_section_sonnet_default' || key === 'section_extra_long_enabled',
    )
    await drain(makeSpec({ expectedLength: 'extra_long' }))
    const call = (streamMock.mock.calls[0] as unknown as [{ model: string; max_tokens: number }])[0]
    expect(call.max_tokens).toBe(20_000)
  })
})

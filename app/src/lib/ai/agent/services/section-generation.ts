// Single streaming Anthropic call with pre-fetched context. No tools, no
// state mutations. The route persists the final content via
// saveSectionDraft AFTER consuming the stream.

import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages'
import type { AgentSection, AgentSession, SectionSpec } from '../types'
import type { ServiceContext } from './types'
import { getAnthropicClient } from '@/lib/ai/anthropic-client'
import { retrieveEvidence } from './evidence'
import { GenerationInvalidError } from './errors'
import { logger } from '@/lib/logger'
import { isFeatureEnabled } from '@/lib/feature-flags'

const log = logger.child({ component: 'section-generation' })

export interface GenerateSectionInput {
  session: AgentSession
  spec: SectionSpec
  priorSections: AgentSection[]
  /**
   * External abort signal. When it aborts, the Anthropic stream stops
   * mid-flight and the generator throws so the route's catch branch can
   * close the SSE cleanly. Without this, Cloud Run cancelling the request
   * leaves the Anthropic stream producing tokens in the background.
   */
  signal?: AbortSignal
}

export type GenerationDelta =
  | { type: 'delta'; content: string }
  | { type: 'final'; content: string; model: string }

// Minimum acceptable draft length, in chars. Guards against empty or
// truncated streams; ~80 chars is one short paragraph.
const MIN_LEN = 80
const EVIDENCE_CHUNKS = 8

// Legacy hard cap — preserved while Opus is still the default for
// modelHint='heavy' sections. At Opus output rate (~30-40 tok/s) a 12k
// cap would push interactive turns past 5 minutes. The conservative
// 4096 cap stays in place until interactive_section_sonnet_default is
// flipped, then the tiered caps below unlock.
const LEGACY_MAX_TOKENS = 4_096

// Output-token caps mirror the chat-tool path (generate-section.ts).
// Only used once interactive_section_sonnet_default is ON — they assume
// Sonnet's faster output rate; using these with Opus would regress the
// 300s timeout problem we just fixed.
const TOKEN_CAPS = {
  short: 6_000,
  medium: 10_000,
  long: 12_000,
  extra_long: 20_000,
} as const

function maxTokensFor(expectedLength: string | undefined, extraLongEnabled: boolean): number {
  if (expectedLength === 'extra_long') {
    return extraLongEnabled ? TOKEN_CAPS.extra_long : TOKEN_CAPS.long
  }
  if (expectedLength === 'long') return TOKEN_CAPS.long
  if (expectedLength === 'medium') return TOKEN_CAPS.medium
  return TOKEN_CAPS.short
}

/**
 * Stream a single section draft from Anthropic. Yields one `delta` per
 * text delta and a terminal `final` event after the stream ends.
 * Throws on empty / refusal-like output (the route maps these to
 * GENERATION_INVALID).
 */
export async function* streamSectionGeneration(
  ctx: ServiceContext,
  input: GenerateSectionInput,
): AsyncGenerator<GenerationDelta, void, unknown> {
  const { session, spec, signal } = input
  const callId = session.selectedCallId
  if (!callId) {
    throw new GenerationInvalidError('other', 'Session has no selectedCallId — cannot generate section')
  }

  // Pre-fetch evidence (zero-tool generation: no model lookup loop).
  const evidence = await retrieveEvidence(ctx, callId, {
    query: `${spec.title}. ${spec.description}`,
    maxChunks: EVIDENCE_CHUNKS,
  })

  // This service is Anthropic-only by design (single
  // anthropic.messages.stream call below). Don't fan out through the
  // multi-provider resolver — the budget tier for supplementary sections
  // resolves to OpenAI's gpt-5.4 and the Anthropic SDK would reject it
  // with an unknown-model error. Flag-gated Anthropic-only mapping:
  //   - interactive_section_sonnet_default ON: force Sonnet regardless
  //     of importance/modelHint (the rollout policy).
  //   - flag OFF: preserve the pre-existing modelHint='heavy' → Opus
  //     mapping so quality stays consistent on the un-migrated path.
  // bypassCache:true so an emergency rollback isn't delayed by the LRU.
  const interactiveSonnetEnabled = await isFeatureEnabled(
    'interactive_section_sonnet_default',
    { userId: ctx.userId, bypassCache: true },
  )
  const extraLongEnabled = await isFeatureEnabled(
    'section_extra_long_enabled',
    { userId: ctx.userId, bypassCache: true },
  )
  const model = interactiveSonnetEnabled
    ? 'claude-sonnet-4-6'
    : spec.modelHint === 'heavy'
      ? 'claude-opus-4-6'
      : 'claude-sonnet-4-6'
  // Token cap is also flag-gated: the tiered caps assume Sonnet's output
  // rate. Keeping them under the legacy 4096 ceiling while Opus is still
  // the default for heavy sections avoids reintroducing the 300s timeout
  // we just fixed.
  const max_tokens = interactiveSonnetEnabled
    ? maxTokensFor(spec.expectedLength, extraLongEnabled)
    : LEGACY_MAX_TOKENS
  const messages = buildMessages(input, evidence.chunks)

  // Fast-path: bail if the caller is already cancelled before we even
  // start streaming. Saves one round-trip.
  if (signal?.aborted) {
    throw Object.assign(new Error('aborted'), { name: 'AbortError' })
  }

  const anthropic = getAnthropicClient()
  const stream = anthropic.messages.stream({
    model,
    max_tokens,
    messages,
  }, signal ? { signal } : undefined)

  let full = ''
  for await (const event of stream as unknown as AsyncIterable<RawMessageStreamEvent>) {
    if (event.type !== 'content_block_delta') continue
    if (event.delta.type !== 'text_delta') continue
    const piece = event.delta.text
    full += piece
    yield { type: 'delta', content: piece }
  }

  if (full.length < MIN_LEN) {
    log.warn({ sessionId: session.id, sectionKey: spec.id, length: full.length }, 'generated output below MIN_LEN')
    throw new GenerationInvalidError(
      full.length === 0 ? 'empty' : 'too_short',
      `Section draft length ${full.length} is below minimum ${MIN_LEN}`,
    )
  }
  if (looksLikeRefusal(full)) {
    log.warn({ sessionId: session.id, sectionKey: spec.id }, 'generated output looks like refusal')
    throw new GenerationInvalidError('refusal_detected', 'Generated content matches a refusal heuristic')
  }

  yield { type: 'final', content: full, model }
}

function looksLikeRefusal(text: string): boolean {
  const t = text.toLowerCase().trim()
  if (t.startsWith("i'm sorry, but") || t.startsWith('îmi pare rău')) return true
  return /(?:i can(?:not| ?'t) help|i refuse|nu pot să te ajut|nu pot să te asist)/i.test(t)
}

function buildMessages(
  input: GenerateSectionInput,
  chunks: { content: string; source: string }[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const { session, spec, priorSections } = input

  const prior = priorSections
    .filter((s) => s.status === 'accepted' && (s.acceptedContent ?? s.content))
    .sort((a, b) => a.documentOrder - b.documentOrder)
    .map((s) => `### ${s.title}\n\n${s.acceptedContent ?? s.content}`)
    .join('\n\n')

  const evidenceBlock = chunks
    .map((c, i) => `[${i + 1}] (${c.source})\n${c.content}`)
    .join('\n\n')

  const locale = session.locale === 'en' ? 'English' : 'Romanian'

  return [
    {
      role: 'user',
      content: `You are drafting a section of an EU funding application in ${locale}.

## Section to draft
Title: ${spec.title}
Description: ${spec.description}
Importance: ${spec.importance}
Expected length: ${spec.expectedLength}

## Prior accepted sections
${prior || '(none)'}

## Supporting evidence (citations available; use bracket numbers if helpful)
${evidenceBlock || '(no specific evidence retrieved)'}

## Instructions
Write the section text only. No preamble, no meta-commentary. Match the call's tone and the prior accepted sections' style.`,
    },
  ]
}

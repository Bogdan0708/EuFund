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

const log = logger.child({ component: 'section-generation' })

export interface GenerateSectionInput {
  session: AgentSession
  spec: SectionSpec
  priorSections: AgentSection[]
}

export type GenerationDelta =
  | { type: 'delta'; content: string }
  | { type: 'final'; content: string; model: string }

// Minimum acceptable draft length, in chars. Guards against empty or
// truncated streams; ~80 chars is one short paragraph.
const MIN_LEN = 80
const MAX_TOKENS = 4096
const EVIDENCE_CHUNKS = 8

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
  const { session, spec } = input
  const callId = session.selectedCallId
  if (!callId) {
    throw new GenerationInvalidError('other', 'Session has no selectedCallId — cannot generate section')
  }

  // Pre-fetch evidence (zero-tool generation: no model lookup loop).
  const evidence = await retrieveEvidence(ctx, callId, {
    query: `${spec.title}. ${spec.description}`,
    maxChunks: EVIDENCE_CHUNKS,
  })

  const model = spec.modelHint === 'heavy' ? 'claude-opus-4-6' : 'claude-sonnet-4-6'
  const messages = buildMessages(input, evidence.chunks)

  const anthropic = getAnthropicClient()
  const stream = anthropic.messages.stream({
    model,
    max_tokens: MAX_TOKENS,
    messages,
  })

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

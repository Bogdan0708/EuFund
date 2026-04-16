// ── Managed runtime — one-turn driver ───────────────────────────
// Runs one browser request through Anthropic's messages API.
// A single request can span multiple tool-use sub-streams inside the
// loop; all emissions go through a single SSE stream back to the
// frontend.

import type {
  MessageParam,
  ToolUseBlock,
  TextBlock,
  ToolResultBlockParam,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages'
import type {
  AgentEvent,
  AgentRequest,
  AgentSession,
  AgentSection,
  Phase,
  UIStateSnapshot,
} from '../types'
import type { ServiceContext } from '../services/types'
import { getAnthropicClient } from '@/lib/ai/anthropic-client'
import { MANAGED_READ_ONLY_TOOLS } from './tools'
import { translateAnthropicEvent, createTranslatorContext } from './translator'
import { buildManagedSystemPrompt } from './prompt'
import { executeManagedTool, type ExecutorResult } from './executor'
import {
  loadManagedHistory,
  appendManagedMessage,
  persistFirstDurableOutput,
  markTurnCompleted,
} from './history'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'managed-runtime' })

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS_PER_TURN = 4096
const ITERATION_CAP = 8

export interface ManagedRuntimeOptions {
  session: AgentSession
  sections: AgentSection[]
  request: AgentRequest
  emit: (event: AgentEvent) => void
  serviceCtx: ServiceContext
  // Pre-stream turn-claim id. All persisted messages in this turn are
  // tagged with it. Owned by the route — the route inserts the claim
  // row before opening the SSE Response and passes the id in here.
  turnId: string
}

export interface ManagedTurnResult {
  toolCount: number
  iterationCount: number
  model: string | null
  latencyMs: number
  // False means the turn failed (or stopped) before the first durable
  // assistant/tool_use block ever persisted. The route's catch branch
  // uses this to decide whether to call deleteEmptyTurn. Any non-throw
  // return from this function implies a turn that did produce content.
  firstOutputPersisted: boolean
}

export async function runManagedTurn(opts: ManagedRuntimeOptions): Promise<ManagedTurnResult> {
  const { session, sections, request, emit, serviceCtx, turnId } = opts
  const start = Date.now()
  const anthropic = getAnthropicClient()
  const tctx = createTranslatorContext()

  let toolCount = 0
  let iterationCount = 0
  // Message persistence is deferred until the first durable assistant or
  // tool_use block arrives. This flag flips true inside the stream loop
  // the first time we flush the user message + first output together.
  let firstOutputPersisted = false

  // 1. Load history. systemSummary is extracted from V3 compaction rows
  //    (system_summary message type) or falls back to session.messageSummary
  //    when no compaction rows exist.
  //    The user message for THIS turn is NOT yet persisted — it joins
  //    the in-memory history only and flushes to DB alongside the first
  //    durable output via persistFirstDurableOutput. See Finding 3
  //    (pre-stream claim + deferred persistence).
  const { messages: history, systemSummary } = await loadManagedHistory(session.id)

  // 2. Push the current user message into in-memory history ONLY.
  if (request.message) {
    history.push({ role: 'user', content: request.message })
  }

  // 3. Build the system prompt. When systemSummary is non-null, a bilingual
  //    'Prior conversation summary' block is appended at the prompt end.
  const systemPrompt = buildManagedSystemPrompt(
    session,
    sections,
    session.currentPhase as Phase,
    session.locale,
    systemSummary,
  )

  // 4. Tool loop
  const runningMessages: MessageParam[] = [...history]

  while (iterationCount < ITERATION_CAP) {
    iterationCount += 1

    const stream = anthropic.messages.stream({
      model: MODEL,
      system: systemPrompt,
      tools: MANAGED_READ_ONLY_TOOLS,
      messages: runningMessages,
      max_tokens: MAX_TOKENS_PER_TURN,
    })

    const assistantBlocks: (TextBlock | ToolUseBlock)[] = []
    const toolBlocksToExecute: ToolUseBlock[] = []
    const inputJsonAccumulators = new Map<number, string>()
    let stopReason: string | null = null

    for await (const event of stream as unknown as AsyncIterable<RawMessageStreamEvent>) {
      // Translate and emit
      const agentEvent = translateAnthropicEvent(event, tctx)
      if (agentEvent) emit(agentEvent)

      // Runtime-level bookkeeping
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          inputJsonAccumulators.set(event.index, '')
          assistantBlocks.push(event.content_block as ToolUseBlock)
        } else if (event.content_block.type === 'text') {
          assistantBlocks.push({ ...event.content_block, text: '' } as TextBlock)
        }
      }
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          const last = assistantBlocks[assistantBlocks.length - 1]
          if (last && last.type === 'text') {
            ;(last as TextBlock).text += event.delta.text
          }
        } else if (event.delta.type === 'input_json_delta') {
          const existing = inputJsonAccumulators.get(event.index) ?? ''
          inputJsonAccumulators.set(event.index, existing + event.delta.partial_json)
        }
      }
      if (event.type === 'content_block_stop') {
        const block = assistantBlocks[assistantBlocks.length - 1]
        if (block && block.type === 'tool_use') {
          // Parse the accumulated input JSON
          const jsonStr = inputJsonAccumulators.get(event.index) ?? '{}'
          try {
            ;(block as ToolUseBlock).input = JSON.parse(jsonStr)
          } catch {
            ;(block as ToolUseBlock).input = {}
          }
          toolBlocksToExecute.push(block as ToolUseBlock)
        }
      }
      if (event.type === 'message_delta') {
        stopReason = event.delta?.stop_reason ?? stopReason
      }
    }

    // Persist the assistant message. The FIRST durable output in the
    // turn is flushed in a single transaction alongside the user
    // message (Finding 3 — deferred persistence). Subsequent outputs
    // append normally, tagged with the same turnId.
    if (assistantBlocks.length > 0) {
      if (!firstOutputPersisted) {
        await persistFirstDurableOutput({
          turnId,
          sessionId: session.id,
          userMessage: request.message ?? '',
          firstOutput: {
            role: 'assistant',
            messageType: 'text',
            content: assistantBlocks,
          },
          meta: {
            runtimeMode: 'managed',
            provider: 'anthropic',
            model: tctx.messageModel,
          },
        })
        firstOutputPersisted = true
      } else {
        await appendManagedMessage(session.id, {
          role: 'assistant',
          messageType: 'text',
          content: assistantBlocks,
          turnId,
        }, {
          runtimeMode: 'managed',
          provider: 'anthropic',
          model: tctx.messageModel,
        })
      }
      runningMessages.push({ role: 'assistant', content: assistantBlocks })
    }

    // If there are no tool calls, we're done
    if (toolBlocksToExecute.length === 0) {
      break
    }

    // Execute tools sequentially in emitted order
    const toolResultBlocks: ToolResultBlockParam[] = []
    for (const block of toolBlocksToExecute) {
      const result: ExecutorResult = await executeManagedTool(block, serviceCtx)
      toolCount += 1

      emit({
        type: 'tool_result',
        tool: result.toolName,
        summary: result.isError ? result.content : 'OK',
        success: !result.isError,
      })

      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: result.content,
        is_error: result.isError,
      })

      await appendManagedMessage(session.id, {
        role: 'user',
        messageType: 'tool_result',
        content: [{
          type: 'tool_result',
          tool_use_id: block.id,
          content: result.content,
          is_error: result.isError,
        }],
        toolCallId: block.id,
        toolName: result.toolName,
        turnId,
      }, { runtimeMode: 'managed' })
    }

    runningMessages.push({ role: 'user', content: toolResultBlocks })

    // Continue the loop if the model wants more tools
    if (stopReason !== 'tool_use') {
      break
    }
  }

  // Iteration cap hit
  if (iterationCount >= ITERATION_CAP) {
    log.warn({
      sessionId: session.id,
      requestId: request.requestId,
      iterationCount,
    }, 'managed turn hit iteration cap')
    emit({
      type: 'text_delta',
      content: session.locale === 'ro'
        ? '\n\n(Limita de iterații atinsă. Vă rog, clarificați întrebarea.)'
        : '\n\n(Reached tool iteration limit. Please clarify your request.)',
    })
  }

  // Mark the turn complete only if at least one durable output landed.
  // A turn that hit the iteration cap without producing any output (or
  // one where the stream produced zero blocks) stays uncompleted so the
  // route's catch branch or the daily reconciliation cron can classify
  // it as an empty orphan.
  if (firstOutputPersisted) {
    await markTurnCompleted(turnId)
  }

  const finalState = buildUISnapshot(session, sections)
  emit({ type: 'done', finalState })

  // Structured turn-complete log — consumed by the reconciliation
  // queries and pilot dashboards (see docs/superpowers/runbooks/
  // managed-pilot-observability.md).
  log.info({
    event: 'managed_turn_complete',
    sessionId: session.id,
    turnId,
    requestId: request.requestId,
    iterations: iterationCount,
    toolCount,
    durationMs: Date.now() - start,
    outcome: firstOutputPersisted ? 'completed' : 'no_output',
    degradedReason: null,
    model: tctx.messageModel,
  }, 'managed_turn_complete')

  return {
    toolCount,
    iterationCount,
    model: tctx.messageModel,
    latencyMs: Date.now() - start,
    firstOutputPersisted,
  }
}

function buildUISnapshot(session: AgentSession, sections: AgentSection[]): UIStateSnapshot {
  return {
    sessionId: session.id,
    phase: session.currentPhase,
    stateVersion: session.stateVersion,
    warnings: session.warnings,
    sections: sections.map(s => ({
      sectionKey: s.sectionKey,
      title: s.title,
      status: s.status,
      documentOrder: s.documentOrder,
    })),
    blueprint: session.blueprint,
    eligibility: session.eligibility,
  }
}

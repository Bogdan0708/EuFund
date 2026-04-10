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
import { loadManagedHistory, appendManagedMessage } from './history'
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
}

export interface ManagedTurnResult {
  toolCount: number
  iterationCount: number
  model: string | null
  latencyMs: number
}

export async function runManagedTurn(opts: ManagedRuntimeOptions): Promise<ManagedTurnResult> {
  const { session, sections, request, emit, serviceCtx } = opts
  const start = Date.now()
  const anthropic = getAnthropicClient()
  const tctx = createTranslatorContext()

  let toolCount = 0
  let iterationCount = 0

  // 1. Load history
  const history = await loadManagedHistory(session.id)

  // 2. Append the current user message if present
  if (request.message) {
    await appendManagedMessage(session.id, {
      role: 'user',
      messageType: 'text',
      content: request.message,
    }, { runtimeMode: 'managed' })
    history.push({ role: 'user', content: request.message })
  }

  // 3. Build the system prompt
  const systemPrompt = buildManagedSystemPrompt(
    session,
    sections,
    session.currentPhase as Phase,
    session.locale,
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

    // Persist the assistant message
    if (assistantBlocks.length > 0) {
      await appendManagedMessage(session.id, {
        role: 'assistant',
        messageType: 'text',
        content: assistantBlocks,
      }, {
        runtimeMode: 'managed',
        provider: 'anthropic',
        model: tctx.messageModel,
      })
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

  const finalState = buildUISnapshot(session, sections)
  emit({ type: 'done', finalState })

  log.info({
    sessionId: session.id,
    requestId: request.requestId,
    toolCount,
    iterationCount,
    model: tctx.messageModel,
    latencyMs: Date.now() - start,
  }, 'managed turn complete')

  return {
    toolCount,
    iterationCount,
    model: tctx.messageModel,
    latencyMs: Date.now() - start,
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

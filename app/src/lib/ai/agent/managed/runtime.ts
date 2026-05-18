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
import { projectSessionState } from '../state-projection'
import { getManagedTools, WRITE_TOOL_NAMES } from './tools'
import { translateAnthropicEvent, createTranslatorContext } from './translator'
import { buildManagedSystemPrompt } from './prompt'
import { executeManagedTool, type ExecutorResult } from './executor'

const PARALLEL_WRITE_BLOCKED_MESSAGE =
  'PARALLEL_WRITE_BLOCKED: Only one write tool call is allowed per assistant message. This write was rejected because another write was already issued in the same turn. Wait for the first result, then decide the next step.'

/**
 * Runtime-level parallel-write cap (Desk Audit Fix 1).
 *
 * Allows at most ONE write tool call per assistant message. Subsequent
 * write blocks receive a synthetic PARALLEL_WRITE_BLOCKED tool_result
 * without being dispatched to the executor. Non-write tools run
 * normally alongside the first write, preserving order so the Anthropic
 * tool_use ↔ tool_result pairing invariant holds.
 *
 * Exported for unit testing; intended for internal use by runManagedTurn.
 */
export async function executeToolBlocksWithWriteCap(
  blocks: ToolUseBlock[],
  ctx: ServiceContext,
  executor: (block: ToolUseBlock, c: ServiceContext) => Promise<ExecutorResult>,
): Promise<Array<{ block: ToolUseBlock; result: ExecutorResult }>> {
  let writesExecuted = 0
  const out: Array<{ block: ToolUseBlock; result: ExecutorResult }> = []

  for (const block of blocks) {
    const isWrite = WRITE_TOOL_NAMES.has(block.name)

    if (isWrite && writesExecuted >= 1) {
      out.push({
        block,
        result: {
          content: PARALLEL_WRITE_BLOCKED_MESSAGE,
          isError: true,
          toolName: block.name,
          latencyMs: 0,
        },
      })
      continue
    }

    const result = await executor(block, ctx)
    if (isWrite) writesExecuted += 1
    out.push({ block, result })
  }

  return out
}
import {
  loadManagedHistory,
  appendManagedMessage,
  persistFirstDurableOutput,
  markTurnCompleted,
} from './history'
import { compactIfNeeded } from '../history'
import { reloadSessionAndSections } from './reload'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { logger } from '@/lib/logger'
import { trackIterationCapHit } from '@/lib/monitoring/metrics'
import { addUsage, computeAnthropicCostMicros, type UsageLike } from '@/lib/ai/cost/anthropic-pricing'

const log = logger.child({ component: 'managed-runtime' })

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS_PER_TURN = 4096
const ITERATION_CAP = 8

// Prompt caching: the system prompt and the tool list are functionally
// static across every turn in a session (system prompt changes only when
// the phase or systemSummary shifts; tools change only when allowWrites
// toggles). We mark them both as ephemeral so turns beyond the first
// read them at ~10% of the base input price. See
// https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching.
const CACHE_CONTROL_EPHEMERAL = { type: 'ephemeral' as const }

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
  focusedSectionKey?: string
  // Fires on consumer cancellation (client disconnect, Cloud Run 300s
  // timeout, AbortSignal.timeout). Checked at the top of each iteration.
  signal?: AbortSignal
  // Soft deadline epoch ms — set to ~30s before the hard timeout. Distinct
  // from `signal` so the runtime emits a graceful continuation message
  // rather than exiting silently.
  deadlineAt?: number
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
  // True when the post-write reload step (reloadSessionAndSections)
  // threw — durable output IS persisted (firstOutputPersisted=true) but
  // the UI snapshot is stale and a terminal error event was emitted in
  // place of the done event. The route uses this to skip
  // recordManagedSuccess / recordTurnSuccess so health metrics don't
  // false-green on reload failure.
  reloadFailed?: boolean
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
  // Tracks whether any WRITE_TOOL_NAMES tool dispatched in this turn returned
  // a non-error result. Read after the loop to decide whether to reload
  // session/sections from DB before building the final UI snapshot.
  let writesSucceeded = false

  // 1. Load history. systemSummary is extracted from V3 compaction rows
  //    (system_summary message type) or falls back to session.messageSummary
  //    when no compaction rows exist.
  //    The user message for THIS turn is NOT yet persisted — it joins
  //    the in-memory history only and flushes to DB alongside the first
  //    durable output via persistFirstDurableOutput. See Finding 3
  //    (pre-stream claim + deferred persistence).
  const { messages: history, systemSummary } = await loadManagedHistory(session.id)

  // 1b. PR2 Item A.2 — preselect synthetic evidence injection.
  //     When the session was bootstrapped via deterministic preselect
  //     and lookupBlueprint stashed rawEvidence, inject a synthetic
  //     retrieve_evidence tool_use + tool_result pair into in-memory
  //     history so the model sees evidence as if it had called the
  //     tool. NOT persisted to agent_messages. Inserted BEFORE the
  //     current user message push so runningMessages contains:
  //     [...history, synthetic_assistant, synthetic_user, current_user].
  //     The system prompt's research-phase branch (3a) tells the model
  //     NOT to call get_call_blueprint or retrieve_evidence.
  //     Skipped when session.blueprint is already set — that means a
  //     previous turn already ran save_call_blueprint and persisted.
  const preselectArtifact = (
    session.planningArtifact as { preselect?: { rawEvidence?: unknown[]; rankedAt?: string } } | null
  )?.preselect
  const rawEvidence = Array.isArray(preselectArtifact?.rawEvidence)
    ? (preselectArtifact!.rawEvidence as unknown[])
    : []
  const shouldInject =
    session.currentPhase === 'research' &&
    session.selectedCallId !== null &&
    rawEvidence.length > 0 &&
    session.blueprint === null

  if (shouldInject) {
    try {
      const syntheticToolUseId = `preselect_evidence_${turnId}`
      history.push({
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: syntheticToolUseId,
          name: 'retrieve_evidence',
          input: { callId: session.selectedCallId },
        }] as never,
      })
      history.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: syntheticToolUseId,
          content: JSON.stringify({
            callId: session.selectedCallId,
            chunks: rawEvidence,
            totalChunks: rawEvidence.length,
            retrievedAt: preselectArtifact?.rankedAt ?? new Date().toISOString(),
          }),
          is_error: false,
        }] as never,
      })
    } catch (err) {
      // Defensive — the JSON.stringify above could only throw on a
      // circular structure. Log and skip injection so the turn continues.
      // Without injection the model falls back to calling tools (the
      // research-phase 3b branch in the prompt is the natural fallback,
      // but since 3a was already selected the model may now be confused;
      // acceptable trade-off for not crashing the turn).
      log.warn(
        { sessionId: session.id, requestId: request.requestId, error: err instanceof Error ? err.message : String(err) },
        'preselect synthetic injection skipped (corrupted rawEvidence)',
      )
    }
  }

  // 2. Push the current user message into in-memory history ONLY.
  if (request.message) {
    history.push({ role: 'user', content: request.message })
  }

  // 3. Build the system prompt. When systemSummary is non-null, a bilingual
  //    'Prior conversation summary' block is appended at the prompt end.
  //    When allowWrites is false, the write-tool surface and the "Write
  //    tool rules" block are omitted so the model never sees writes it
  //    cannot perform. The executor gate in tool dispatch remains as
  //    defense-in-depth.
  const allowWrites = serviceCtx.allowWrites === true

  // PR 4: chat tool-surface trim + iteration-cap drop. Always read with
  // bypassCache so an emergency disable propagates within one turn.
  const chatToolsTrimmed = await isFeatureEnabled('chat_tools_trimmed', {
    userId: serviceCtx.userId,
    bypassCache: true,
  })
  // PR 4 live-test: 3 iterations was too tight in practice — even simple
  // questions need ~3-4 read calls (get_application_state + list_sections +
  // get_section). Bumped to 5 to keep cost pressure but unblock real chat.
  const MAX_ITER = chatToolsTrimmed ? 5 : ITERATION_CAP

  // Extend the route-supplied serviceCtx with managed-runtime-only context
  // the executor needs for the trimmed save_section_draft tool: which
  // section is currently focused (from the request) and the session's
  // current stateVersion (for CAS). Both fields are ignored by V3.
  const runtimeServiceCtx: ServiceContext = {
    ...serviceCtx,
    focusedSectionKey: opts.focusedSectionKey,
    expectedStateVersion: session.stateVersion,
  }

  const systemPrompt = buildManagedSystemPrompt(
    session,
    sections,
    session.currentPhase as Phase,
    session.locale,
    allowWrites,
    systemSummary,
  )
  // Apply prompt caching to the tool list. We clone once (not per-iteration)
  // and stamp `cache_control: ephemeral` on the LAST tool so the whole tool
  // block becomes one cacheable prefix. The SDK preserves extra properties.
  const baseTools = getManagedTools(allowWrites, chatToolsTrimmed)
  const tools = baseTools.map((t, i) =>
    i === baseTools.length - 1
      ? ({ ...t, cache_control: CACHE_CONTROL_EPHEMERAL } as typeof t & { cache_control: typeof CACHE_CONTROL_EPHEMERAL })
      : t,
  )

  // Same idea for the system prompt — wrap the string in a one-block array
  // with a cache breakpoint. Repeated turns in the same session will hit
  // the cache. When systemSummary or phase changes, Anthropic invalidates
  // the entry and we pay cache_write once, then reads again.
  const systemBlocks = [
    { type: 'text' as const, text: systemPrompt, cache_control: CACHE_CONTROL_EPHEMERAL },
  ]

  // 4. Tool loop
  const runningMessages: MessageParam[] = [...history]

  // Accumulate usage across all iterations of this turn (tool loops run
  // multiple streams). Cost is estimated from the final summed usage using
  // the model the runtime advertises — tctx.messageModel is the ground
  // truth, populated by translateAnthropicEvent when it sees message_start.
  let aggregateUsage: UsageLike = {}

  while (iterationCount < MAX_ITER) {
    iterationCount += 1

    // Bail if the consumer is gone or we are past the soft deadline. Emit a
    // graceful continuation message on deadline; silent break on plain abort.
    // Checked at the top of each iteration — a single stream can take 60s+,
    // pushing a long turn past the budget mid-loop.
    if (opts.deadlineAt != null && Date.now() >= opts.deadlineAt) {
      const msg = session.locale === 'ro'
        ? 'Am atins limita de timp pentru această tură. Scrie "continuă" și voi prelua de unde am rămas.'
        : 'I\'ve reached the time budget for this turn. Send "continue" and I\'ll pick up where I left off.'
      emit({ type: 'text_delta', content: msg })
      break
    }
    if (opts.signal?.aborted) {
      break
    }

    const stream = anthropic.messages.stream({
      model: MODEL,
      system: systemBlocks,
      tools,
      messages: runningMessages,
      max_tokens: MAX_TOKENS_PER_TURN,
    })

    const assistantBlocks: (TextBlock | ToolUseBlock)[] = []
    const toolBlocksToExecute: ToolUseBlock[] = []
    const inputJsonAccumulators = new Map<number, string>()
    let stopReason: string | null = null
    // Per-stream usage. `message_start.message.usage` seeds input/cache/output;
    // `message_delta.usage` is cumulative for the current message and replaces
    // prior fields (NOT additive — each delta carries the running total). We
    // fold this into aggregateUsage once, after the stream ends, so multi-
    // delta streams don't double-count the way an add-per-delta loop does.
    let currentStreamUsage: UsageLike = {}

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
      if (event.type === 'message_start') {
        // message_start.message.usage seeds input_tokens + cache_* for this
        // stream (output_tokens is typically 1 at this point). Capture it
        // before the delta stream begins updating output_tokens.
        const startUsage = (event as unknown as { message?: { usage?: UsageLike } }).message?.usage
        if (startUsage) {
          currentStreamUsage = { ...currentStreamUsage, ...startUsage }
        }
      }
      if (event.type === 'message_delta') {
        stopReason = event.delta?.stop_reason ?? stopReason
        // message_delta.usage is cumulative for the current message — each
        // delta carries the running total, not an increment. Merge (latest
        // wins per field) rather than add, otherwise multi-delta streams
        // inflate tokens and cost. addUsage across iterations still sums
        // final per-message totals across tool-loop iterations.
        const usage = (event as unknown as { usage?: UsageLike }).usage
        if (usage) {
          currentStreamUsage = { ...currentStreamUsage, ...usage }
        }
      }
    }
    // End of this stream iteration — fold the message's final usage into
    // the turn-level aggregate.
    aggregateUsage = addUsage(aggregateUsage, currentStreamUsage)

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

    // Execute tools sequentially in emitted order. Runtime-level
    // parallel-write cap (Desk Audit Fix 1): at most one write per
    // assistant message; subsequent writes get a synthetic
    // PARALLEL_WRITE_BLOCKED tool_result without being dispatched.
    const executionResults = await executeToolBlocksWithWriteCap(
      toolBlocksToExecute,
      runtimeServiceCtx,
      executeManagedTool,
    )
    const toolResultBlocks: ToolResultBlockParam[] = []
    for (const { block, result } of executionResults) {
      toolCount += 1

      if (!result.isError && WRITE_TOOL_NAMES.has(result.toolName)) {
        writesSucceeded = true
      }

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
  if (iterationCount >= MAX_ITER) {
    log.warn({
      sessionId: session.id,
      requestId: request.requestId,
      iterationCount,
    }, 'managed turn hit iteration cap')
    trackIterationCapHit('managed')
    const capMessage = session.locale === 'ro'
      ? '\n\n(Limita de iterații atinsă. Vă rog, clarificați întrebarea.)'
      : '\n\n(Reached tool iteration limit. Please clarify your request.)'
    emit({ type: 'text_delta', content: capMessage })
    // Persist the cap text so the next turn's loadManagedHistory replays
    // the bail-out signal. Best-effort: a failure here MUST NOT abort the
    // runtime — markTurnCompleted still has to run, and the user has
    // already seen the text via SSE. The next turn's history will simply
    // omit the cap text; the prior assistant + tool messages already
    // describe the conversation state. ensurePairingInvariant covers
    // orphan tool_use/tool_result blocks but not missing assistant text.
    if (firstOutputPersisted) {
      try {
        await appendManagedMessage(
          session.id,
          { role: 'assistant', messageType: 'text', content: capMessage, turnId },
          { runtimeMode: 'managed', provider: 'anthropic', model: tctx.messageModel },
        )
      } catch (err) {
        log.warn(
          {
            sessionId: session.id,
            turnId,
            requestId: request.requestId,
            error: err instanceof Error ? err.message : String(err),
          },
          'iteration-cap text persistence failed (non-fatal)',
        )
      }
    }
  }

  // Compute per-turn cost from the summed usage. Unknown model → 0 (safe).
  const modelUsed = tctx.messageModel ?? MODEL
  const costUsdMicros = computeAnthropicCostMicros(aggregateUsage, modelUsed)

  // Mark the turn complete only if at least one durable output landed.
  // A turn that hit the iteration cap without producing any output (or
  // one where the stream produced zero blocks) stays uncompleted so the
  // route's catch branch or the daily reconciliation cron can classify
  // it as an empty orphan.
  // Track silent-degradation conditions on the successful-turn path so the
  // done event and structured log can surface them. log.warn-and-continue
  // around infra mutations inside this critical section is an anti-pattern
  // (see feedback_managed_runtime_success_accounting.md): the turn's
  // durable output landed, but session state diverged from what the user
  // sees. Surface via telemetry, not a user-visible error.
  let degradedReason: string | null = null
  if (firstOutputPersisted) {
    await markTurnCompleted(turnId, {
      model: modelUsed,
      inputTokens: aggregateUsage.input_tokens ?? null,
      outputTokens: aggregateUsage.output_tokens ?? null,
      cacheReadInputTokens: aggregateUsage.cache_read_input_tokens ?? null,
      cacheCreationInputTokens: aggregateUsage.cache_creation_input_tokens ?? null,
      costUsdMicros,
    })

    try {
      await compactIfNeeded(session.id, session.currentPhase)
    } catch (err) {
      degradedReason = 'compaction_failed'
      log.warn(
        {
          sessionId: session.id,
          requestId: request.requestId,
          error: err instanceof Error ? err.message : String(err),
        },
        'managed compaction failed (non-fatal)',
      )
    }
  }

  // Post-write reload (PR1 Change B). Runs AFTER markTurnCompleted +
  // compactIfNeeded so that a turn with durable output is always recorded
  // as completed even if the reload itself fails.
  let snapshotSession = session
  let snapshotSections = sections
  if (writesSucceeded) {
    try {
      const reloaded = await reloadSessionAndSections(session.id, session.userId)
      if (!reloaded) throw new Error('session row missing after write')
      snapshotSession = reloaded.session
      snapshotSections = reloaded.sections
    } catch (err) {
      log.error(
        {
          sessionId: session.id,
          requestId: request.requestId,
          error: err instanceof Error ? err.message : String(err),
        },
        'managed post-write reload failed',
      )
      const message = session.locale === 'ro'
        ? 'Sesiunea s-a actualizat parțial. Reîncarcă pagina pentru a continua.'
        : 'Session partially updated. Reload to continue.'
      emit({ type: 'error', message, retryable: false })
      // Skip the done event. agent_turns.completedAt is already set by
      // markTurnCompleted above. The client's terminalErrorRef latch (Task 5)
      // prevents the post-stream setStatus('idle') from masking this.
      log.info({
        event: 'managed_turn_complete',
        sessionId: session.id,
        turnId,
        requestId: request.requestId,
        iterations: iterationCount,
        toolCount,
        durationMs: Date.now() - start,
        outcome: 'completed_reload_failed',
        degradedReason: null,
        model: modelUsed,
        usage: aggregateUsage,
        costUsdMicros,
      }, 'managed_turn_complete')
      return {
        toolCount,
        iterationCount,
        model: tctx.messageModel,
        latencyMs: Date.now() - start,
        firstOutputPersisted,
        reloadFailed: true,
      }
    }
  }

  const finalState = buildUISnapshot(snapshotSession, snapshotSections)
  emit({ type: 'done', finalState, degradedReason })

  // Structured turn-complete log — consumed by the reconciliation
  // queries and pilot dashboards (see docs/superpowers/runbooks/
  // managed-pilot-observability.md). degradedReason lets dashboards count
  // outcome=completed turns separately from compaction-degraded ones.
  log.info({
    event: 'managed_turn_complete',
    sessionId: session.id,
    turnId,
    requestId: request.requestId,
    iterations: iterationCount,
    toolCount,
    durationMs: Date.now() - start,
    outcome: firstOutputPersisted ? 'completed' : 'no_output',
    degradedReason,
    model: modelUsed,
    usage: aggregateUsage,
    costUsdMicros,
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
  return projectSessionState(session, sections)
}

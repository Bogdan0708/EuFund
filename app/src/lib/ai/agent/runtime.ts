// app/src/lib/ai/agent/runtime.ts
import type {
  AgentSession, AgentSection, AgentEvent, AgentRequest,
  StateTransition, ToolContext, ToolResult,
} from './types'
import { applyTransition } from './transitions'
import { buildSystemPrompt, buildSessionStateBlock } from './prompt'
import { checkPolicyGate } from './policies'
import { getToolsForPhase } from './tools/registry'
import './tools/index' // Side-effect: registers all tools
import { loadContext, appendMessage, compactIfNeeded } from './history'
import { markTurnCompleted } from './managed/history'
import { zodToJsonSchema } from './utils'
import { db } from '@/lib/db'
import { agentSessions, agentCheckpoints, agentSections } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { onSectionAccepted, onPhaseTransition } from '@/lib/ai/knowledge/write-back'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { logger } from '@/lib/logger'
import { captureException } from '@/lib/monitoring/sentry'
import { logAudit } from '@/lib/legal/audit'
import type { RouterMessage } from '@/lib/ai/providers/types'

const log = logger.child({ component: 'agent-runtime' })

/**
 * Thrown when V3 history replay detects a corrupt agent_messages row —
 * missing toolCallId on a tool row, malformed tool_call content, etc.
 *
 * Issue #83 item 4: callers wrap the replay loop and fire
 * `captureException` + `logAudit('agent.history.integrity_violation', ...)`
 * before re-throwing so observability picks up the integrity failure.
 */
export class HistoryIntegrityError extends Error {
  readonly meta: {
    sessionId: string
    toolCallId?: string
    reason: string
  }
  constructor(message: string, meta: { sessionId: string; toolCallId?: string; reason: string }) {
    super(message)
    this.name = 'HistoryIntegrityError'
    this.meta = meta
  }
}

interface WriteBackContext {
  action?: NonNullable<AgentRequest['action']>
  phaseTransition?: { from: string; to: string }
}

type EventEmitter = (event: AgentEvent) => void
type SessionWithKnowledgeSummary = AgentSession & { _knowledgeSummary?: string }

export interface RuntimeOptions {
  session: AgentSession
  sections: AgentSection[]
  request: AgentRequest
  emit: EventEmitter
  routingCtx?: import('../model-routing').ModelRoutingContext
  // Pre-stream turn-claim id. The route inserts the agent_turns row before
  // calling runAgentTurn and passes the id in. runAgentTurn calls
  // markTurnCompleted() immediately before each `done` emit so the
  // reconciliation cron can distinguish completed turns from abandoned ones.
  turnId: string
}

// V3 doesn't track per-turn token usage or cost the way managed does.
// Pass empty telemetry — completedAt is the only field markTurnCompleted
// flips to non-null, which is what the reconciliation cron checks.
const V3_EMPTY_TELEMETRY = {
  model: null,
  inputTokens: null,
  outputTokens: null,
  cacheReadInputTokens: null,
  cacheCreationInputTokens: null,
  costUsdMicros: null,
} as const

/**
 * Run one turn of the agent conversation loop.
 *
 * Flow:
 * 1. Load message history
 * 2. Build system prompt with current state
 * 3. Prepare tool definitions for current phase
 * 4. Call LLM with tools (streaming text + tool calls)
 * 5. Execute any tool calls, applying policy gates
 * 6. Apply state transitions from tool results
 * 7. Save checkpoints
 * 8. Persist updated state
 * 9. Emit done event
 */
export async function runAgentTurn(opts: RuntimeOptions): Promise<{
  session: AgentSession
  sections: AgentSection[]
}> {
  const { request, emit } = opts
  let { session, sections } = opts
  let phaseTransitionOccurred: { from: string; to: string } | undefined

  try {
    // 1. Load history
    const history = await loadContext(session.id)

    // 2. Append user message if present
    if (request.message) {
      await appendMessage(session.id, {
        role: 'user',
        messageType: 'text',
        content: request.message,
        turnId: opts.turnId,
      })
    } else if (request.action) {
      await appendMessage(session.id, {
        role: 'user',
        messageType: 'structured_action',
        content: request.action,
        turnId: opts.turnId,
      })
    }

    // 3. Handle structured actions directly
    if (request.action) {
      const actionResult = handleStructuredAction(request.action, session, sections)
      if (actionResult.transitions.length > 0) {
        // Track phase transitions from direct actions (e.g. approve_outline → drafting)
        for (const t of actionResult.transitions) {
          const prevPhase = session.currentPhase
          const result = applyTransition(session, sections, t)
          session = result.session
          sections = result.sections
          if (t.type === 'SET_PHASE' && t.phase !== prevPhase) {
            phaseTransitionOccurred = { from: prevPhase, to: t.phase }
          }
        }
        const writeBack = {
          action: request.action ?? undefined,
          ...(phaseTransitionOccurred ? { phaseTransition: phaseTransitionOccurred } : {}),
        }
        if (actionResult.skipLLM) {
          // Terminal path — bump version once and persist with write-back
          session = { ...session, stateVersion: session.stateVersion + 1, updatedAt: new Date() }
          await persistSessionState(session, sections, writeBack)
        } else {
          // Non-terminal — persist action state without version bump;
          // end-of-turn persist (line ~337) handles the single version increment
          await persistSessionState(session, sections, writeBack)
        }
      }
      if (actionResult.policyViolation) {
        emit({ type: 'policy_violation', gate: request.action.type, reason: actionResult.policyViolation })
      }
      if (actionResult.skipLLM) {
        await markTurnCompleted(opts.turnId, V3_EMPTY_TELEMETRY)
        emit({ type: 'state_update', patch: buildStatePatch(session, sections) })
        emit({ type: 'done', finalState: buildUISnapshot(session, sections) })
        return { session, sections }
      }
    }

    // 4. Build prompt and tool definitions
    // Inject session knowledge summary for prompt
    try {
      const { getSessionKnowledge } = await import('@/lib/ai/knowledge/session-knowledge')
      const pages = await getSessionKnowledge(session.id)
      if (pages.length > 0) {
        const kindCounts = new Map<string, number>()
        for (const p of pages) kindCounts.set(p.kind, (kindCounts.get(p.kind) ?? 0) + 1)
        ;(session as SessionWithKnowledgeSummary)._knowledgeSummary = `${pages.length} pages: ${[...kindCounts.entries()].map(([k, c]) => c > 1 ? `${k}(${c})` : k).join(', ')}`
      }
    } catch { /* non-critical */ }

    const systemPrompt = buildSystemPrompt(session, sections)
    const sessionStateBlock = buildSessionStateBlock(session, sections)
    const phaseTools = getToolsForPhase(session.currentPhase)

    // Build messages array for LLM. RouterMessage is a discriminated union
    // (Issue #83 item 6) — tool_call_id only on role='tool', tool_calls only
    // on role='assistant'. Local push call sites must satisfy the union shape.
    const llmMessages: RouterMessage[] = []

    // Volatile session state — delivered as a role:'system' message so the
    // Anthropic native adapter hoists it to an uncached additional system block
    // after the cached req.system prefix. See docs/superpowers/plans/2026-04-22-v3-rag-prompt-caching-pr2-v3-optin.md §D3.
    llmMessages.push({ role: 'system', content: sessionStateBlock })

    if (history.summary) {
      llmMessages.push({ role: 'system', content: `Previous conversation summary:\n${history.summary}` })
    }
    // Replay persisted history into router-shape messages.
    //
    // history.messages comes from loadContext() (see history.ts) and preserves
    // toolCallId/toolName for tool_call and tool_result rows. We MUST translate
    // those back into:
    //   - role='assistant' + tool_calls[] (for persisted tool_call rows)
    //   - role='tool' + tool_call_id (for persisted tool_result rows)
    // so the provider adapters can faithfully reconstruct the OpenAI/Anthropic
    // tool-use protocol on the 2nd+ turn.
    //
    // Dropping these fields was the bug fixed in `chore/v3-replay-fix`: the
    // previous loop only carried {role, content}, so providers received
    // tool_call_id='' and the upstream API rejected with
    //   "tool_call_id of '' not found"
    // — but only on a session that had previously executed a tool.
    //
    // Issue #82 fix: parallel tool_calls in a single LLM response are persisted
    // as N consecutive (tool_call, tool_result) row pairs. Each tool_call row
    // carries a groupId (embedded in content) shared by all calls from the same
    // LLM response. When replaying, we batch consecutive same-groupId tool_call
    // rows (interleaved with their tool_results) into ONE assistant message
    // with tool_calls[N], then emit the tool_results in order. Without this,
    // Anthropic native interprets the alternating singletons as N sequential
    // turns rather than one parallel turn — silent semantic shift.
    //
    // Legacy rows (pre-fix data, no groupId) fall through to per-row replay —
    // we cannot recover the lost grouping, so each tool_call becomes its own
    // assistant message, matching pre-#82 behavior.
    type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }

    // Issue #83 item 1: parseToolCallRow throws on any malformed shape rather
    // than silently falling back to msg.toolName / '{}'. A malformed tool_call
    // row represents a write-path bug or data corruption — replay must fail
    // loud so the wrapping observability catch (item 4) can fire Sentry +
    // audit before the error bubbles up.
    const parseToolCallRow = (
      msg: typeof history.messages[number],
    ): { toolCall: ToolCall; groupId: string | null } => {
      if (!msg.toolCallId) {
        throw new HistoryIntegrityError(
          `agent-runtime: tool_call history row missing toolCallId`,
          { sessionId: session.id, reason: 'missing_tool_call_id' },
        )
      }
      let parsed: { name?: unknown; arguments?: unknown; groupId?: unknown }
      try {
        parsed = JSON.parse(msg.content)
      } catch {
        throw new HistoryIntegrityError(
          `agent-runtime: tool_call history row has unparseable content`,
          { sessionId: session.id, toolCallId: msg.toolCallId, reason: 'unparseable_content' },
        )
      }
      if (typeof parsed.name !== 'string' || typeof parsed.arguments !== 'string') {
        throw new HistoryIntegrityError(
          `agent-runtime: tool_call history row malformed (name or arguments missing)`,
          { sessionId: session.id, toolCallId: msg.toolCallId, reason: 'malformed_content' },
        )
      }
      const groupId = typeof parsed.groupId === 'string' ? parsed.groupId : null
      return {
        toolCall: { id: msg.toolCallId, type: 'function', function: { name: parsed.name, arguments: parsed.arguments } },
        groupId,
      }
    }

    // Issue #83 item 5: messageType is authoritative. A row whose stored
    // messageType is 'text' must replay as plain text even if toolCallId
    // happens to be set (drift defense). Fall back to the role+toolCallId+
    // toolName inference only when messageType is missing — that path exists
    // for legacy tests and for forward compat with any caller that hasn't
    // routed through loadContext.
    const isToolCallRow = (msg: typeof history.messages[number]): boolean => {
      if (msg.messageType) return msg.messageType === 'tool_call'
      return msg.role === 'assistant' && !!msg.toolCallId && !!msg.toolName
    }
    const isToolResultRow = (msg: typeof history.messages[number]): boolean => {
      if (msg.messageType) return msg.messageType === 'tool_result'
      return msg.role === 'tool'
    }

    // Issue #83 item 4: wrap the entire replay in a try/catch so any
    // HistoryIntegrityError gets observability (Sentry + audit) before
    // bubbling up to the route handler. The throws live deep inside
    // parseToolCallRow and the tool-row branch, but the observability
    // belongs at this boundary so it fires once per integrity violation.
    try {
      let i = 0
      while (i < history.messages.length) {
        const msg = history.messages[i]

        if (isToolResultRow(msg)) {
          if (!msg.toolCallId) {
            throw new HistoryIntegrityError(
              `agent-runtime: tool history row missing toolCallId`,
              { sessionId: session.id, reason: 'missing_tool_call_id_on_result' },
            )
          }
          llmMessages.push({ role: 'tool', content: msg.content, tool_call_id: msg.toolCallId })
          i++
          continue
        }

        if (isToolCallRow(msg)) {
          const first = parseToolCallRow(msg)

          // Issue #82: batch consecutive same-groupId tool_call rows
          // (interleaved with their tool_results) into one assistant message.
          const toolCalls: ToolCall[] = [first.toolCall]
          const toolResults: { content: string; tool_call_id: string }[] = []
          const collectedIds = new Set<string>([first.toolCall.id])
          let j = i + 1

          if (first.groupId !== null) {
            while (j < history.messages.length) {
              const next = history.messages[j]
              if (isToolResultRow(next) && next.toolCallId && collectedIds.has(next.toolCallId)) {
                toolResults.push({ content: next.content, tool_call_id: next.toolCallId })
                j++
                continue
              }
              if (isToolCallRow(next)) {
                const candidate = parseToolCallRow(next)
                if (candidate.groupId === first.groupId) {
                  toolCalls.push(candidate.toolCall)
                  collectedIds.add(candidate.toolCall.id)
                  j++
                  continue
                }
              }
              break
            }
          }

          llmMessages.push({ role: 'assistant', content: '', tool_calls: toolCalls })
          for (const tr of toolResults) {
            llmMessages.push({ role: 'tool', content: tr.content, tool_call_id: tr.tool_call_id })
          }
          i = j
          continue
        }

        // Plain text message (user / assistant text / system).
        llmMessages.push({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
        })
        i++
      }
    } catch (err) {
      if (err instanceof HistoryIntegrityError) {
        // Fire-and-forget — observability must not block the throw nor change
        // the rejection semantics. Errors inside captureException/logAudit are
        // logged by the internals and absorbed.
        void captureException(err, {
          component: 'agent-runtime',
          ...err.meta,
        })
        void logAudit({
          userId: session.userId,
          action: 'agent.history.integrity_violation',
          resourceType: 'agent_session',
          resourceId: session.id,
          metadata: {
            reason: err.meta.reason,
            ...(err.meta.toolCallId ? { toolCallId: err.meta.toolCallId } : {}),
            // The error message itself is safe (no UUIDs in the string), but
            // the meta carries them in a structured field for queryability.
          },
        })
      }
      throw err
    }
    // Add current user message
    if (request.message) {
      llmMessages.push({ role: 'user', content: request.message })
    }

    // 5. Call LLM with tool loop (max iterations to prevent runaway)
    const { generate } = await import('@/lib/ai/providers/router')

    // V3 cache opt-in — resolved once per turn; constant across tool-loop iterations
    // within a single turn. Percentage-targeted on session.userId via targeting.percentage.
    // Global kill switch prompt_cache_enabled still gates at the router level (PR 1).
    // See docs/superpowers/plans/2026-04-22-v3-rag-prompt-caching-pr2-v3-optin.md §D4.
    const v3CacheEnabled = await isFeatureEnabled('v3_prompt_cache_enabled', {
      userId: session.userId,
    })

    const toolSchemas = phaseTools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.inputSchema),
      },
    }))

    const MAX_TOOL_ITERATIONS = 5
    let iteration = 0

    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++

      const response = await generate({
        provider: 'anthropic',
        model: 'claude-opus-4-6',
        system: systemPrompt,
        messages: llmMessages,
        tools: toolSchemas.length > 0 ? toolSchemas : undefined,
        // Omit cache entirely when the V3 flag resolves false — the router
        // skips the global-flag read on that path (router.ts:33-35).
        ...(v3CacheEnabled
          ? { cache: { enabled: true as const, breakpoints: ['system', 'tools'] as Array<'system' | 'tools'> } }
          : {}),
      })

      // Single assistant-message push per iteration, including tool_calls when present.
      // Task 21 consolidation: fixes the latent shim bug (old sites dropped tool_calls,
      // plus the text+tool_calls branch pushed twice) and enables native tool replay.
      const assistantMessage: {
        role: 'assistant'
        content: string
        tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
      } = {
        role: 'assistant',
        content: response.content ?? '',
        ...(response.toolCalls && response.toolCalls.length > 0
          ? {
              tool_calls: response.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: tc.arguments },
              })),
            }
          : {}),
      }
      llmMessages.push(assistantMessage)

      // If text response with no tool calls — we're done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        if (response.content) {
          emit({ type: 'text_delta', content: response.content })
          await appendMessage(session.id, {
            role: 'assistant',
            messageType: 'text',
            content: response.content,
            turnId: opts.turnId,
          })
        }
        break
      }

      // Otherwise emit any text and continue to tool processing.
      if (response.content) {
        emit({ type: 'text_delta', content: response.content })
      }

      // Handle tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        let hasToolCalls = false

        // Issue #82: stamp one groupId per LLM response so replay can batch
        // parallel tool_calls back into a single assistant message with
        // tool_calls[N], rather than alternating singletons. See replay loop
        // above for the read-side counterpart.
        const groupId = crypto.randomUUID()

        for (const toolCall of response.toolCalls) {
          const tool = phaseTools.find(t => t.name === toolCall.name)
          if (!tool) {
            log.warn({ tool: toolCall.name }, 'Unknown tool called by LLM')
            continue
          }

          // Policy gate
          const gate = checkPolicyGate(tool.name, session, sections)
          if (!gate.allowed) {
            emit({ type: 'policy_violation', gate: tool.name, reason: gate.reason || 'Policy gate blocked' })
            continue
          }

          // Execute tool
          emit({ type: 'tool_start', tool: tool.name, input: {} })

          let toolInput: unknown
          try {
            toolInput = JSON.parse(toolCall.arguments)
          } catch {
            toolInput = {}
          }

          const ctx: ToolContext = {
            sessionId: session.id,
            userId: session.userId,
            session,
            sections,
            stateVersion: session.stateVersion,
            requestId: request.requestId,
            locale: session.locale,
            routingCtx: opts.routingCtx,
          }

          let toolResult: ToolResult
          try {
            toolResult = await Promise.race([
              tool.execute(toolInput, ctx),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Tool timeout')), tool.timeout),
              ),
            ])
          } catch (error) {
            toolResult = {
              success: false,
              error: error instanceof Error ? error.message : 'Tool execution failed',
              retryable: true,
              telemetry: { latencyMs: 0 },
            }
          }

          hasToolCalls = true

          emit({
            type: 'tool_result',
            tool: tool.name,
            summary: toolResult.success ? 'completed' : (toolResult.error || 'failed'),
            success: toolResult.success,
          })

          // Record tool call and result in history. groupId in content lets
          // the replay loop batch parallel tool_calls (Issue #82).
          await appendMessage(session.id, {
            role: 'assistant',
            messageType: 'tool_call',
            content: { name: toolCall.name, arguments: toolCall.arguments, groupId },
            toolName: toolCall.name,
            toolCallId: toolCall.id,
            turnId: opts.turnId,
          })
          await appendMessage(session.id, {
            role: 'tool',
            messageType: 'tool_result',
            content: { success: toolResult.success, data: toolResult.data, error: toolResult.error },
            toolName: toolCall.name,
            toolCallId: toolCall.id,
            turnId: opts.turnId,
          })

          // Feed tool result back into conversation for next LLM iteration
          const toolResultContent = JSON.stringify({
            success: toolResult.success,
            data: toolResult.data,
            error: toolResult.error,
            warnings: toolResult.warnings,
          })
          llmMessages.push({ role: 'tool', content: toolResultContent, tool_call_id: toolCall.id })

          // Apply state transitions
          if (toolResult.stateTransitions) {
            for (const transition of toolResult.stateTransitions) {
              const prevPhase = session.currentPhase
              const result = applyTransition(session, sections, transition)
              session = result.session
              sections = result.sections

              // Emit phase change and record for write-back
              if (transition.type === 'SET_PHASE' && transition.phase !== prevPhase) {
                emit({ type: 'phase_changed', from: prevPhase, to: transition.phase })
                phaseTransitionOccurred = { from: prevPhase, to: transition.phase }
              }

              // Handle section upserts — create in-memory section if it doesn't exist
              if (result.sectionUpsert) {
                const existing = sections.find(sec => sec.sectionKey === result.sectionUpsert!.sectionKey)
                if (!existing) {
                  const spec = (session.outline || []).find((o: { id: string; title?: string; order?: number; generationOrder?: number }) => o.id === result.sectionUpsert!.sectionKey)
                  sections.push({
                    id: crypto.randomUUID(),
                    sessionId: session.id,
                    sectionKey: result.sectionUpsert.sectionKey,
                    title: spec?.title || result.sectionUpsert.sectionKey,
                    documentOrder: spec?.order ?? sections.length,
                    generationOrder: spec?.generationOrder ?? sections.length,
                    status: 'draft',
                    content: result.sectionUpsert.content,
                    acceptedContent: null,
                    modelUsed: result.sectionUpsert.model,
                    retryCount: 0,
                    sourcesUsed: result.sectionUpsert.sources,
                    promptVersion: null,
                    latencyMs: null,
                    tokenUsage: null,
                    errorClass: null,
                    rejectionReason: null,
                    updatedAt: new Date(),
                  })
                }
                emit({ type: 'section_status', sectionKey: result.sectionUpsert.sectionKey, status: 'draft' })
              }
            }
          }

          // Save checkpoint
          if (toolResult.checkpoint) {
            await db.insert(agentCheckpoints).values({
              sessionId: session.id,
              checkpointType: toolResult.checkpoint.type,
              payload: toolResult.checkpoint.payload,
            })
            emit({
              type: 'checkpoint',
              checkpointType: toolResult.checkpoint.type,
              summary: `${toolResult.checkpoint.type} recorded`,
            })
          }
        }

        if (!hasToolCalls) break
        // Continue loop — next iteration calls LLM with tool results
      } else {
        break
      }
    }

    // 8. Update state version and persist
    session = { ...session, stateVersion: session.stateVersion + 1, updatedAt: new Date() }
    await persistSessionState(session, sections, {
      ...(phaseTransitionOccurred ? { phaseTransition: phaseTransitionOccurred } : {}),
    })

    // 9. Compact history if needed
    await compactIfNeeded(session.id, session.currentPhase)

    // 10. Emit done
    await markTurnCompleted(opts.turnId, V3_EMPTY_TELEMETRY)
    emit({ type: 'state_update', patch: buildStatePatch(session, sections) })
    emit({ type: 'done', finalState: buildUISnapshot(session, sections) })

    return { session, sections }
  } catch (error) {
    // Issue #83 item 2: do NOT emit a 'error' SSE event here. The route's
    // outer catch (api/ai/agent/route.ts) owns the SSE error envelope, so
    // emitting from the runtime produced TWO error events for one failure.
    // Logging stays here — observability is logical, not stream-level.
    log.error(
      { sessionId: session.id, error: error instanceof Error ? error.message : String(error) },
      'Agent turn failed',
    )
    throw error
  }
}

export function handleStructuredAction(
  action: NonNullable<AgentRequest['action']>,
  session: AgentSession,
  sections: AgentSection[],
): { transitions: StateTransition[]; skipLLM: boolean; policyViolation?: string } {
  switch (action.type) {
    case 'select_call': {
      if (session.status !== 'active') {
        return { transitions: [], skipLLM: true, policyViolation: `POLICY_SESSION_NOT_ACTIVE: session status is '${session.status}'; call selection requires active session` }
      }
      if (session.outlineFrozen) {
        return { transitions: [], skipLLM: true, policyViolation: 'POLICY_OUTLINE_ALREADY_FROZEN: cannot reselect call once outline is frozen' }
      }
      return { transitions: [{ type: 'SET_SELECTED_CALL', callId: action.callId }], skipLLM: false }
    }
    case 'approve_outline': {
      if (session.status !== 'active') {
        return { transitions: [], skipLLM: true, policyViolation: `POLICY_SESSION_NOT_ACTIVE: session status is '${session.status}'; outline approval requires active session` }
      }
      if (!session.selectedCallId) {
        return { transitions: [], skipLLM: true, policyViolation: 'POLICY_NO_CALL_SELECTED: cannot approve outline before a funding call has been selected' }
      }
      if (session.eligibility == null || session.eligibility.failCount > 0) {
        const failCount = session.eligibility?.failCount ?? 'unknown'
        return { transitions: [], skipLLM: true, policyViolation: `POLICY_ELIGIBILITY_NOT_PASSED: eligibility check must pass with zero failures before outline approval (failCount: ${failCount})` }
      }
      if (session.outlineFrozen) {
        return { transitions: [], skipLLM: true, policyViolation: 'POLICY_OUTLINE_ALREADY_FROZEN: outline has already been approved and frozen' }
      }
      return { transitions: [{ type: 'FREEZE_OUTLINE' }, { type: 'SET_PHASE', phase: 'drafting' }], skipLLM: false }
    }
    case 'accept_section': {
      if (!session.outlineFrozen) {
        return { transitions: [], skipLLM: true, policyViolation: 'Cannot accept sections before outline is approved' }
      }
      const section = sections.find(s => s.sectionKey === action.sectionKey)
      if (!section || section.status !== 'needs_review') {
        const hint = section?.status === 'draft' ? ' — run validate_section first' : ''
        return { transitions: [], skipLLM: true, policyViolation: `Section "${action.sectionKey}" must pass validation before acceptance (status: ${section?.status || 'not found'})${hint}` }
      }
      return { transitions: [{ type: 'ACCEPT_SECTION', sectionKey: action.sectionKey }], skipLLM: true }
    }
    case 'regenerate_section': {
      if (!session.outlineFrozen) {
        return { transitions: [], skipLLM: true, policyViolation: 'POLICY_OUTLINE_NOT_FROZEN: cannot regenerate sections before outline is frozen' }
      }
      const section = sections.find(s => s.sectionKey === action.sectionKey)
      if (!section) {
        return { transitions: [], skipLLM: true, policyViolation: `Section "${action.sectionKey}" not found` }
      }
      const ALLOWED_REGEN_STATES = ['draft', 'needs_review', 'accepted'] as const
      if (!ALLOWED_REGEN_STATES.includes(section.status as (typeof ALLOWED_REGEN_STATES)[number])) {
        return { transitions: [], skipLLM: true, policyViolation: `POLICY_SECTION_WRONG_STATE: section "${action.sectionKey}" has status '${section.status}'; regenerate allowed only from draft/needs_review/accepted` }
      }
      return { transitions: [{ type: 'MARK_SECTION_STALE', sectionKey: action.sectionKey }], skipLLM: false }
    }
    case 'reject_section': {
      if (!session.outlineFrozen) {
        return { transitions: [], skipLLM: true, policyViolation: 'POLICY_OUTLINE_NOT_FROZEN: cannot reject sections before outline is frozen' }
      }
      const section = sections.find(s => s.sectionKey === action.sectionKey)
      if (!section) {
        return { transitions: [], skipLLM: true, policyViolation: `Section "${action.sectionKey}" not found` }
      }
      const ALLOWED_REJECT_STATES = ['draft', 'needs_review', 'rejected'] as const
      if (!ALLOWED_REJECT_STATES.includes(section.status as (typeof ALLOWED_REJECT_STATES)[number])) {
        return { transitions: [], skipLLM: true, policyViolation: `POLICY_SECTION_WRONG_STATE: section "${action.sectionKey}" has status '${section.status}'; reject allowed only from draft/needs_review/rejected` }
      }
      return { transitions: [{ type: 'REJECT_SECTION', sectionKey: action.sectionKey, reason: action.reason }], skipLLM: true }
    }
    case 'request_refresh':
      return { transitions: [], skipLLM: false }
    case 'mark_complete': {
      const gate = checkPolicyGate('validate_application', session, sections)
      if (!gate.allowed) {
        return {
          transitions: [{ type: 'ADD_WARNING', warning: { code: 'COMPLETION_BLOCKED', message: gate.reason || 'Cannot complete', severity: 'blocker' } }],
          skipLLM: true,
          policyViolation: gate.reason,
        }
      }
      return { transitions: [{ type: 'SET_STATUS', status: 'completed' }], skipLLM: true }
    }
    default:
      return { transitions: [], skipLLM: false }
  }
}

async function persistSessionState(session: AgentSession, sections: AgentSection[], writeBackContext?: WriteBackContext): Promise<void> {
  // Persist session
  await db.update(agentSessions).set({
    status: session.status,
    selectedCallId: session.selectedCallId,
    currentPhase: session.currentPhase,
    blueprint: session.blueprint as unknown as Record<string, unknown>,
    eligibility: session.eligibility as unknown as Record<string, unknown>,
    outline: session.outline as unknown as Record<string, unknown>[],
    warnings: session.warnings as unknown as Record<string, unknown>[],
    planningArtifact: session.planningArtifact as unknown as Record<string, unknown>,
    outlineFrozen: session.outlineFrozen,
    messageSummary: session.messageSummary,
    stateVersion: session.stateVersion,
    updatedAt: new Date(),
  }).where(eq(agentSessions.id, session.id))

  // Persist sections — upsert each section by (sessionId, sectionKey)
  for (const section of sections) {
    await db.insert(agentSections).values({
      id: section.id,
      sessionId: section.sessionId,
      sectionKey: section.sectionKey,
      title: section.title,
      documentOrder: section.documentOrder,
      generationOrder: section.generationOrder,
      status: section.status,
      content: section.content,
      acceptedContent: section.acceptedContent,
      modelUsed: section.modelUsed,
      retryCount: section.retryCount,
      sourcesUsed: section.sourcesUsed as unknown as Record<string, unknown>,
      promptVersion: section.promptVersion,
      latencyMs: section.latencyMs,
      tokenUsage: section.tokenUsage as unknown as Record<string, unknown>,
      errorClass: section.errorClass,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [agentSections.sessionId, agentSections.sectionKey],
      set: {
        status: section.status,
        content: section.content,
        acceptedContent: section.acceptedContent,
        modelUsed: section.modelUsed,
        retryCount: section.retryCount,
        sourcesUsed: section.sourcesUsed as unknown as Record<string, unknown>,
        latencyMs: section.latencyMs,
        tokenUsage: section.tokenUsage as unknown as Record<string, unknown>,
        errorClass: section.errorClass,
        updatedAt: new Date(),
      },
    })
  }

  // ── Knowledge write-back (idempotent, all inside persist path) ──

  // 1. Section accept write-back
  if (writeBackContext?.action?.type === 'accept_section') {
    const sectionKey = writeBackContext.action.sectionKey
    const section = sections.find(s => s.sectionKey === sectionKey)
    if (section?.acceptedContent) {
      const bp = session.blueprint as Record<string, unknown> | null
      try {
        await onSectionAccepted({
          sessionId: session.id,
          sectionKey,
          title: section.title,
          content: section.acceptedContent,
          program: (bp?.program as string) ?? 'unknown',
          callId: session.selectedCallId,
          retryCount: section.retryCount,
          modelUsed: section.modelUsed ?? 'unknown',
          sectionId: section.id,
          sourcesUsed: (section.sourcesUsed as string[]) ?? [],
        })
      } catch (err) {
        log.warn({ sectionKey, error: err instanceof Error ? err.message : String(err) }, 'Knowledge write-back failed — section still accepted')
      }

      // Track pattern usage — sourcesUsed contains pattern IDs from generate_section
      const patternIds = ((section.sourcesUsed as string[]) ?? []).filter(
        s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)
      )
      if (patternIds.length > 0) {
        try {
          const { trackPatternUsage } = await import('@/lib/ai/knowledge/write-back')
          await trackPatternUsage(patternIds, {
            accepted: true,
            regenCount: section.retryCount,
          })
        } catch { /* logged inside trackPatternUsage */ }
      }
    }
  }

  // 1b. Track pattern rejection on regenerate/reject (accepted=false)
  if (writeBackContext?.action?.type === 'regenerate_section' || writeBackContext?.action?.type === 'reject_section') {
    const sectionKey = writeBackContext.action.sectionKey
    const section = sections.find(s => s.sectionKey === sectionKey)
    if (section) {
      const patternIds = ((section.sourcesUsed as string[]) ?? []).filter(
        s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)
      )
      if (patternIds.length > 0) {
        try {
          const { trackPatternUsage } = await import('@/lib/ai/knowledge/write-back')
          await trackPatternUsage(patternIds, {
            accepted: false,
            regenCount: section.retryCount,
          })
        } catch { /* logged inside trackPatternUsage */ }
      }
    }
  }

  // 2. Phase transition write-back
  if (writeBackContext?.phaseTransition) {
    const { from, to } = writeBackContext.phaseTransition
    try {
      await onPhaseTransition({
        sessionId: session.id,
        fromPhase: from,
        toPhase: to,
        messageSummary: session.messageSummary,
        planningArtifact: session.planningArtifact,
      })
    } catch (err) {
      log.warn({ error: err instanceof Error ? err.message : String(err) }, 'Phase transition write-back failed')
    }
  }
}

function buildStatePatch(session: AgentSession, sections: AgentSection[]): Partial<import('./types').UIStateSnapshot> {
  return {
    phase: session.currentPhase,
    stateVersion: session.stateVersion,
    outlineFrozen: session.outlineFrozen,
    warnings: session.warnings,
    sections: sections.map(s => ({
      sectionKey: s.sectionKey,
      title: s.title,
      status: s.status,
      documentOrder: s.documentOrder,
      content: s.acceptedContent ?? s.content,
    })),
  }
}

function buildUISnapshot(session: AgentSession, sections: AgentSection[]): import('./types').UIStateSnapshot {
  return {
    sessionId: session.id,
    phase: session.currentPhase,
    stateVersion: session.stateVersion,
    outlineFrozen: session.outlineFrozen,
    warnings: session.warnings,
    sections: sections.map(s => ({
      sectionKey: s.sectionKey,
      title: s.title,
      status: s.status,
      documentOrder: s.documentOrder,
      content: s.acceptedContent ?? s.content,
    })),
    blueprint: session.blueprint,
    eligibility: session.eligibility,
  }
}

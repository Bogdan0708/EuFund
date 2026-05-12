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
import { ensureProjectForSession } from '@/lib/projects/promotion'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'agent-runtime' })

interface WriteBackContext {
  action?: NonNullable<AgentRequest['action']>
  phaseTransition?: { from: string; to: string }
  // Set when any SET_SELECTED_CALL transition fired this turn. Triggers
  // ensureProjectForSession in persistSessionState — mirrors what managed's
  // setSelectedCall service does, so V3 sessions surface in /proiecte the
  // moment the user (or model) commits to a funding call.
  selectedCallChanged?: boolean
  // Forwarded for ServiceContext construction inside persistSessionState.
  requestId?: string
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
  let selectedCallChanged = false
  // Tracks whether ANY assistant text message was appended for this turn.
  // The tool loop can finish without producing user-facing text (model spends
  // all MAX_TOOL_ITERATIONS on tool calls). When that happens, the cap path
  // below forces a final synthesis call so the user sees a response rather
  // than a silent SSE close. Flip this true at every appendMessage of an
  // assistant text message.
  let assistantTextPersistedThisTurn = false

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
        // Track phase transitions from direct actions (e.g. approve_outline → drafting).
        // Compare against the post-apply phase so the backwards-rejection guard in
        // applyTransition doesn't surface a spurious phase change to write-back.
        for (const t of actionResult.transitions) {
          const prevPhase = session.currentPhase
          const result = applyTransition(session, sections, t)
          session = result.session
          sections = result.sections
          if (t.type === 'SET_PHASE' && session.currentPhase !== prevPhase) {
            phaseTransitionOccurred = { from: prevPhase, to: session.currentPhase }
          }
          if (t.type === 'SET_SELECTED_CALL') {
            selectedCallChanged = true
          }
        }
        const writeBack = {
          action: request.action ?? undefined,
          ...(phaseTransitionOccurred ? { phaseTransition: phaseTransitionOccurred } : {}),
          ...(selectedCallChanged ? { selectedCallChanged: true, requestId: request.requestId } : {}),
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
        // Reset write-back flags so the end-of-turn persist doesn't run
        // ensureProjectForSession / onPhaseTransition a second time.
        selectedCallChanged = false
        phaseTransitionOccurred = undefined
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

    // Build messages array for LLM
    const llmMessages: {
      role: 'user' | 'assistant' | 'system' | 'tool'
      content: string
      tool_call_id?: string
      tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
    }[] = []

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
    for (const msg of history.messages) {
      if (msg.role === 'tool') {
        if (!msg.toolCallId) {
          // Corrupt persisted row — fail loud rather than send '' upstream.
          throw new Error(
            `agent-runtime: tool history row missing toolCallId (sessionId=${session.id})`,
          )
        }
        llmMessages.push({ role: 'tool', content: msg.content, tool_call_id: msg.toolCallId })
        continue
      }

      if (msg.role === 'assistant' && msg.toolCallId && msg.toolName) {
        // Persisted tool_call row — content is JSON-stringified {name, arguments}.
        let parsed: { name?: unknown; arguments?: unknown }
        try {
          parsed = JSON.parse(msg.content) as { name?: unknown; arguments?: unknown }
        } catch {
          throw new Error(
            `agent-runtime: tool_call history row has unparseable content (sessionId=${session.id}, toolCallId=${msg.toolCallId})`,
          )
        }
        const name = typeof parsed.name === 'string' ? parsed.name : msg.toolName
        const args = typeof parsed.arguments === 'string' ? parsed.arguments : '{}'
        llmMessages.push({
          role: 'assistant',
          content: '',
          tool_calls: [{ id: msg.toolCallId, type: 'function', function: { name, arguments: args } }],
        })
        continue
      }

      // Plain text message (user / assistant text / system).
      llmMessages.push({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      })
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
          assistantTextPersistedThisTurn = true
        }
        break
      }

      // Otherwise emit any text AND persist it before processing tools.
      // Pre-fix this branch only emitted text via SSE; the agent_messages
      // row was never written, so a refresh during a tool turn lost the
      // model's narration (audit found this alongside the cap-hit bug).
      if (response.content) {
        emit({ type: 'text_delta', content: response.content })
        await appendMessage(session.id, {
          role: 'assistant',
          messageType: 'text',
          content: response.content,
          turnId: opts.turnId,
        })
        assistantTextPersistedThisTurn = true
      }

      // Handle tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        let hasToolCalls = false

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

          // Record tool call and result in history
          await appendMessage(session.id, {
            role: 'assistant',
            messageType: 'tool_call',
            content: { name: toolCall.name, arguments: toolCall.arguments },
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

              // Emit phase change and record for write-back. Use the post-apply
              // session.currentPhase, not the requested transition.phase — the
              // monotonic guard in applyTransition rejects backwards moves silently,
              // and we must not emit a phase_changed event for a rejected transition.
              if (transition.type === 'SET_PHASE' && session.currentPhase !== prevPhase) {
                emit({ type: 'phase_changed', from: prevPhase, to: session.currentPhase })
                phaseTransitionOccurred = { from: prevPhase, to: session.currentPhase }
              }
              if (transition.type === 'SET_SELECTED_CALL') {
                selectedCallChanged = true
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

    // 7.5. No-text path — forced synthesis when the loop exits without ever
    // persisting assistant text. Two ways to land here:
    //   (a) cap path: iteration >= MAX_TOOL_ITERATIONS (original 51c5f33b fix)
    //   (b) early exit: model returned tool_calls + no text, the tools all got
    //       blocked / unknown (hasToolCalls=false → break at line ~503), OR
    //       model returned no tool_calls and empty content (break at ~327).
    // Without this, the SSE stream returns `done` carrying zero chat content
    // and the UI looks like it crashed (2026-05-12 09:35 prod incident, plus
    // the 2026-05-12 user report: "doar a facut tool call dar nici un raspuns").
    // Make one more LLM call WITHOUT tools so the model is forced into text
    // output, using the accumulated llmMessages so it has all the tool results
    // it just collected. If that call fails or returns empty, fall back to a
    // localized message so the user always sees SOMETHING.
    if (!assistantTextPersistedThisTurn) {
      const capHit = iteration >= MAX_TOOL_ITERATIONS
      log.info(
        { sessionId: session.id, iteration, capHit, requestId: request.requestId },
        'V3 turn exited with no assistant text — forcing synthesis call',
      )
      const synthesisLanguage = session.locale === 'ro' ? 'Romanian' : 'English'
      const capNote = capHit
        ? `You used all ${MAX_TOOL_ITERATIONS} tool-call iterations without responding to the user.`
        : 'You stopped before responding to the user.'
      const synthesisSystem = `${systemPrompt}

## Response Required
${capNote} Summarize what you found so far in ${synthesisLanguage}. If the user's request was ambiguous, ask one specific clarifying question instead. Do NOT request more tool calls — they are no longer available.`

      try {
        const finalResponse = await generate({
          provider: 'anthropic',
          model: 'claude-opus-4-6',
          system: synthesisSystem,
          messages: llmMessages,
          // Omit tools entirely — the router doesn't expose tool_choice
          // (see types.ts), but no `tools` array means the model has no
          // tool surface at all and must emit text.
          ...(v3CacheEnabled
            ? { cache: { enabled: true as const, breakpoints: ['system'] as Array<'system' | 'tools'> } }
            : {}),
        })
        const finalText = finalResponse.content?.trim()
        if (finalText) {
          emit({ type: 'text_delta', content: finalText })
          await appendMessage(session.id, {
            role: 'assistant',
            messageType: 'text',
            content: finalText,
            turnId: opts.turnId,
          })
          assistantTextPersistedThisTurn = true
        }
      } catch (err) {
        log.warn(
          { sessionId: session.id, error: err instanceof Error ? err.message : String(err) },
          'V3 forced synthesis call failed',
        )
      }

      if (!assistantTextPersistedThisTurn) {
        const fallback = capHit
          ? (session.locale === 'ro'
            ? 'Am atins limita pașilor de explorare pentru această tură fără să găsesc un răspuns concludent. Te rog reformulează cererea sau cere-mi să sintetizez ce am găsit.'
            : 'I reached the tool-call limit for this turn without arriving at a conclusive answer. Please rephrase your request or ask me to summarize what I found.')
          : (session.locale === 'ro'
            ? 'Nu am putut formula un răspuns pentru această tură. Te rog reformulează cererea.'
            : "I couldn't generate a response for this turn. Please rephrase your request.")
        emit({ type: 'text_delta', content: fallback })
        await appendMessage(session.id, {
          role: 'assistant',
          messageType: 'text',
          content: fallback,
          turnId: opts.turnId,
        })
        assistantTextPersistedThisTurn = true
      }
    }

    // 8. Update state version and persist
    session = { ...session, stateVersion: session.stateVersion + 1, updatedAt: new Date() }
    await persistSessionState(session, sections, {
      ...(phaseTransitionOccurred ? { phaseTransition: phaseTransitionOccurred } : {}),
      ...(selectedCallChanged ? { selectedCallChanged: true, requestId: request.requestId } : {}),
    })

    // 9. Compact history if needed
    await compactIfNeeded(session.id, session.currentPhase)

    // 10. Emit done
    await markTurnCompleted(opts.turnId, V3_EMPTY_TELEMETRY)
    emit({ type: 'state_update', patch: buildStatePatch(session, sections) })
    emit({ type: 'done', finalState: buildUISnapshot(session, sections) })

    return { session, sections }
  } catch (error) {
    log.error(
      { sessionId: session.id, error: error instanceof Error ? error.message : String(error) },
      'Agent turn failed',
    )
    emit({ type: 'error', message: error instanceof Error ? error.message : 'Agent error', retryable: true })
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
      if (session.eligibility == null) {
        // Eligibility has never been run for this session — the model skipped
        // run_eligibility during research/structuring. Surface a clear message
        // instead of `failCount: unknown` so the user knows what to ask for.
        const msg = session.locale === 'ro'
          ? 'POLICY_ELIGIBILITY_NOT_CHECKED: verificarea de eligibilitate nu a fost încă efectuată pentru această sesiune. Cere asistentului să ruleze verificarea de eligibilitate înainte de aprobarea structurii.'
          : "POLICY_ELIGIBILITY_NOT_CHECKED: eligibility hasn't been verified for this session yet. Ask the assistant to run an eligibility check before approving the outline."
        return { transitions: [], skipLLM: true, policyViolation: msg }
      }
      if (session.eligibility.failCount > 0) {
        const failCount = session.eligibility.failCount
        const msg = session.locale === 'ro'
          ? `POLICY_ELIGIBILITY_NOT_PASSED: verificarea de eligibilitate are ${failCount} eșec(uri) critic(e). Rezolvă-le înainte de aprobarea structurii.`
          : `POLICY_ELIGIBILITY_NOT_PASSED: eligibility check has ${failCount} hard failure(s). Address them before approving the outline.`
        return { transitions: [], skipLLM: true, policyViolation: msg }
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

  // 3. Project promotion — mirrors managed's setSelectedCall path. Whenever a
  // V3 session commits to a funding call (via resolve_call or the select_call
  // structured action), promote it to a project so /panou and /proiecte have
  // a record to surface. Idempotent, fails safe.
  if (writeBackContext?.selectedCallChanged && writeBackContext?.requestId) {
    try {
      await ensureProjectForSession(
        {
          userId: session.userId,
          sessionId: session.id,
          requestId: writeBackContext.requestId,
          now: new Date(),
        },
        session.id,
      )
    } catch (err) {
      log.warn(
        { sessionId: session.id, error: err instanceof Error ? err.message : String(err) },
        'V3 project promotion failed',
      )
    }
  }
}

// SET_OUTLINE writes session.outline but does NOT persist agent_sections rows
// — those only exist once a section is drafted. Without this fallback, a
// session that just entered `structuring` has session.outline populated but
// `sections` is empty, so AgentWorkspace can't render OutlineView (its guard
// is sections.length > 0). User sees nothing, can't approve, dead-ends.
//
// We synthesize a section snapshot from the outline spec when no real rows
// exist yet. Status = 'pending' (the SECTION_STATUSES value that means
// "specified but not yet generated"). Once generate_section runs, real rows
// take over via the regular sections.map path.
function projectSectionsForUI(
  session: AgentSession,
  sections: AgentSection[],
): { sectionKey: string; title: string; status: import('./types').SectionStatus; documentOrder: number; content: string | null }[] {
  if (sections.length > 0) {
    return sections.map(s => ({
      sectionKey: s.sectionKey,
      title: s.title,
      status: s.status,
      documentOrder: s.documentOrder,
      content: s.acceptedContent ?? s.content,
    }))
  }
  const outline = session.outline ?? []
  if (outline.length === 0) return []
  return outline.map((spec, i) => ({
    sectionKey: spec.id,
    title: spec.title,
    status: 'pending' as const,
    documentOrder: typeof spec.order === 'number' ? spec.order : i + 1,
    content: null,
  }))
}

function buildStatePatch(session: AgentSession, sections: AgentSection[]): Partial<import('./types').UIStateSnapshot> {
  return {
    phase: session.currentPhase,
    stateVersion: session.stateVersion,
    outlineFrozen: session.outlineFrozen,
    warnings: session.warnings,
    sections: projectSectionsForUI(session, sections),
  }
}

function buildUISnapshot(session: AgentSession, sections: AgentSection[]): import('./types').UIStateSnapshot {
  return {
    sessionId: session.id,
    phase: session.currentPhase,
    stateVersion: session.stateVersion,
    outlineFrozen: session.outlineFrozen,
    warnings: session.warnings,
    sections: projectSectionsForUI(session, sections),
    blueprint: session.blueprint,
    eligibility: session.eligibility,
  }
}

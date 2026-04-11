// app/src/lib/ai/agent/runtime.ts
import type {
  AgentSession, AgentSection, AgentEvent, AgentRequest,
  StateTransition, ToolContext, ToolResult,
} from './types'
import { applyTransition } from './transitions'
import { buildSystemPrompt } from './prompt'
import { checkPolicyGate } from './policies'
import { getToolsForPhase } from './tools/registry'
import './tools/index' // Side-effect: registers all tools
import { loadContext, appendMessage, compactIfNeeded } from './history'
import { zodToJsonSchema } from './utils'
import { db } from '@/lib/db'
import { agentSessions, agentCheckpoints, agentSections } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { onSectionAccepted, onPhaseTransition } from '@/lib/ai/knowledge/write-back'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'agent-runtime' })

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
}

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
      })
    } else if (request.action) {
      await appendMessage(session.id, {
        role: 'user',
        messageType: 'structured_action',
        content: request.action,
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
    const phaseTools = getToolsForPhase(session.currentPhase)

    // Build messages array for LLM
    const llmMessages: { role: 'user' | 'assistant' | 'system' | 'tool'; content: string; tool_call_id?: string }[] = []
    if (history.summary) {
      llmMessages.push({ role: 'system', content: `Previous conversation summary:\n${history.summary}` })
    }
    for (const msg of history.messages) {
      llmMessages.push({ role: msg.role as 'user' | 'assistant' | 'system', content: msg.content })
    }
    // Add current user message
    if (request.message) {
      llmMessages.push({ role: 'user', content: request.message })
    }

    // 5. Call LLM with tool loop (max iterations to prevent runaway)
    const { generate } = await import('@/lib/ai/providers/router')

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
      })

      // If text response with no tool calls — we're done
      if (response.content && (!response.toolCalls || response.toolCalls.length === 0)) {
        emit({ type: 'text_delta', content: response.content })
        await appendMessage(session.id, {
          role: 'assistant',
          messageType: 'text',
          content: response.content,
        })
        llmMessages.push({ role: 'assistant', content: response.content })
        break
      }

      // If text + tool calls, emit text first
      if (response.content) {
        emit({ type: 'text_delta', content: response.content })
        llmMessages.push({ role: 'assistant', content: response.content })
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
          })
          await appendMessage(session.id, {
            role: 'tool',
            messageType: 'tool_result',
            content: { success: toolResult.success, data: toolResult.data, error: toolResult.error },
            toolName: toolCall.name,
            toolCallId: toolCall.id,
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
    warnings: session.warnings,
    sections: sections.map(s => ({
      sectionKey: s.sectionKey,
      title: s.title,
      status: s.status,
      documentOrder: s.documentOrder,
    })),
  }
}

function buildUISnapshot(session: AgentSession, sections: AgentSection[]): import('./types').UIStateSnapshot {
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

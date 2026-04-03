// app/src/lib/ai/agent/runtime.ts
import type {
  AgentSession, AgentSection, AgentEvent, AgentRequest,
  StateTransition, ToolContext, ToolResult,
} from './types'
import { applyTransition } from './transitions'
import { buildSystemPrompt } from './prompt'
import { checkPolicyGate } from './policies'
import { getToolsForPhase } from './tools/registry'
import { loadContext, appendMessage, compactIfNeeded } from './history'
import { db } from '@/lib/db'
import { agentSessions, agentCheckpoints } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'agent-runtime' })

type EventEmitter = (event: AgentEvent) => void

export interface RuntimeOptions {
  session: AgentSession
  sections: AgentSection[]
  request: AgentRequest
  emit: EventEmitter
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
        for (const t of actionResult.transitions) {
          const result = applyTransition(session, sections, t)
          session = result.session
          sections = result.sections
        }
        await persistSessionState(session, sections)
      }
      if (actionResult.skipLLM) {
        emit({ type: 'state_update', patch: buildStatePatch(session, sections) })
        emit({ type: 'done', finalState: buildUISnapshot(session, sections) })
        return { session, sections }
      }
    }

    // 4. Build prompt and tool definitions
    const systemPrompt = buildSystemPrompt(session, sections)
    const phaseTools = getToolsForPhase(session.currentPhase)

    // Build messages array for LLM
    const llmMessages: { role: 'user' | 'assistant' | 'system'; content: string }[] = []
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

    // 5. Call LLM (tool execution inline)
    const { generate } = await import('@/lib/ai/providers/router')

    const toolSchemas = phaseTools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {}, // Simplified — real implementation would convert Zod to JSON Schema
      },
    }))

    const response = await generate({
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      system: systemPrompt,
      messages: llmMessages,
      tools: toolSchemas.length > 0 ? toolSchemas : undefined,
    })

    // 6. Emit text response
    if (response.content) {
      emit({ type: 'text_delta', content: response.content })
      await appendMessage(session.id, {
        role: 'assistant',
        messageType: 'text',
        content: response.content,
      })
    }

    // 7. Handle tool calls
    if (response.toolCalls && response.toolCalls.length > 0) {
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

        emit({
          type: 'tool_result',
          tool: tool.name,
          summary: toolResult.success ? 'completed' : (toolResult.error || 'failed'),
          success: toolResult.success,
        })

        // Record tool call and result
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

        // Apply state transitions
        if (toolResult.stateTransitions) {
          for (const transition of toolResult.stateTransitions) {
            const prevPhase = session.currentPhase
            const result = applyTransition(session, sections, transition)
            session = result.session
            sections = result.sections

            // Emit phase change
            if (transition.type === 'SET_PHASE' && transition.phase !== prevPhase) {
              emit({ type: 'phase_changed', from: prevPhase, to: transition.phase })
            }

            // Handle section upserts
            if (result.sectionUpsert) {
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
    }

    // 8. Update state version and persist
    session = { ...session, stateVersion: session.stateVersion + 1, updatedAt: new Date() }
    await persistSessionState(session, sections)

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

function handleStructuredAction(
  action: NonNullable<AgentRequest['action']>,
  session: AgentSession,
  _sections: AgentSection[],
): { transitions: StateTransition[]; skipLLM: boolean } {
  switch (action.type) {
    case 'select_call':
      return { transitions: [{ type: 'SET_SELECTED_CALL', callId: action.callId }], skipLLM: false }
    case 'approve_outline':
      return { transitions: [{ type: 'FREEZE_OUTLINE' }, { type: 'SET_PHASE', phase: 'drafting' }], skipLLM: false }
    case 'accept_section':
      return { transitions: [{ type: 'ACCEPT_SECTION', sectionKey: action.sectionKey }], skipLLM: true }
    case 'regenerate_section':
      return { transitions: [{ type: 'MARK_SECTION_STALE', sectionKey: action.sectionKey }], skipLLM: false }
    case 'reject_section':
      return { transitions: [{ type: 'REJECT_SECTION', sectionKey: action.sectionKey, reason: action.reason }], skipLLM: true }
    case 'request_refresh':
      return { transitions: [], skipLLM: false }
    case 'mark_complete':
      return { transitions: [{ type: 'SET_STATUS', status: 'completed' }], skipLLM: true }
    default:
      return { transitions: [], skipLLM: false }
  }
}

async function persistSessionState(session: AgentSession, _sections: AgentSection[]): Promise<void> {
  await db.update(agentSessions).set({
    status: session.status,
    selectedCallId: session.selectedCallId,
    currentPhase: session.currentPhase,
    blueprint: session.blueprint as unknown as Record<string, unknown>,
    eligibility: session.eligibility as unknown as Record<string, unknown>,
    outline: session.outline as unknown as Record<string, unknown>[],
    warnings: session.warnings as unknown as Record<string, unknown>[],
    planningArtifact: session.planningArtifact as unknown as Record<string, unknown>,
    messageSummary: session.messageSummary,
    stateVersion: session.stateVersion,
    updatedAt: new Date(),
  }).where(eq(agentSessions.id, session.id))
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

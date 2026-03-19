import { db } from '@/lib/db'
import { workflowSessions, workflowMessages, projects, projectDocuments, orgMembers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { WorkflowContext, AgentFn, SSEStream, GatewayClient } from './types'
import { STEP_LABELS } from './types'

// Agent imports
import { enhanceAgent } from './agents/enhance'
import { matchAgent } from './agents/match'
import { validateAgent } from './agents/validate'
import { researchAgent } from './agents/research'
import { knowledgeAgent } from './agents/knowledge'
import { planAgent } from './agents/plan'
import { buildAgent } from './agents/build'
import { editAgent } from './agents/edit'

const AGENTS: Record<number, AgentFn> = {
  1: enhanceAgent,
  2: matchAgent,
  3: validateAgent,
  4: researchAgent,
  5: knowledgeAgent,
  6: planAgent,
  7: buildAgent,
}

export function getAgentForStep(step: number): AgentFn {
  const agent = AGENTS[step]
  if (!agent) throw new Error(`Invalid step: ${step}. Must be 1-7.`)
  return agent
}

export async function createSession(
  userId: string,
  locale: 'ro' | 'en',
  tier: string
): Promise<{ id: string; context: WorkflowContext }> {
  const context: WorkflowContext = {
    sessionId: '',
    userId,
    locale,
    tier,
    step: 1,
    enhancedIdea: null,
    matchedCalls: null,
    validationResults: null,
    researchResults: null,
    actionPlan: null,
    projectSections: null,
    uploadedFiles: [],
  }

  const [session] = await db
    .insert(workflowSessions)
    .values({
      userId,
      currentStep: 1,
      context: context as unknown as Record<string, unknown>,
      status: 'active',
    })
    .returning()

  context.sessionId = session.id
  return { id: session.id, context }
}

export async function loadSession(sessionId: string): Promise<WorkflowContext | null> {
  const [session] = await db
    .select()
    .from(workflowSessions)
    .where(eq(workflowSessions.id, sessionId))
    .limit(1)

  if (!session) return null

  const ctx = session.context as unknown as WorkflowContext
  ctx.sessionId = session.id
  ctx.step = session.currentStep
  return ctx
}

export async function processMessage(
  sessionId: string,
  input: string,
  stream: SSEStream,
  gateway: GatewayClient
): Promise<void> {
  const ctx = await loadSession(sessionId)
  if (!ctx) {
    stream.send({ type: 'error', step: 0, message: 'Session not found', retryable: false })
    return
  }

  // Check session status to route to edit agent for completed sessions
  const [sessionRow] = await db.select({ status: workflowSessions.status })
    .from(workflowSessions).where(eq(workflowSessions.id, sessionId)).limit(1)

  const isCompleted = sessionRow?.status === 'completed'

  // Store user message
  await db.insert(workflowMessages).values({
    sessionId,
    role: 'user',
    content: input,
    step: ctx.step,
  })

  const agent = isCompleted ? editAgent : getAgentForStep(ctx.step)
  const label = isCompleted ? 'Editing your project...' : (STEP_LABELS[ctx.step] || `Step ${ctx.step}...`)

  stream.send({ type: 'step_start', step: ctx.step, label })

  try {
    const result = await agent(ctx, input, stream, gateway)

    const updatedContext = { ...ctx, ...result.data }

    // Store assistant message
    await db.insert(workflowMessages).values({
      sessionId,
      role: 'assistant',
      content: JSON.stringify(result.data),
      step: ctx.step,
      eventType: result.checkpoint ? 'checkpoint' : 'step_complete',
      metadata: result.checkpoint ? result.checkpoint as unknown as Record<string, unknown> : null,
    })

    if (isCompleted) {
      // Post-completion edit: update context only, don't advance step or change status
      await db
        .update(workflowSessions)
        .set({
          context: updatedContext as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(workflowSessions.id, sessionId))

      stream.send({
        type: 'step_complete',
        step: ctx.step,
        summary: 'Edit applied',
      })
    } else if (result.checkpoint) {
      stream.send({ type: 'checkpoint', step: ctx.step, data: result.checkpoint })

      await db
        .update(workflowSessions)
        .set({
          context: updatedContext as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(workflowSessions.id, sessionId))
    } else {
      const nextStep = ctx.step + 1
      const isComplete = nextStep > 7

      stream.send({
        type: 'step_complete',
        step: ctx.step,
        summary: `Step ${ctx.step} complete`,
      })

      await db
        .update(workflowSessions)
        .set({
          currentStep: isComplete ? 7 : nextStep,
          context: updatedContext as unknown as Record<string, unknown>,
          status: isComplete ? 'completed' : 'active',
          updatedAt: new Date(),
        })
        .where(eq(workflowSessions.id, sessionId))

      if (isComplete) {
        // Persist project from completed workflow
        const sections = (updatedContext as unknown as { projectSections?: unknown }).projectSections
        if (sections) {
          const title = (updatedContext as unknown as { enhancedIdea?: { refinedDescription?: string } }).enhancedIdea?.refinedDescription || 'Untitled Project'

          // Resolve user's org for the required orgId field
          const [membership] = await db
            .select({ orgId: orgMembers.orgId })
            .from(orgMembers)
            .where(eq(orgMembers.userId, ctx.userId))
            .limit(1)

          if (membership) {
            const [project] = await db.insert(projects).values({
              orgId: membership.orgId,
              userId: ctx.userId,
              createdBy: ctx.userId,
              title: title.slice(0, 200),
              status: 'ciorna',
              currentVersion: 1,
            }).returning()

            // Create project_documents version with sections
            await db.insert(projectDocuments).values({
              projectId: project.id,
              version: 1,
              sections: sections as Record<string, unknown>[],
            })

            // Link session to project
            await db.update(workflowSessions)
              .set({ projectId: project.id })
              .where(eq(workflowSessions.id, sessionId))

            stream.send({ type: 'done', projectId: project.id })
          } else {
            stream.send({ type: 'done' })
          }
        } else {
          stream.send({ type: 'done' })
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    stream.send({ type: 'error', step: ctx.step, message, retryable: true })

    await db.insert(workflowMessages).values({
      sessionId,
      role: 'system',
      content: `Error: ${message}`,
      step: ctx.step,
      eventType: 'error',
    })
  }
}

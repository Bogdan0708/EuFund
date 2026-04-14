import { db } from '@/lib/db'
import { workflowSessions, workflowMessages, projects, projectDocuments, projectFiles, organizations, orgMembers } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import type { WorkflowContext, AgentFn, SSEStream, GatewayClient, ProjectCompletionStatus, SectionResult, CallBlueprint } from './types'
import { STEP_LABELS } from './types'
import { logger } from '@/lib/logger'
import { runPostBuildQA } from './qa'
import { buildSectionSpecs } from './section-specs'
import { persistSectionChanges } from './section-versions'

const log = logger.child({ component: 'orchestrator-engine' })

// Agent imports
import { enhanceAgent } from './agents/enhance'
import { matchAgent } from './agents/match'
import { researchAgent } from './agents/research'
import { planAgent } from './agents/plan'
import { buildAgent } from './agents/build'
import { editAgent } from './agents/edit'

const AGENTS: Record<number, AgentFn> = {
  1: enhanceAgent,
  2: matchAgent,
  3: researchAgent,
  4: planAgent,
  5: buildAgent,
}

export function getAgentForStep(step: number): AgentFn {
  const agent = AGENTS[step]
  if (!agent) throw new Error(`Invalid step: ${step}. Must be 1-5.`)
  return agent
}

export async function createSession(
  userId: string,
  locale: 'ro' | 'en',
  tier: string,
  responseStyle?: 'concise' | 'detailed' | 'technical',
): Promise<{ id: string; context: WorkflowContext }> {
  const context: WorkflowContext = {
    sessionId: '',
    userId,
    locale,
    tier,
    step: 1,
    enhancedIdea: null,
    matchedCalls: null,
    selectedCallId: null,
    callBlueprint: null,
    actionPlan: null,
    projectSections: null,
    uploadedFiles: [],
    responseStyle,
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

/**
 * Live preferences that can override persisted session context on each
 * message. This is how settings changes take effect mid-session without
 * requiring a new session.
 */
export interface LiveAIPrefs {
  responseStyle?: 'concise' | 'detailed' | 'technical'
  /**
   * When true, confirm-type checkpoints are advertised to the client with
   * `autoApprove: true` so the client auto-sends 'continue' after a brief
   * delay. Read per-message so settings changes take effect on the next
   * message, consistent with responseStyle behavior.
   */
  autoApprove?: boolean
  /** Pre-loaded model routing context for centralized model selection. */
  routingCtx?: import('../model-routing').ModelRoutingContext
}

export async function processMessage(
  sessionId: string,
  input: string,
  stream: SSEStream,
  gateway: GatewayClient,
  isAutoAdvance = false,
  livePrefs?: LiveAIPrefs,
): Promise<void> {
  log.info({ sessionId }, 'processMessage start')

  let ctx: WorkflowContext | null = null
  try {
    ctx = await loadSession(sessionId)
  } catch (loadErr) {
    log.error({ error: loadErr instanceof Error ? loadErr.message : String(loadErr), sessionId }, 'Failed to load session')
    stream.send({ type: 'error', step: 0, message: 'Failed to load session', retryable: true })
    return
  }

  if (!ctx) {
    stream.send({ type: 'error', step: 0, message: 'Session not found', retryable: false })
    return
  }

  // Apply live preference overrides — settings changes take effect immediately
  // on the next message, not just at session creation time.
  if (livePrefs?.responseStyle) {
    ctx.responseStyle = livePrefs.responseStyle
  }
  if (livePrefs?.routingCtx) {
    ctx.routingCtx = livePrefs.routingCtx
  }

  // Check session status to route to edit agent for completed sessions
  const [sessionRow] = await db.select({ status: workflowSessions.status })
    .from(workflowSessions).where(eq(workflowSessions.id, sessionId)).limit(1)

  const isCompleted = sessionRow?.status === 'completed'

  // Check if the last assistant message was a checkpoint — if so, this is a
  // checkpoint response: advance to the next step instead of re-running current agent
  const [lastAssistantMsg] = await db.select({
    eventType: workflowMessages.eventType,
    step: workflowMessages.step,
  })
    .from(workflowMessages)
    .where(and(
      eq(workflowMessages.sessionId, sessionId),
      eq(workflowMessages.role, 'assistant'),
      eq(workflowMessages.step, ctx.step),
    ))
    .orderBy(desc(workflowMessages.createdAt))
    .limit(1)

  if (!isCompleted && lastAssistantMsg?.eventType === 'checkpoint' && lastAssistantMsg.step === ctx.step) {
    // Persist user's checkpoint selection into context
    if (ctx.step === 2 && input) {
      ctx.selectedCallId = input
    }
    ctx.step = ctx.step + 1
    await db.update(workflowSessions).set({
      currentStep: ctx.step,
      context: ctx as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    }).where(eq(workflowSessions.id, sessionId))
  }

  // Store user message (skip on auto-advance to avoid duplicates)
  if (!isAutoAdvance) {
    await db.insert(workflowMessages).values({
      sessionId,
      role: 'user',
      content: input,
      step: ctx.step,
    })
  }

  const agent = isCompleted ? editAgent : getAgentForStep(ctx.step)
  const label = isCompleted ? 'Editing your project...' : (STEP_LABELS[ctx.step] || `Step ${ctx.step}...`)

  stream.send({ type: 'step_start', step: ctx.step, label })
  log.info({ sessionId, step: ctx.step, agent: isCompleted ? 'edit' : `step-${ctx.step}` }, 'Starting agent')

  try {
    const result = await agent(ctx, input, stream, gateway)

    let updatedContext = { ...ctx, ...result.data } as typeof ctx

    // Phase 1: persist version changes if the agent produced sections (flag-gated)
    if (result.data.projectSections) {
      const { isFeatureEnabled } = await import('@/lib/feature-flags')
      const versioningEnabled = await isFeatureEnabled('section_versioning', {
        userId: ctx.userId,
        tier: ctx.tier,
      })

      if (versioningEnabled) {
        const enrichedSections = await persistSectionChanges({
          sessionId,
          userId: ctx.userId,
          previousSections: ctx.projectSections,
          newSections: result.data.projectSections as SectionResult[],
          reason: isCompleted ? input : 'initial_generation',
        })
        updatedContext = { ...updatedContext, projectSections: enrichedSections }
      }
    }

    const persistedResultData = result.data.projectSections
      ? { ...result.data, projectSections: updatedContext.projectSections }
      : result.data

    // Store assistant message
    await db.insert(workflowMessages).values({
      sessionId,
      role: 'assistant',
      content: JSON.stringify(persistedResultData),
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
        context: {
          matchedCalls: updatedContext.matchedCalls,
          actionPlan: updatedContext.actionPlan,
          projectSections: updatedContext.projectSections,
        },
      })
    } else if (result.checkpoint) {
      stream.send({
        type: 'checkpoint',
        step: ctx.step,
        data: result.checkpoint,
        context: {
          matchedCalls: updatedContext.matchedCalls,
          actionPlan: updatedContext.actionPlan,
          projectSections: updatedContext.projectSections,
        },
        // Advertise the user's current auto-approve preference to the client
        // only for confirm-type checkpoints. Select/freetext checkpoints always
        // require explicit input. Read from livePrefs so settings changes take
        // effect on the next message (consistent with responseStyle).
        autoApprove: result.checkpoint.type === 'confirm' && livePrefs?.autoApprove === true,
      })

      await db
        .update(workflowSessions)
        .set({
          context: updatedContext as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(workflowSessions.id, sessionId))
    } else {
      const nextStep = ctx.step + 1
      const isComplete = nextStep > 5

      stream.send({
        type: 'step_complete',
        step: ctx.step,
        summary: `Step ${ctx.step} complete`,
        context: {
          matchedCalls: updatedContext.matchedCalls,
          actionPlan: updatedContext.actionPlan,
          projectSections: updatedContext.projectSections,
        },
      })

      await db
        .update(workflowSessions)
        .set({
          currentStep: isComplete ? 5 : nextStep,
          context: updatedContext as unknown as Record<string, unknown>,
          status: isComplete ? 'completed' : 'active',
          updatedAt: new Date(),
        })
        .where(eq(workflowSessions.id, sessionId))

      // Auto-advance to next step if no checkpoint and not complete
      if (!isComplete) {
        return processMessage(sessionId, input, stream, gateway, true, livePrefs)
      }

      if (isComplete) {
        await handleWorkflowCompletion(sessionId, updatedContext, stream, gateway)
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    log.error({ error: message, stack: error instanceof Error ? error.stack : undefined, sessionId, step: ctx.step }, 'Agent execution failed')
    stream.send({ type: 'error', step: ctx.step, message, retryable: true })

    await db.insert(workflowMessages).values({
      sessionId,
      role: 'system',
      content: `Error: ${message}`,
      step: ctx.step,
      eventType: 'error',
    }).catch((dbErr) => {
      log.error({ error: dbErr instanceof Error ? dbErr.message : String(dbErr) }, 'Failed to store error message')
    })
  }
}

/**
 * Handle workflow completion: create project, run QA, generate DOCXs, store files.
 * Extracted from processMessage() to keep the message loop focused on routing.
 */
async function handleWorkflowCompletion(
  sessionId: string,
  ctx: WorkflowContext,
  stream: SSEStream,
  gateway: GatewayClient,
): Promise<void> {
  const sections = ctx.projectSections as SectionResult[] | null
  if (!sections) {
    stream.send({ type: 'done' })
    return
  }

  const title = (ctx as unknown as { enhancedIdea?: { refinedDescription?: string } }).enhancedIdea?.refinedDescription || 'Untitled Project'

  // Run post-build QA
  const blueprint = (ctx.callBlueprint as CallBlueprint | null) || {
    normalized: { requiredSections: [], mandatoryAnnexes: [], eligibilityCriteria: [], evaluationGrid: [], cofinancingRate: 0 },
  } as unknown as CallBlueprint
  const specs = buildSectionSpecs(blueprint)
  const qaResult = runPostBuildQA(sections, specs)

  // Determine completion status
  let completionStatus: ProjectCompletionStatus = 'complete'
  if (!qaResult.passed || sections.some(s => s.source === 'failed')) {
    completionStatus = qaResult.missingSections.length > 0 ? 'needs_review' : 'complete_with_gaps'
  }
  if ((ctx.callBlueprint as CallBlueprint | null)?.structureConfidence !== undefined &&
      (ctx.callBlueprint as CallBlueprint).structureConfidence < 0.4) {
    completionStatus = 'needs_review'
  }

  // Resolve user's org
  const [membership] = await db
    .select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(eq(orgMembers.userId, ctx.userId))
    .limit(1)

  if (!membership) {
    stream.send({ type: 'done' })
    return
  }

  const [project] = await db.insert(projects).values({
    orgId: membership.orgId,
    userId: ctx.userId,
    createdBy: ctx.userId,
    title: title.slice(0, 200),
    status: 'ciorna',
    completionStatus,
    currentVersion: 1,
  }).returning()

  await db.insert(projectDocuments).values({
    projectId: project.id,
    version: 1,
    sections: sections as unknown as Record<string, unknown>[],
    metadata: { qaResult } as unknown as Record<string, unknown>,
  })

  // Phase 2: Save section DOCXs + generate submission dossier
  try {
    const { generateFormDocx, buildFormStoragePath } = await import('@/lib/export/section-docx')
    const { putObject } = await import('@/lib/storage/gcs')
    const { generateSubmissionDocuments } = await import('@/lib/ai/orchestrator/agents/documents')

    const [org] = await db.select({ name: organizations.name, cui: organizations.cui, address: organizations.address })
      .from(organizations).where(eq(organizations.id, membership.orgId)).limit(1)

    const annexes = (ctx.callBlueprint as CallBlueprint | null)?.normalized?.mandatoryAnnexes ?? []
    const program = (ctx.callBlueprint as CallBlueprint | null)?.program ?? ''

    const submissionDocs = await generateSubmissionDocuments({
      mandatoryAnnexes: annexes,
      projectContext: {
        orgName: org?.name ?? '',
        cui: org?.cui ?? '',
        orgAddress: typeof org?.address === 'object' && org?.address ? JSON.stringify(org.address) : '',
        representativeName: '[___]',
        representativeRole: '[___]',
        projectTitle: title.slice(0, 200),
        programName: program,
        date: new Date().toISOString().split('T')[0],
      },
      gateway,
    })

    for (const doc of submissionDocs) {
      if (doc.availability === 'external_required' || !doc.content) continue
      const buffer = generateFormDocx({ title: doc.title, content: doc.content })
      const storagePath = buildFormStoragePath(project.id, doc.scope, doc.title)
      const savedPath = await putObject(storagePath, buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      await db.insert(projectFiles).values({
        projectId: project.id,
        userId: ctx.userId,
        filename: storagePath.split('/').pop()!,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: buffer.length,
        storagePath: savedPath,
        category: 'generated',
        description: doc.title,
      })
    }

    await db.update(projectDocuments)
      .set({ metadata: { qaResult, submissionDocuments: submissionDocs } as unknown as Record<string, unknown> })
      .where(eq(projectDocuments.projectId, project.id))
  } catch (docErr) {
    log.error({ error: docErr instanceof Error ? docErr.message : String(docErr) }, 'Phase 2 document generation failed — project saved without dossier')
  }

  // Link session to project
  await db.update(workflowSessions)
    .set({ projectId: project.id })
    .where(eq(workflowSessions.id, sessionId))

  stream.send({ type: 'done', projectId: project.id, completionStatus })
}

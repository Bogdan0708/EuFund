// ── Managed runtime tool executor ───────────────────────────────
// In-process dispatcher: maps tool_use blocks to Phase 1 service
// calls. Allowlist via MANAGED_TOOL_NAMES. Phase 4 write tools
// (create_export_snapshot, save_call_blueprint) remain blocked with a
// targeted rejection message. All ServiceError subclasses mapped to
// isError tool results with safe content strings.

import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/messages'
import { MANAGED_TOOL_NAMES, PHASE_4_BLOCKED_TOOL_NAMES, WRITE_TOOL_NAMES } from './tools'
import type { ServiceContext } from '../services/types'
import {
  ServiceError,
  NotFoundError,
  AuthorizationError,
  ValidationError,
  ConcurrencyError,
  ExternalDependencyError,
} from '../services/errors'
import * as evidence from '../services/evidence'
import * as blueprint from '../services/blueprint'
import * as application from '../services/application'
import * as sections from '../services/sections'
import * as projects from '../services/projects'
import * as documents from '../services/documents'
import * as eligibility from '../services/eligibility'

// Zod schemas from Phase 1 handlers
import { inputSchema as searchCallsSchema } from '../mcp/read/search-calls'
import { inputSchema as getCallBlueprintSchema } from '../mcp/read/get-call-blueprint'
import { inputSchema as retrieveEvidenceSchema } from '../mcp/read/retrieve-evidence'
import { inputSchema as getApplicationStateSchema } from '../mcp/read/get-application-state'
import { inputSchema as listSectionsSchema } from '../mcp/read/list-sections'
import { inputSchema as getSectionSchema } from '../mcp/read/get-section'
import { inputSchema as getValidationReportSchema } from '../mcp/read/get-validation-report'
import { inputSchema as getProjectSummarySchema } from '../mcp/read/get-project-summary'
import { inputSchema as listUploadedDocumentsSchema } from '../mcp/read/list-uploaded-documents'
import { inputSchema as getDocumentContentSchema } from '../mcp/read/get-document-content'
import { inputSchema as runEligibilitySchema } from '../mcp/rules/run-eligibility'
import { inputSchema as scoreFitSchema } from '../mcp/rules/score-fit'
import { inputSchema as validateSectionSchema } from '../mcp/rules/validate-section'
import { inputSchema as validateApplicationSchema } from '../mcp/rules/validate-application'
import { inputSchema as checkMissingAnnexesSchema } from '../mcp/rules/check-missing-annexes'
// Phase 3b write schemas
import { inputSchema as saveSectionDraftSchema } from '../mcp/write/save-section-draft'
import { inputSchema as approveRevisionSchema } from '../mcp/write/approve-revision'
import { inputSchema as rollbackSectionSchema } from '../mcp/write/rollback-section'
import { inputSchema as setApplicationStatusSchema } from '../mcp/write/set-application-status'
import { inputSchema as setSelectedCallSchema } from '../mcp/write/set-selected-call'
import { inputSchema as freezeOutlineSchema } from '../mcp/write/freeze-outline'
import { inputSchema as markSectionStaleSchema } from '../mcp/write/mark-section-stale'
import { inputSchema as rejectSectionSchema } from '../mcp/write/reject-section'

import { logger } from '@/lib/logger'

const log = logger.child({ component: 'managed-executor' })

const MAX_CONTENT_BYTES = 16_000
const TOOL_TIMEOUT_MS = 15_000

export interface ExecutorResult {
  content: string
  isError: boolean
  toolName: string
  latencyMs: number
  truncated?: boolean
}

export async function executeManagedTool(
  block: ToolUseBlock,
  ctx: ServiceContext,
): Promise<ExecutorResult> {
  const start = Date.now()
  const { name, input } = block

  // ── 1. Allowlist check ──────────────────────────────────────────────────
  if (!MANAGED_TOOL_NAMES.has(name)) {
    if (PHASE_4_BLOCKED_TOOL_NAMES.has(name)) {
      return errorResult(
        name,
        start,
        'This tool is not available in the managed runtime yet (Phase 4 scope). Please continue in the standard workflow.',
      )
    }
    return errorResult(name, start, `Unknown tool: ${name}`)
  }

  // ── 1b. Write rollout gate ──────────────────────────────────────────────
  // Write tools fire BEFORE dispatch — no service call happens on the
  // blocked path. ctx.allowWrites is the single rollout control.
  if (WRITE_TOOL_NAMES.has(name) && ctx.allowWrites !== true) {
    return errorResult(
      name,
      start,
      'Managed write tools are disabled for your account. Reads and evaluations are still available. This is a rollout gate, not a permanent restriction.',
    )
  }

  // ── 2. Dispatch with timeout ────────────────────────────────────────────
  try {
    const result = await Promise.race([
      dispatchTool(name, input, ctx),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('tool_timeout')), TOOL_TIMEOUT_MS),
      ),
    ])

    let content = JSON.stringify(result)
    let truncated = false
    if (content.length > MAX_CONTENT_BYTES) {
      content = JSON.stringify(truncateResult(name, result))
      truncated = true
    }

    log.info(
      {
        tool: name,
        latencyMs: Date.now() - start,
        isError: false,
        truncated,
        requestId: ctx.requestId,
      },
      'managed tool executed',
    )

    if (WRITE_TOOL_NAMES.has(name)) {
      log.info(
        {
          tool: name,
          userId: ctx.userId,
          sessionId: ctx.sessionId,
          requestId: ctx.requestId,
          isError: false,
          latencyMs: Date.now() - start,
        },
        'managed write tool executed',
      )
    }

    return {
      content,
      isError: false,
      toolName: name,
      latencyMs: Date.now() - start,
      truncated,
    }
  } catch (err) {
    const result = mapErrorToResult(err, name, start, ctx)
    if (WRITE_TOOL_NAMES.has(name)) {
      log.info(
        {
          tool: name,
          userId: ctx.userId,
          sessionId: ctx.sessionId,
          requestId: ctx.requestId,
          isError: true,
          latencyMs: result.latencyMs,
        },
        'managed write tool executed',
      )
    }
    return result
  }
}

function mapErrorToResult(
  err: unknown,
  name: string,
  start: number,
  ctx: ServiceContext,
): ExecutorResult {
  if (err instanceof Error && err.message === 'tool_timeout') {
    return errorResult(name, start, 'Tool timed out after 15s')
  }
  if (err instanceof NotFoundError) {
    return errorResult(name, start, `NOT_FOUND: ${err.message}`)
  }
  if (err instanceof AuthorizationError) {
    return errorResult(name, start, 'AUTHORIZATION: Access denied to requested session')
  }
  if (err instanceof ValidationError) {
    const code = err.policyCode ?? `VALIDATION:${err.field}`
    return errorResult(name, start, `${code}: ${err.message}`)
  }
  if (err instanceof ConcurrencyError) {
    return errorResult(name, start, `CONCURRENCY: ${err.message}`)
  }
  if (err instanceof ExternalDependencyError) {
    return errorResult(name, start, `EXTERNAL_DEPENDENCY: ${err.service} unavailable`)
  }
  if (err instanceof ServiceError) {
    return errorResult(name, start, `${err.code}: ${err.message}`)
  }
  log.error(
    {
      tool: name,
      error: err instanceof Error ? err.message : String(err),
      requestId: ctx.requestId,
    },
    'unexpected managed tool error',
  )
  return errorResult(name, start, 'Internal tool error')
}

function errorResult(
  name: string,
  start: number,
  msg: string,
): ExecutorResult {
  return {
    content: msg,
    isError: true,
    toolName: name,
    latencyMs: Date.now() - start,
  }
}

/**
 * Structural truncation of oversized tool results. Returns a
 * reduced-size payload with truncated=true signal.
 */
function truncateResult(toolName: string, result: unknown): unknown {
  const base = {
    truncated: true,
    tool: toolName,
    originalSizeBytes: JSON.stringify(result).length,
    omitted: `Result exceeded ${MAX_CONTENT_BYTES} bytes. Top-ranked items only were included.`,
  }

  if (
    toolName === 'retrieve_evidence' &&
    typeof result === 'object' &&
    result !== null &&
    'chunks' in result
  ) {
    const r = result as { chunks: unknown[] }
    return { ...base, summary: { chunks: r.chunks.slice(0, 5) } }
  }
  if (
    toolName === 'search_calls' &&
    typeof result === 'object' &&
    result !== null &&
    'matches' in result
  ) {
    const r = result as { matches: unknown[] }
    return { ...base, summary: { matches: r.matches.slice(0, 5) } }
  }
  if (toolName === 'list_uploaded_documents' && Array.isArray(result)) {
    return {
      ...base,
      summary: result.slice(0, 10),
      remainderCount: result.length - 10,
    }
  }
  if (
    toolName === 'validate_application' &&
    typeof result === 'object' &&
    result !== null &&
    'issues' in result
  ) {
    const r = result as { issues: unknown[]; summary?: unknown }
    return {
      ...base,
      summary: { summary: r.summary, issues: r.issues.slice(0, 10) },
    }
  }

  // Fallback: safe string truncation of the stringified result
  const stringified = JSON.stringify(result)
  return {
    ...base,
    fallbackPreview: stringified.slice(0, 8_000),
  }
}

async function dispatchTool(
  name: string,
  rawInput: unknown,
  ctx: ServiceContext,
): Promise<unknown> {
  switch (name) {
    case 'search_calls': {
      const i = searchCallsSchema.parse(rawInput)
      return evidence.searchCalls(ctx, i.query, {
        program: i.program,
        maxResults: i.maxResults,
      })
    }
    case 'get_call_blueprint': {
      const i = getCallBlueprintSchema.parse(rawInput)
      return blueprint.lookupBlueprint(ctx, i.callId)
    }
    case 'retrieve_evidence': {
      const i = retrieveEvidenceSchema.parse(rawInput)
      // retrieveEvidence takes callId first, query as optional opt
      return evidence.retrieveEvidence(ctx, i.callId, {
        query: i.query,
        maxChunks: i.maxChunks,
      })
    }
    case 'get_application_state': {
      const i = getApplicationStateSchema.parse(rawInput)
      return application.getApplicationState(ctx, i.sessionId)
    }
    case 'list_sections': {
      const i = listSectionsSchema.parse(rawInput)
      return sections.listSections(ctx, i.sessionId)
    }
    case 'get_section': {
      const i = getSectionSchema.parse(rawInput)
      return sections.getSection(ctx, i.sessionId, i.sectionKey)
    }
    case 'get_validation_report': {
      const i = getValidationReportSchema.parse(rawInput)
      return application.getValidationReport(ctx, i.sessionId)
    }
    case 'get_project_summary': {
      const i = getProjectSummarySchema.parse(rawInput)
      return projects.getProjectSummary(ctx, i.projectId)
    }
    case 'list_uploaded_documents': {
      const i = listUploadedDocumentsSchema.parse(rawInput)
      return projects.listUploadedDocuments(ctx, i.projectId)
    }
    case 'get_document_content': {
      const i = getDocumentContentSchema.parse(rawInput)
      return documents.getDocumentContent(ctx, i.fileId, { maxChars: i.maxChars })
    }
    case 'run_eligibility': {
      const i = runEligibilitySchema.parse(rawInput)
      // runEligibility takes (ctx, projectSummary, callId) — 3 args
      return eligibility.runEligibility(ctx, i.projectSummary, i.callId)
    }
    case 'score_fit': {
      const i = scoreFitSchema.parse(rawInput)
      // scoreFit takes (ctx, projectSummary, callId) — 3 args
      return eligibility.scoreFit(ctx, i.projectSummary, i.callId)
    }
    case 'validate_section': {
      const i = validateSectionSchema.parse(rawInput)
      return sections.validateSection(ctx, i.sessionId, i.sectionKey)
    }
    case 'validate_application': {
      const i = validateApplicationSchema.parse(rawInput)
      return application.validateApplication(ctx, i.sessionId)
    }
    case 'check_missing_annexes': {
      const i = checkMissingAnnexesSchema.parse(rawInput)
      return application.checkMissingAnnexes(ctx, i.sessionId)
    }
    // ── Phase 3b write tools ───────────────────────────────────────────────
    case 'save_section_draft': {
      const i = saveSectionDraftSchema.parse(rawInput)
      return sections.saveSectionDraft(ctx, i)
    }
    case 'approve_revision': {
      const i = approveRevisionSchema.parse(rawInput)
      return sections.approveSection(ctx, i)
    }
    case 'rollback_section': {
      const i = rollbackSectionSchema.parse(rawInput)
      return sections.rollbackSection(ctx, i)
    }
    case 'mark_section_stale': {
      const i = markSectionStaleSchema.parse(rawInput)
      return sections.markSectionStale(ctx, i)
    }
    case 'reject_section': {
      const i = rejectSectionSchema.parse(rawInput)
      return sections.rejectSection(ctx, i)
    }
    case 'set_application_status': {
      const i = setApplicationStatusSchema.parse(rawInput)
      return application.setApplicationStatus(ctx, i)
    }
    case 'set_selected_call': {
      const i = setSelectedCallSchema.parse(rawInput)
      return application.setSelectedCall(ctx, i)
    }
    case 'freeze_outline': {
      const i = freezeOutlineSchema.parse(rawInput)
      return application.freezeOutline(ctx, i)
    }
    default:
      throw new Error(`Dispatcher has no handler for ${name}`)
  }
}

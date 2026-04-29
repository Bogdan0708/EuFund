// ── Managed runtime tool definitions ────────────────────────────
// Tools exposed to Anthropic's Messages API. Each tool's JSON schema
// is derived from the Phase 1 MCP handler's Zod schema via
// `zodToJsonSchema`. Phase 2 was read-only (14 tools). Phase 3b adds
// the 8 write tools (22 total: 9 read + 5 rules + 8 write).

import type { Tool } from '@anthropic-ai/sdk/resources/messages'
import { zodToJsonSchema } from '../utils'

// Read tools — canonical Zod schemas exported from Phase 1 handlers
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

// Rules tools
import { inputSchema as runEligibilitySchema } from '../mcp/rules/run-eligibility'
import { inputSchema as scoreFitSchema } from '../mcp/rules/score-fit'
import { inputSchema as validateSectionSchema } from '../mcp/rules/validate-section'
import { inputSchema as validateApplicationSchema } from '../mcp/rules/validate-application'
import { inputSchema as checkMissingAnnexesSchema } from '../mcp/rules/check-missing-annexes'

// Write tools — canonical Zod schemas exported from Phase 1/3b handlers
import { inputSchema as saveSectionDraftSchema } from '../mcp/write/save-section-draft'
import { inputSchema as approveRevisionSchema } from '../mcp/write/approve-revision'
import { inputSchema as rollbackSectionSchema } from '../mcp/write/rollback-section'
import { inputSchema as setApplicationStatusSchema } from '../mcp/write/set-application-status'
import { inputSchema as setSelectedCallSchema } from '../mcp/write/set-selected-call'
import { inputSchema as freezeOutlineSchema } from '../mcp/write/freeze-outline'
import { inputSchema as markSectionStaleSchema } from '../mcp/write/mark-section-stale'
import { inputSchema as rejectSectionSchema } from '../mcp/write/reject-section'
import { inputSchema as saveCallBlueprintSchema } from '../mcp/write/save-call-blueprint'

export const MANAGED_TOOLS: Tool[] = [
  {
    name: 'search_calls',
    description: 'Search EU funding calls by semantic similarity. Returns ranked matches with call ID, title, program, relevance score, and a short snippet. Read-only.',
    input_schema: zodToJsonSchema(searchCallsSchema) as Tool['input_schema'],
  },
  {
    name: 'get_call_blueprint',
    description: 'Look up a funding call blueprint by ID. Returns cached blueprint, or a cache-miss result containing raw evidence for extraction. Read-only.',
    input_schema: zodToJsonSchema(getCallBlueprintSchema) as Tool['input_schema'],
  },
  {
    name: 'retrieve_evidence',
    description: 'Retrieve evidence chunks from Qdrant for a query, optionally filtered by call ID. Returns top-scored chunks with source metadata. Read-only.',
    input_schema: zodToJsonSchema(retrieveEvidenceSchema) as Tool['input_schema'],
  },
  {
    name: 'get_application_state',
    description: 'Get the current application state: phase, selected call, eligibility summary, section statuses, warnings. Scoped to the active session automatically. Read-only.',
    input_schema: zodToJsonSchema(getApplicationStateSchema) as Tool['input_schema'],
  },
  {
    name: 'list_sections',
    description: 'List sections with key, title, status, and document order. Does not return section content. Scoped to the active session. Read-only.',
    input_schema: zodToJsonSchema(listSectionsSchema) as Tool['input_schema'],
  },
  {
    name: 'get_section',
    description: 'Get full details of one section by sectionKey: title, status, content, accepted content, model used, sources. Scoped to the active session. Read-only.',
    input_schema: zodToJsonSchema(getSectionSchema) as Tool['input_schema'],
  },
  {
    name: 'get_validation_report',
    description: 'Get the latest validation report: issues, pass/fail summary, annex checklist. Scoped to the active session. Read-only.',
    input_schema: zodToJsonSchema(getValidationReportSchema) as Tool['input_schema'],
  },
  {
    name: 'get_project_summary',
    description: 'Get the project summary: name, organization type, sector, region, budget range, team size, description. Read-only.',
    input_schema: zodToJsonSchema(getProjectSummarySchema) as Tool['input_schema'],
  },
  {
    name: 'list_uploaded_documents',
    description: 'List documents uploaded for a project with filename, type, upload date, and size. Read-only.',
    input_schema: zodToJsonSchema(listUploadedDocumentsSchema) as Tool['input_schema'],
  },
  {
    name: 'get_document_content',
    description: 'Fetch extracted text for an uploaded document by file ID. Returns up to maxChars characters of the ocr_text column (default 8000, valid range 500-50000). Call AFTER list_uploaded_documents to read files the user has attached. Returns empty text when the document is not indexed (scanned PDF with no text layer, or a legacy .doc file). The `truncated` field indicates whether text was cut off at maxChars. Read-only.',
    input_schema: zodToJsonSchema(getDocumentContentSchema) as Tool['input_schema'],
  },
  {
    name: 'run_eligibility',
    description: 'Run deterministic eligibility rules against a project summary and call ID. Returns eligible/not-eligible, score, passes, failures, warnings.',
    input_schema: zodToJsonSchema(runEligibilitySchema) as Tool['input_schema'],
  },
  {
    name: 'score_fit',
    description: 'Multi-dimensional project-to-call fit scoring. Returns overall score and per-dimension rationale.',
    input_schema: zodToJsonSchema(scoreFitSchema) as Tool['input_schema'],
  },
  {
    name: 'validate_section',
    description: 'Validate a section deterministically (placeholders, length, repetition). Returns issues, score, and recommended status.',
    input_schema: zodToJsonSchema(validateSectionSchema) as Tool['input_schema'],
  },
  {
    name: 'validate_application',
    description: 'Validate the entire application: section status summary, annex checklist, outstanding issues.',
    input_schema: zodToJsonSchema(validateApplicationSchema) as Tool['input_schema'],
  },
  {
    name: 'check_missing_annexes',
    description: 'Compare required annexes against uploaded documents. Returns required, uploaded, and missing lists.',
    input_schema: zodToJsonSchema(checkMissingAnnexesSchema) as Tool['input_schema'],
  },
  {
    name: 'save_section_draft',
    description: 'Upsert a section draft by sectionKey, creating or updating the section and creating a new version record. Scoped to the active session. Requires the outline to be frozen. Enforces concurrency via expectedStateVersion. Always get explicit user confirmation or a structured UI action confirmation before calling — this is a write tool.',
    input_schema: zodToJsonSchema(saveSectionDraftSchema) as Tool['input_schema'],
  },
  {
    name: 'approve_revision',
    description: 'Set a section status to accepted, copying content to acceptedContent. If already accepted, returns current state (no-op). Requires the outline to be frozen. Enforces concurrency via expectedStateVersion. Always get explicit user confirmation or a structured UI action confirmation before calling — this is a write tool.',
    input_schema: zodToJsonSchema(approveRevisionSchema) as Tool['input_schema'],
  },
  {
    name: 'rollback_section',
    description: 'Restore a section to a previous version by version number. Replaces section content with the historical version content and sets status to draft. Requires the outline to be frozen. Always get explicit user confirmation or a structured UI action confirmation before calling — this is a write tool.',
    input_schema: zodToJsonSchema(rollbackSectionSchema) as Tool['input_schema'],
  },
  {
    name: 'set_application_status',
    description: 'Update the active session status to paused or completed. Setting to the current status is a no-op (idempotent). Completing requires passing validation. Enforces concurrency via expectedStateVersion. Always get explicit user confirmation or a structured UI action confirmation before calling — this is a write tool.',
    input_schema: zodToJsonSchema(setApplicationStatusSchema) as Tool['input_schema'],
  },
  {
    name: 'set_selected_call',
    description: "Set the session's selected funding call. Requires the session to be active and the outline not yet frozen. Idempotent if the same callId is already selected. Always get explicit user confirmation or a structured UI action confirmation before calling — this is a write tool.",
    input_schema: zodToJsonSchema(setSelectedCallSchema) as Tool['input_schema'],
  },
  {
    name: 'freeze_outline',
    description: 'Freeze the application outline, moving the workflow from structuring into drafting. Requires a selected call and passing eligibility. After freeze, the call cannot change and drafting tools become available. Idempotent if outline is already frozen. Always get explicit user confirmation or a structured UI action confirmation before calling — this is a write tool.',
    input_schema: zodToJsonSchema(freezeOutlineSchema) as Tool['input_schema'],
  },
  {
    name: 'mark_section_stale',
    description: 'Mark a section as stale, flagging it for regeneration. Valid from draft, needs_review, or accepted status. When demoting from accepted, the accepted snapshot is cleared. Idempotent if already stale. Always get explicit user confirmation or a structured UI action confirmation before calling — this is a write tool.',
    input_schema: zodToJsonSchema(markSectionStaleSchema) as Tool['input_schema'],
  },
  {
    name: 'reject_section',
    description: 'Reject a section with a required reason string. Valid from draft, needs_review, or same-reason rejected (no-op). Different-reason re-reject is forbidden to prevent rejection metadata churn. Always get explicit user confirmation or a structured UI action confirmation before calling — this is a write tool.',
    input_schema: zodToJsonSchema(rejectSectionSchema) as Tool['input_schema'],
  },
  {
    name: 'save_call_blueprint',
    description: 'Persist an agent-extracted call blueprint into the global cache (callKnowledge) AND the active session row. Idempotent by callId. CALL THIS AUTOMATICALLY in research-phase preselected sessions after converting the injected retrieve_evidence result into structured fields — the deterministic preselect itself is the user confirmation, NO additional confirmation is required for this tool. Set structureConfidence ≥ 0.4 only when the blueprint is well supported by the evidence; below threshold the row persists as provisional and the next session re-extracts. On success the session phase advances from research to structuring.',
    input_schema: zodToJsonSchema(saveCallBlueprintSchema) as Tool['input_schema'],
  },
]

// ── Categorized tool name sets ─────────────────────────────────────────────
// Four disjoint sets used by the executor's allowWrites gate, the Phase 4
// rejection branch, and the runtime's parallel-write cap. Kept literal
// (not derived from MANAGED_TOOLS) so the compiler can verify membership
// against the entries and so adding a tool requires an explicit decision
// about which category it belongs to.

export const READ_TOOL_NAMES: ReadonlySet<string> = new Set([
  'search_calls',
  'get_call_blueprint',
  'retrieve_evidence',
  'get_application_state',
  'list_sections',
  'get_section',
  'get_validation_report',
  'get_project_summary',
  'list_uploaded_documents',
  'get_document_content',
])

export const RULE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'run_eligibility',
  'score_fit',
  'validate_section',
  'validate_application',
  'check_missing_annexes',
])

export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'save_section_draft',
  'approve_revision',
  'rollback_section',
  'set_application_status',
  'set_selected_call',
  'freeze_outline',
  'mark_section_stale',
  'reject_section',
  'save_call_blueprint',
])

export const PHASE_4_BLOCKED_TOOL_NAMES: ReadonlySet<string> = new Set([
  'create_export_snapshot',
])

export const MANAGED_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...READ_TOOL_NAMES,
  ...RULE_TOOL_NAMES,
  ...WRITE_TOOL_NAMES,
])

/**
 * Returns the tool surface the managed runtime should advertise to Anthropic
 * for a given turn. When writes are disabled for this user (allowWrites=false),
 * write tools are excluded entirely — the model never sees them and cannot
 * attempt them, matching the behavioral contract of the rollout gate.
 *
 * The executor's allowWrites gate remains as defense-in-depth in case a
 * write tool somehow reaches dispatch (shouldn't happen since the tool is
 * absent from the advertised set, but costs nothing to keep).
 */
export function getManagedTools(allowWrites: boolean): Tool[] {
  if (allowWrites) return MANAGED_TOOLS
  return MANAGED_TOOLS.filter((t) => !WRITE_TOOL_NAMES.has(t.name))
}

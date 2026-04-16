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
    description: 'Get the current application state for a session: phase, selected call, eligibility summary, section statuses, warnings. Read-only.',
    input_schema: zodToJsonSchema(getApplicationStateSchema) as Tool['input_schema'],
  },
  {
    name: 'list_sections',
    description: 'List sections for a session with key, title, status, and document order. Does not return section content. Read-only.',
    input_schema: zodToJsonSchema(listSectionsSchema) as Tool['input_schema'],
  },
  {
    name: 'get_section',
    description: 'Get full details of one section: title, status, content, accepted content, model used, sources. Read-only.',
    input_schema: zodToJsonSchema(getSectionSchema) as Tool['input_schema'],
  },
  {
    name: 'get_validation_report',
    description: 'Get the latest validation report for a session: issues, pass/fail summary, annex checklist. Read-only view of validation state.',
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
    description: 'Upsert a section draft by (sessionId, sectionKey), creating or updating the section and creating a new version record. Requires the outline to be frozen. Enforces concurrency via expectedStateVersion. Always get explicit user confirmation or a structured UI action confirmation before calling — this is a write tool.',
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
    description: 'Update the status of an agent session to paused or completed. Setting to the current status is a no-op (idempotent). Completing requires passing validation. Enforces concurrency via expectedStateVersion. Always get explicit user confirmation or a structured UI action confirmation before calling — this is a write tool.',
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
]

export const MANAGED_TOOL_NAMES: Set<string> = new Set(
  MANAGED_TOOLS.map(t => t.name),
)

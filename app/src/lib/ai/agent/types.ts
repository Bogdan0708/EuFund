import type { ZodType } from 'zod'

// ── Constants ───────────────────────────────────────────────────

export const PHASES = ['discovery', 'research', 'structuring', 'drafting', 'review'] as const
export type Phase = (typeof PHASES)[number]

export const SESSION_STATUSES = ['active', 'paused', 'completed', 'abandoned', 'error'] as const
export type SessionStatus = (typeof SESSION_STATUSES)[number]

export const SECTION_STATUSES = [
  'pending', 'generating', 'draft', 'accepted', 'stale', 'invalidated', 'needs_review', 'failed', 'rejected',
] as const
export type SectionStatus = (typeof SECTION_STATUSES)[number]

export const CHECKPOINT_TYPES = [
  'call_selected', 'structure_approved', 'section_accepted', 'section_regenerated',
  'call_changed', 'structure_changed', 'proposal_completed',
] as const
export type CheckpointType = (typeof CHECKPOINT_TYPES)[number]

// ── Domain types (canonical home) ───────────────────────────────

export interface CallBlueprint {
  callId: string
  program: string
  isOpen: boolean
  amendments: string[]
  warnings: string[]
  requiredSections: { title: string; description: string; evaluationWeight?: number }[]
  mandatoryAnnexes: string[]
  eligibilityCriteria: string[]
  evaluationGrid: { criterion: string; maxPoints: number }[]
  cofinancingRate: number
  eligibilityResult: {
    score: number
    passCount: number
    failCount: number
    failures: string[]
    warnings: string[]
  }
  sources: string[]
  verifiedAt: string
  raw: {
    notebookLmResponse: string
    perplexityResponse: string
    retrievedAt: string
  }
  normalized: {
    requiredSections: SectionSpec[]
    mandatoryAnnexes: string[]
    eligibilityCriteria: string[]
    evaluationGrid: { criterion: string; maxPoints: number }[]
    cofinancingRate: number
  }
  structureConfidence: number
}

export interface SectionSpec {
  id: string
  title: string
  description: string
  order: number
  generationOrder: number
  importance: 'critical' | 'standard' | 'supplementary'
  expectedLength: 'short' | 'medium' | 'long'
  dependsOn: string[]
  modelHint: 'heavy' | 'light'
  evaluationWeight?: number
  mandatory: boolean
  confidence: number
}

// ── Session & State ─────────────────────────────────────────────

export interface Warning {
  code: string
  message: string
  severity: 'low' | 'medium' | 'high' | 'blocker'
}

export interface PlanningArtifact {
  projectSummary?: string
  keyAssumptions?: string[]
  openQuestions?: string[]
  generationOrder?: string[]
  unresolvedBlockers?: string[]
}

export interface EligibilityResult {
  results: {
    ruleId: string
    ruleName: string
    status: 'pass' | 'fail' | 'warning' | 'not_applicable'
    messageRo: string
    messageEn: string
    details?: Record<string, unknown>
  }[]
  score: number
  passCount: number
  failCount: number
  warningCount: number
}

export interface AgentSession {
  id: string
  userId: string
  projectId: string | null
  status: SessionStatus
  locale: 'ro' | 'en'
  selectedCallId: string | null
  currentPhase: Phase
  blueprint: CallBlueprint | null
  eligibility: EligibilityResult | null
  outline: SectionSpec[] | null
  warnings: Warning[]
  planningArtifact: PlanningArtifact | null
  outlineFrozen: boolean
  messageSummary: string | null
  stateVersion: number
  createdAt: Date
  updatedAt: Date
}

export interface AgentSection {
  id: string
  sessionId: string
  sectionKey: string
  title: string
  documentOrder: number
  generationOrder: number
  status: SectionStatus
  content: string | null
  acceptedContent: string | null
  modelUsed: string | null
  retryCount: number
  sourcesUsed: string[] | null
  promptVersion: string | null
  latencyMs: number | null
  tokenUsage: { input: number; output: number } | null
  errorClass: string | null
  rejectionReason: string | null  // NEW — Phase 3a
  updatedAt: Date
}

export interface AgentSectionVersion {
  id: string
  sectionId: string
  versionNumber: number
  kind: 'draft' | 'accepted' | 'regenerated' | 'system_rewrite' | 'rollback'
  content: string
  modelUsed: string | null
  sourcesUsed: string[] | null
  rolledBackFromVersion: number | null  // Phase 3a; populated only when kind='rollback'
  createdAt: Date
}

export interface AgentMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'tool'
  messageType: 'text' | 'tool_call' | 'tool_result' | 'system_summary' | 'structured_action'
  content: unknown
  toolName: string | null
  toolCallId: string | null
  sequenceNumber: number
  compactedAt: Date | null
  createdAt: Date
}

export interface AgentCheckpoint {
  id: string
  sessionId: string
  checkpointType: CheckpointType
  payload: Record<string, unknown>
  createdAt: Date
}

// ── Tool System ─────────────────────────────────────────────────

export interface ToolTelemetry {
  latencyMs: number
  tokensUsed?: { input: number; output: number }
  model?: string
  provider?: string
  sources?: string[]
  retryCount?: number
}

export interface CheckpointRequest {
  type: CheckpointType
  payload: Record<string, unknown>
}

export interface ToolResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
  retryable?: boolean
  warnings?: string[]
  stateTransitions?: StateTransition[]
  checkpoint?: CheckpointRequest
  telemetry: ToolTelemetry
}

export interface ToolContext {
  sessionId: string
  userId: string
  session: AgentSession
  sections: AgentSection[]
  stateVersion: number
  requestId: string
  locale: 'ro' | 'en'
  routingCtx?: import('../model-routing').ModelRoutingContext
  /**
   * PR 4: the section the user has focused in the UI. Populated by the
   * runtime from the agent request body when present. Tools that target a
   * specific section may fall back to this when the model omits the key.
   */
  focusedSectionKey?: string
  /**
   * PR 4: true when the `chat_tools_trimmed` feature flag is on for this
   * turn. Rule tools use this to switch off persistence (read-only adapter
   * mode) — persistence stays exclusive to PR 3 REST action endpoints.
   */
  chatToolsTrimmed?: boolean
  /**
   * Per-tool abort signal. Fires when (a) the parent runtime signal
   * aborts (client disconnect, Cloud Run timeout, soft deadline expiry),
   * or (b) the tool's own timeout elapses. Long-running tools — anything
   * that streams an LLM or writes to the DB — MUST forward this to the
   * provider SDK and check `signal.aborted` before every DB mutation so
   * background work stops when the user is gone. Without it, the runtime's
   * Promise.race timeout resolves the wait but leaves the underlying work
   * running, burning Opus tokens for nobody and racing the DB on retry.
   */
  signal?: AbortSignal
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string
  category: 'read' | 'decision' | 'generation'
  description: string
  inputSchema: ZodType<TInput>
  execute: (input: TInput, ctx: ToolContext) => Promise<ToolResult<TOutput>>
  timeout: number
}

// ── State Transitions ───────────────────────────────────────────

export type StateTransition =
  | { type: 'SET_SELECTED_CALL'; callId: string }
  | { type: 'SET_BLUEPRINT'; blueprint: CallBlueprint }
  | { type: 'SET_ELIGIBILITY'; result: EligibilityResult }
  | { type: 'SET_OUTLINE'; outline: SectionSpec[] }
  | { type: 'FREEZE_OUTLINE' }
  | { type: 'SET_PHASE'; phase: Phase }
  | { type: 'SET_WARNINGS'; warnings: Warning[] }
  | { type: 'ADD_WARNING'; warning: Warning }
  | { type: 'SET_PLANNING_ARTIFACT'; artifact: Partial<PlanningArtifact> }
  | { type: 'UPSERT_SECTION_DRAFT'; sectionKey: string; content: string; model: string; sources: string[] }
  | { type: 'ACCEPT_SECTION'; sectionKey: string }
  | { type: 'REJECT_SECTION'; sectionKey: string; reason: string }
  | { type: 'MARK_SECTION_STALE'; sectionKey: string }
  | { type: 'INVALIDATE_ALL_SECTIONS' }
  | { type: 'SET_STATUS'; status: SessionStatus }

// ── Structured Actions (from frontend) ──────────────────────────

export type StructuredAction =
  | { type: 'select_call'; callId: string }
  | { type: 'approve_outline' }
  | { type: 'accept_section'; sectionKey: string }
  | { type: 'regenerate_section'; sectionKey: string; feedback: string }
  | { type: 'reject_section'; sectionKey: string; reason: string }
  | { type: 'request_refresh' }
  | { type: 'mark_complete' }

// ── Agent Events (SSE) ─────────────────────────────────────────

export interface UIStateSnapshot {
  sessionId: string
  phase: Phase
  stateVersion: number
  outlineFrozen: boolean
  warnings: Warning[]
  sections: { sectionKey: string; title: string; status: SectionStatus; documentOrder: number; content: string | null }[]
  blueprint: CallBlueprint | null
  eligibility: EligibilityResult | null
}

export type AgentEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_start'; tool: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; summary: string; success: boolean }
  | { type: 'phase_changed'; from: Phase; to: Phase }
  | { type: 'section_status'; sectionKey: string; status: SectionStatus }
  | { type: 'checkpoint'; checkpointType: CheckpointType; summary: string }
  | { type: 'state_update'; patch: Partial<UIStateSnapshot> }
  | { type: 'policy_violation'; gate: string; reason: string }
  | { type: 'error'; message: string; retryable: boolean }
  | { type: 'done'; finalState: UIStateSnapshot; degradedReason?: string | null }

// ── Request Shape ───────────────────────────────────────────────

export interface AgentRequest {
  sessionId?: string
  message?: string
  action?: StructuredAction
  requestId: string
  locale: 'ro' | 'en'
  stateVersion?: number
  focusedSectionKey?: string
}

// ── SectionResult (canonical home) ──────────────────────────────

export interface SectionResult {
  id: string
  title: string
  content: string
  order: number
  source: 'generated' | 'edited' | 'failed'

  // Phase 1: versioning + approval
  state: 'draft' | 'reviewed' | 'approved'
  currentVersion: number
  versionCount: number
  contentHash: string
  lastStateChangeAt: string
  lastStateChangeBy: string | null

  metadata: {
    model: string
    provider: string
    tokensIn: number
    tokensOut: number
    latencyMs: number
    retryCount: number
    fallbackUsed: boolean
    generatedAt: string
    checksum: string
  }
}

// ── SubmissionDocument (canonical home) ─────────────────────────

export interface SubmissionDocumentProvenance {
  requirementSource: 'curated_list' | 'ai_classified'
  contentSource: 'template' | 'none'
  templateId?: string
  templateVersion?: string
  classifiedFrom?: string
  confidence?: number
  reviewRequired: boolean
  generatedAt: string
}

export interface SubmissionDocument {
  id: string
  title: string
  content: string
  category: 'declaration' | 'certificate' | 'annex' | 'form'
  scope: 'general' | 'call_specific'
  order: number
  availability: 'generated' | 'needs_fill' | 'external_required'
  instructions: string
  sourceAnnex: string
  userStatus: 'not_started' | 'completed'
  userStatusAt: string | null
  provenance: SubmissionDocumentProvenance
}

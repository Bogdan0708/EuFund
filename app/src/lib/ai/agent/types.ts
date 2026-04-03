import type { ZodSchema } from 'zod'

// ── Constants ───────────────────────────────────────────────────

export const PHASES = ['discovery', 'research', 'structuring', 'drafting', 'review'] as const
export type Phase = (typeof PHASES)[number]

export const SESSION_STATUSES = ['active', 'paused', 'completed', 'abandoned', 'error'] as const
export type SessionStatus = (typeof SESSION_STATUSES)[number]

export const SECTION_STATUSES = [
  'pending', 'generating', 'draft', 'accepted', 'stale', 'invalidated', 'needs_review', 'failed',
] as const
export type SectionStatus = (typeof SECTION_STATUSES)[number]

export const CHECKPOINT_TYPES = [
  'call_selected', 'structure_approved', 'section_accepted', 'section_regenerated',
  'call_changed', 'structure_changed', 'proposal_completed',
] as const
export type CheckpointType = (typeof CHECKPOINT_TYPES)[number]

// ── Re-exports from V2 (kept domain types) ──────────────────────

export type { CallBlueprint, SectionSpec } from '@/lib/ai/orchestrator/types'

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
  status: SessionStatus
  locale: 'ro' | 'en'
  selectedCallId: string | null
  currentPhase: Phase
  blueprint: import('@/lib/ai/orchestrator/types').CallBlueprint | null
  eligibility: EligibilityResult | null
  outline: import('@/lib/ai/orchestrator/types').SectionSpec[] | null
  warnings: Warning[]
  planningArtifact: PlanningArtifact | null
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
  updatedAt: Date
}

export interface AgentSectionVersion {
  id: string
  sectionId: string
  versionNumber: number
  kind: 'draft' | 'accepted' | 'regenerated' | 'system_rewrite'
  content: string
  modelUsed: string | null
  sourcesUsed: string[] | null
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
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string
  category: 'read' | 'decision' | 'generation'
  description: string
  inputSchema: ZodSchema<TInput>
  execute: (input: TInput, ctx: ToolContext) => Promise<ToolResult<TOutput>>
  timeout: number
}

// ── State Transitions ───────────────────────────────────────────

export type StateTransition =
  | { type: 'SET_SELECTED_CALL'; callId: string }
  | { type: 'SET_BLUEPRINT'; blueprint: import('@/lib/ai/orchestrator/types').CallBlueprint }
  | { type: 'SET_ELIGIBILITY'; result: EligibilityResult }
  | { type: 'SET_OUTLINE'; outline: import('@/lib/ai/orchestrator/types').SectionSpec[] }
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
  warnings: Warning[]
  sections: { sectionKey: string; title: string; status: SectionStatus; documentOrder: number }[]
  blueprint: import('@/lib/ai/orchestrator/types').CallBlueprint | null
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
  | { type: 'done'; finalState: UIStateSnapshot }

// ── Request Shape ───────────────────────────────────────────────

export interface AgentRequest {
  sessionId?: string
  message?: string
  action?: StructuredAction
  requestId: string
  locale: 'ro' | 'en'
}

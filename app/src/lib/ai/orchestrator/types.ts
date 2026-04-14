// ─── Orchestrator V2 Types ──────────────────────────────────────

export interface WorkflowContext {
  sessionId: string
  userId: string
  locale: 'ro' | 'en'
  tier: string
  step: number
  enhancedIdea: EnhancedIdea | null
  matchedCalls: MatchedCall[] | null
  selectedCallId: string | null
  callBlueprint: CallBlueprint | null
  actionPlan: ActionPlan | null
  projectSections: SectionResult[] | null
  uploadedFiles: UploadedFile[]
  submissionDocuments?: SubmissionDocument[] | null
  /** User preference for generation length/tone. Loaded from user_preferences at session creation. */
  responseStyle?: 'concise' | 'detailed' | 'technical'
  /** Pre-loaded model routing context (preferences + feature flags). */
  routingCtx?: import('../model-routing').ModelRoutingContext
}

export interface EnhancedIdea {
  originalIdea: string
  refinedDescription: string
  sector: string
  region: string
  targetGroup: string
  estimatedBudget: string
  keyObjectives: string[]
}

export interface MatchedCall {
  callId: string
  title: string
  program: string
  score: number
  thematicFit: number
  eligibilityFit: number
  budgetFit: number
  deadline: string
  sourceUrl: string
  reasoning: string
  freshness?: FreshnessResult
}

export type { CallBlueprint, SectionSpec } from '@/lib/ai/agent/types'
import type { CallBlueprint, SectionSpec } from '@/lib/ai/agent/types'

export type { SectionResult } from '@/lib/ai/agent/types'
import type { SectionResult } from '@/lib/ai/agent/types'

export interface SectionVersion {
  id: string
  version: number
  content: string
  contentHash: string
  title: string
  metadata: {
    model: string
    provider: string
    tokensIn: number
    tokensOut: number
    latencyMs: number
    fallbackUsed: boolean
    generatedAt: string
  }
  reason: string
  createdAt: string
  createdBy: string
}

// ─── Phase 2: Trust Workbench ────────────────────────────────────

export interface FreshnessProvenance {
  provider: string
  model: string
  sourceUrl: string
  evidence: string
}

export interface FreshnessResult {
  status: 'verified' | 'stale' | 'unknown'
  checkedAt: string
  currentDeadline?: string
  warnings: string[]
  provenance: FreshnessProvenance
}

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

export interface ActionPlan {
  matchedCall: {
    title: string
    program: string
    deadline: string
    budget: { min: number; max: number; currency: string }
    sourceUrl: string
  }
  steps: {
    order: number
    title: string
    description: string
    category: 'document' | 'approval' | 'registration' | 'writing' | 'budget'
    deadline?: string
    responsible?: string
    dependencies: number[]
  }[]
  requiredDocuments: {
    name: string
    source: string
    estimatedTime: string
    mandatory: boolean
  }[]
  estimatedTimeline: string
}

export interface UploadedFile {
  fileId: string
  filename: string
  mimeType: string
  extractedText?: string
}

export interface QAResult {
  passed: boolean
  missingSections: string[]
  failedSections: string[]
  placeholderSections: string[]
  truncatedSections: string[]
  duplicateSections: string[]
  budgetConsistent: boolean | null
  warnings: string[]
}

export type ProjectCompletionStatus = 'complete' | 'complete_with_gaps' | 'needs_review' | 'blocked'

export interface AgentResult {
  data: Record<string, unknown>
  checkpoint: CheckpointData | null
  tokensUsed?: number
}

export interface CheckpointData {
  question: string
  options?: { id: string; label: string; description?: string }[]
  type: 'select' | 'confirm' | 'freetext'
}

export type SSEEvent = {
  eventId: number
} & (
  | { type: 'step_start'; step: number; label: string }
  | { type: 'step_progress'; step: number; message: string }
  | { type: 'ai_chunk'; step: number; content: string }
  | { type: 'checkpoint'; step: number; data: CheckpointData; context?: Partial<WorkflowContext>; autoApprove?: boolean }
  | { type: 'step_complete'; step: number; summary: string; context?: Partial<WorkflowContext> }
  | { type: 'discovery'; items: unknown[] }
  | { type: 'error'; step: number; message: string; retryable: boolean }
  | { type: 'done'; projectId?: string; completionStatus?: ProjectCompletionStatus }
  | { type: 'section_updated'; sectionId: string; section: SectionResult }
)

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never
export type SSEEventPayload = DistributiveOmit<SSEEvent, 'eventId'>

export interface SSEStream {
  send(event: SSEEventPayload): void
  close(): void
}

export interface GatewayClient {
  generate(opts: {
    provider: string
    model: string
    system: string
    messages: { role: string; content: string }[]
    maxTokens?: number
    temperature?: number
    stream?: boolean
  }): Promise<{ content: string; tokensUsed: number }>
  embed(text: string): Promise<number[]>
}

export type AgentFn = (
  ctx: WorkflowContext,
  input: string,
  stream: SSEStream,
  gateway: GatewayClient
) => Promise<AgentResult>

export const STEP_LABELS: Record<number, string> = {
  1: 'Enhancing your idea...',
  2: 'Matching with funding calls...',
  3: 'Researching call requirements...',
  4: 'Creating action plan...',
  5: 'Building your project...',
}

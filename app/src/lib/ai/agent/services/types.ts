// ── Service Layer Types ─────────────────────────────────────────────────────
// Framework-agnostic domain types used by all MCP-exposed services.
// These are the shared vocabulary for service functions, V3 adapters,
// and MCP handlers.

import type { CallBlueprint } from '@/lib/ai/orchestrator/types'
import type { SectionStatus } from '../types'
import { AuthorizationError, ValidationError } from './errors'

export type { CallBlueprint }

// ── ServiceContext ─────────────────────────────────────────────────────────
// Injected into every service call. Carries identity & request metadata
// without coupling to HTTP or any framework.

export interface ServiceContext {
  userId: string
  sessionId?: string
  organizationId?: string
  projectId?: string
  requestId: string
  now: Date
}

// ── Context Assertion Helpers ──────────────────────────────────────────────
// Narrow the optional context fields to required, throwing typed errors when
// the field is absent. Import from this file — no circular dependency risk
// since errors.ts does NOT import from types.ts.

export function requireOrganization(
  ctx: ServiceContext,
): asserts ctx is ServiceContext & { organizationId: string } {
  if (!ctx.organizationId) {
    throw new AuthorizationError('organizationId is required for this operation')
  }
}

export function requireProject(
  ctx: ServiceContext,
): asserts ctx is ServiceContext & { projectId: string } {
  if (!ctx.projectId) {
    throw new ValidationError('projectId', 'projectId is required for this operation')
  }
}

export function requireSession(
  ctx: ServiceContext,
): asserts ctx is ServiceContext & { sessionId: string } {
  if (!ctx.sessionId) {
    throw new ValidationError('sessionId', 'sessionId is required for this operation')
  }
}

// ── Domain Result Types ────────────────────────────────────────────────────

// --- Call Search ---

export interface CallMatch {
  callId: string
  title: string
  program: string
  score: number
  snippet: string
  sourceUrl?: string
}

// --- Blueprint ---

// Cache hit: cached=true, blueprint populated, rawEvidence=null.
// Cache miss: cached=false, blueprint=null, rawEvidence populated.
// Cache miss is a valid domain outcome — callers must NOT treat it as failure.

export interface BlueprintLookupResult {
  cached: boolean
  blueprint: CallBlueprint | null
  rawEvidence: EvidenceChunk[] | null
}

export interface BlueprintSaveResult {
  callId: string
  version: number
  contentHash: string
  persistedAt: Date
}

// --- Evidence ---

export interface EvidenceChunk {
  id: string
  content: string
  docType: string
  source: string
  score: number
  priority: number
}

export interface EvidenceBundle {
  callId: string
  chunks: EvidenceChunk[]
  totalChunks: number
  retrievedAt: Date
}

// --- Eligibility ---

export interface EligibilityCriterion {
  ruleId: string
  ruleName: string
  status: 'pass' | 'fail' | 'warning' | 'not_applicable'
  messageRo: string
  messageEn: string
  details?: Record<string, unknown>
}

export interface EligibilityDecision {
  results: EligibilityCriterion[]
  score: number
  passCount: number
  failCount: number
  warningCount: number
}

// --- Sections ---

export interface SectionListItem {
  id: string
  sessionId: string
  sectionKey: string
  title: string
  documentOrder: number
  generationOrder: number
  status: SectionStatus
  retryCount: number
  updatedAt: Date
}

export interface SectionDetail extends SectionListItem {
  content: string | null
  acceptedContent: string | null
  modelUsed: string | null
  sourcesUsed: string[] | null
  promptVersion: string | null
  latencyMs: number | null
  tokenUsage: { input: number; output: number } | null
  errorClass: string | null
}

// Write result shapes — single source of truth. Service implementations
// import these rather than defining local duplicates.

export interface SectionDraftSaveResult {
  sectionId: string
  versionNumber: number
  newStateVersion: number
}

export interface SectionApproveResult {
  newStateVersion: number
}

export interface SectionRollbackResult {
  content: string
  restoredVersion: number
  newStateVersion: number
}

export interface ValidationIssue {
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
  sectionKey?: string
}

export interface SectionValidationResult {
  sectionKey: string
  issues: ValidationIssue[]
  score: number
  recommendedStatus: string
}

// --- Application State ---

export interface ApplicationState {
  sessionId: string
  phase: string
  status: string
  selectedCallId: string | null
  blueprint: CallBlueprint | null
  eligibility: EligibilityDecision | null
  sections: SectionListItem[]
  stateVersion: number
  outlineFrozen: boolean
  updatedAt: Date
}

export interface ApplicationValidationResult {
  passed: boolean
  issues: ValidationIssue[]
  summary: {
    totalSections: number
    acceptedSections: number
    draftSections: number
    missingSections: number
    mandatoryAnnexesMissing: number
    eligibilityBlockers: number
  }
}

// --- Annexes ---

export interface AnnexChecklistItem {
  name: string
  status: 'missing' | 'mentioned'
}

// --- Freshness ---

export interface FreshnessCheckResult {
  isOpen: boolean
  amendments: string[]
  warnings: string[]
  freshnessConfidence: number
  checkedAt: string
}

export interface DeadlineVerification {
  callId: string
  isOpen: boolean
  currentDeadline: string | null
  warnings: string[]
  verifiedAt: string
}

// --- Call Page Diff ---

export interface CallPageDiff {
  callId: string
  sourceUrl: string
  previousHash: string | null
  currentHash: string
  hasChanged: boolean
  diffSummary: string | null
  checkedAt: Date
}

// --- Fit Score ---

export interface FitScore {
  callId: string
  overallScore: number
  thematicFit: number
  eligibilityFit: number
  budgetFit: number
  reasoning: string
}

// --- Project Summary ---

export interface ProjectSummary {
  projectId: string
  title: string
  description: string | null
  organizationId: string
  status: string
  createdAt: Date
  updatedAt: Date
}

// --- Documents ---

export interface UploadedDocument {
  fileId: string
  filename: string
  mimeType: string
  sizeBytes: number
  uploadedAt: Date
  extractedText?: string
}

// --- Export ---

export interface ExportSnapshot {
  snapshotId: string
  format: 'json'
  downloadUrl: string
  expiresAt: string
}

export interface SetApplicationStatusResult {
  newStateVersion: number
}

// ── Policy Matrix ────────────────────────────────────────────────────────
// Declarative rules for every Phase 3 state-changing operation.
//
// This file is purely declarative. Procedural logic (idempotency checks,
// validation-application preconditions, rejection-reason comparison, etc.)
// lives in the service functions, not here. The matrix describes:
//   - which invariants must hold before the mutation
//   - which error code is raised when a gate fails
//   - which audit action string tags the event
//
// LEGACY AUDIT STRINGS: Some rules reuse the legacy V3 audit action
// strings (e.g. `project.version_save`, `section.state_change`) on
// purpose, to preserve hash-chain continuity across the V3 → managed
// migration. Do not rename them without a coordinated audit migration.

import type { SectionStatus, SessionStatus } from '../types'

export type EligibilityRequirement = 'none' | 'run' | 'passed'

export interface PolicyRule {
  requiresOwnership: true
  requiresStateVersion: true
  requiresSessionStatus?: SessionStatus[]
  requiresCallSelected?: boolean
  requiresOutlineFrozen?: boolean
  forbidsOutlineFrozen?: boolean
  requiresEligibility: EligibilityRequirement
  allowedSectionStates?: SectionStatus[]
  forbidIfSectionState?: SectionStatus[]
  auditAction: string
  errorCodes: PolicyErrorCodes
}

export interface PolicyErrorCodes {
  sessionStatus?: string
  noCall?: string
  outlineFrozen?: string      // raised when forbidsOutlineFrozen is violated
  outlineNotFrozen?: string   // raised when requiresOutlineFrozen is violated
  eligibility?: string
  sectionWrongState?: string
}

export const POLICY_MATRIX = {
  setSelectedCall: {
    requiresOwnership: true,
    requiresStateVersion: true,
    requiresSessionStatus: ['active'],
    requiresEligibility: 'none',
    forbidsOutlineFrozen: true,
    auditAction: 'session.call_selected',
    errorCodes: {
      sessionStatus: 'POLICY_SESSION_NOT_ACTIVE',
      outlineFrozen: 'POLICY_OUTLINE_ALREADY_FROZEN',
    },
  },
  freezeOutline: {
    requiresOwnership: true,
    requiresStateVersion: true,
    requiresSessionStatus: ['active'],
    requiresCallSelected: true,
    requiresEligibility: 'passed',
    forbidsOutlineFrozen: true,
    auditAction: 'session.outline_frozen',
    errorCodes: {
      sessionStatus: 'POLICY_SESSION_NOT_ACTIVE',
      noCall: 'POLICY_NO_CALL_SELECTED',
      eligibility: 'POLICY_ELIGIBILITY_NOT_PASSED',
      outlineFrozen: 'POLICY_OUTLINE_ALREADY_FROZEN',
    },
  },
  saveSectionDraft: {
    requiresOwnership: true,
    requiresStateVersion: true,
    requiresSessionStatus: ['active'],
    requiresOutlineFrozen: true,
    requiresEligibility: 'passed',
    auditAction: 'project.version_save',
    errorCodes: {
      sessionStatus: 'POLICY_SESSION_NOT_ACTIVE',
      outlineNotFrozen: 'POLICY_OUTLINE_NOT_FROZEN',
      eligibility: 'POLICY_ELIGIBILITY_NOT_PASSED',
    },
  },
  approveSection: {
    requiresOwnership: true,
    requiresStateVersion: true,
    requiresOutlineFrozen: true,
    requiresEligibility: 'none',
    allowedSectionStates: ['draft', 'needs_review'],
    auditAction: 'section.state_change',
    errorCodes: {
      outlineNotFrozen: 'POLICY_OUTLINE_NOT_FROZEN',
      sectionWrongState: 'POLICY_SECTION_WRONG_STATE',
    },
  },
  rollbackSection: {
    requiresOwnership: true,
    requiresStateVersion: true,
    requiresOutlineFrozen: true,
    requiresEligibility: 'none',
    // LEGACY: reuses the existing 'section.rollback' action string
    // for hash-chain continuity with V3. Do not rename to
    // 'section.rolled_back' — that would fork the audit semantics.
    auditAction: 'section.rollback',
    errorCodes: {
      outlineNotFrozen: 'POLICY_OUTLINE_NOT_FROZEN',
    },
  },
  markSectionStale: {
    requiresOwnership: true,
    requiresStateVersion: true,
    requiresOutlineFrozen: true,
    requiresEligibility: 'none',
    allowedSectionStates: ['draft', 'needs_review', 'accepted'],
    auditAction: 'section.marked_stale',
    errorCodes: {
      outlineNotFrozen: 'POLICY_OUTLINE_NOT_FROZEN',
      sectionWrongState: 'POLICY_SECTION_WRONG_STATE',
    },
  },
  rejectSection: {
    requiresOwnership: true,
    requiresStateVersion: true,
    requiresOutlineFrozen: true,
    requiresEligibility: 'none',
    allowedSectionStates: ['draft', 'needs_review', 'rejected'],
    auditAction: 'section.rejected',
    errorCodes: {
      outlineNotFrozen: 'POLICY_OUTLINE_NOT_FROZEN',
      sectionWrongState: 'POLICY_SECTION_WRONG_STATE',
    },
  },
  setApplicationStatus: {
    requiresOwnership: true,
    requiresStateVersion: true,
    requiresEligibility: 'none',
    auditAction: 'session.status_change',
    errorCodes: {},
  },
} as const satisfies Record<string, PolicyRule>

export type PolicyMatrixKey = keyof typeof POLICY_MATRIX

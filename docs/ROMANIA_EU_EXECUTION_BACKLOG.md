# Romania & EU Execution Backlog

## Goal
Implement a Romania-first EU grant operating system: strict MySMIS compatibility, compliance automation, audit resilience, and consortium intelligence.

## Sequencing Principles
- Deliver mandatory workflow constraints first (MySMIS/MIPE).
- Enforce deterministic validation before AI-assisted enhancements.
- Ship each epic with measurable risk reduction and tests.

## Epic 1: MySMIS Contract & Validation (In Progress)
- Deliverables:
  - Versioned export contract (`mysmis-2021-plus-v1`).
  - Validation engine with hard errors + actionable warnings.
  - Strict mode (`strict=true`) for pre-submit gatekeeping.
- Done in this iteration:
  - Contract validator implemented and wired to `/api/v1/projects/[id]/mysmis-export`.
  - Integration tests for valid/invalid/warning contract scenarios.
- Next:
  - Publish JSON schema artifact for external consumers.
  - Add CSV/XLSX templates mirroring MySMIS import tabs.

## Epic 2: Ghid-to-Tasks Compliance Automation (In Progress)
- Parse Applicant Guide/annexes into structured obligations.
- Generate assignable tasks:
  - `requirement`, `owner`, `deadline`, `evidence`, `risk`.
- Add traceability links from each task to source clause/page.
- Add “compliance readiness score” by section.
- Done in this iteration:
  - Deterministic `ghid -> tasks` engine (`/api/ai/ghid-to-tasks`).
  - Risk/owner/evidence classification for extracted obligations.
  - Source traceability (`line`, `page`, `clauseId`) per generated task.
  - Compliance readiness scoring by section + overall score.
  - Persistence layer for generated tasks in project compliance records.
  - New project endpoint: `/api/v1/projects/[id]/compliance/ghid-tasks` (generate+persist, list).
  - Integration tests for extraction behavior.

## Epic 3: Audit-Proof Evidence Ledger
- Immutable event timeline (who/when/what changed).
- Evidence bundle model for each compliance obligation.
- 3–5 year sustainability monitoring workflow with reminders.
- Exportable audit pack (PDF + machine-readable manifest).
- Done in this iteration:
  - Append-only evidence ledger API per project (`/api/v1/projects/[id]/evidence-ledger`).
  - Tenant-scoped list/append operations backed by immutable `audit_log`.
  - Deterministic evidence event schema (`obligationId`, `evidenceType`, `storageRef`, checksum).
  - Evidence coverage endpoint (`/api/v1/projects/[id]/compliance/evidence-coverage`) linking obligations to ledger events.

## Epic 4: Consortium Intelligence (CaaS foundation)
- Partner profile quality scoring:
  - prior participation, domain fit, financial viability, geography.
- Risk flags for consortium composition (single-point failures, weak capacity).
- Recommendation engine for partner coverage gaps by call requirements.

## Epic 5: ERP/Procurement Guardrails
- Budget-line policy engine for procurement checks.
- Connector layer for ERP spend ingestion.
- Rule checks for grant-specific procurement constraints.
- Violation alerts before reimbursement submission.

## Cross-Cutting Security & Quality
- Maintain strict tenant isolation and IDOR prevention in all new endpoints.
- Keep prompt-injection delimiters and policy checks for all AI routes.
- CI gates per epic: `lint`, `typecheck`, `unit/integration`, `build`.

# Cross-Repo Execution Plan

Date: 2026-03-11
Primary repos:
- `EU-Funds` (`/home/godja/Dev/EU-Funds`, branch `master`, synced with `origin/master`)
- `ai-gateway` (`/home/godja/Dev/ai-gateway`, branch `main`, synced with `origin/main`)

This plan turns the current audit findings and product priorities into a systematic execution program.

## Objective

Stabilize FundEU as a production SaaS platform while preserving momentum on the strategic initiatives:
- RAG and knowledge retrieval
- NotebookLM-assisted research workflows
- Obsidian knowledge vault generation
- new VM for stateful knowledge/data operations
- AI gateway standardization

The sequencing here is strict:
1. lock topology and ownership
2. make deployment safe
3. harden cross-repo contracts
4. operationalize RAG and knowledge workflows
5. tighten product/domain correctness

## Current State Summary

### Confirmed repo state
- `EU-Funds` local branch matches `origin/master`
- `ai-gateway` local branch matches `origin/main`
- meaningful work in both repos is currently uncommitted

### System shape inferred from code
- `EU-Funds` is the customer-facing app and system of record
- `ai-gateway` is the shared AI control plane for chat/completion/embeddings
- Qdrant is the current vector store for production RAG
- Cloud Run is the active production runtime direction for web/app workloads
- the new VM is the natural place for stateful knowledge services and batch pipelines, but this role is not yet explicitly documented
- NotebookLM and Obsidian workflows exist as workstation-local tooling and are strategically important, but are not yet governed as repeatable operational systems

## Target Operating Model

### Layer 1: Product Runtime
Owned by `EU-Funds`
- Next.js app
- auth, billing, organizations, projects, approvals, documents
- product APIs
- customer-visible AI features

### Layer 2: AI Control Plane
Owned by `ai-gateway`
- provider routing
- auth to upstream providers
- readiness and provider diagnostics
- concurrency and tenant policy
- unified chat + embeddings contract

### Layer 3: Knowledge Data Plane
Owned by FundEU platform ops on the new VM
- Qdrant
- classification outputs
- batch ingestion jobs
- reindex jobs
- reviewer artifacts
- optionally NotebookLM/Obsidian export staging

### Layer 4: Internal Knowledge Operations
Internal-only workflows
- NotebookLM notebooks
- Obsidian vault generation
- analyst review sheets
- classification review and source curation

## Phase 0: Topology Lock

Goal:
- remove ambiguity about what runs where and who owns it

Deliverables:
- `docs/SYSTEM-TOPOLOGY.md`
- `docs/VM-RUNBOOK.md`
- `docs/RAG-OPERATING-MODEL.md`
- `docs/KNOWLEDGE-OPS.md`

Required decisions:
- Cloud Run remains the runtime for `EU-Funds`
- `ai-gateway` is the standard path for shared AI completions and embeddings
- the VM hosts stateful knowledge components, not customer-facing app traffic
- NotebookLM and Obsidian remain internal analyst tooling, not hidden production dependencies

Acceptance criteria:
- every runtime component has an owner
- every stateful component has a backup and restore owner
- every network edge is explicitly documented
- every secret source is documented once

## Phase 1: Deployment Safety

Goal:
- make deployment and rollback trustworthy before shipping more surface area

### EU-Funds changes

1. Fix Cloud Run migration execution semantics

Files:
- `.github/workflows/deploy-production.yml`

Problems to address:
- stale job definitions may be executed
- failure to execute and absence of job are conflated
- migration failure can be masked by fallback creation logic

Required outcome:
- deploy pipeline updates or recreates the migration job deterministically
- migration failure aborts deploy
- migration image matches the app image for the target release

2. Reconcile environment and secret provisioning

Files:
- `scripts/setup-gcp.sh`
- `.github/workflows/deploy-production.yml`
- `app/.env.example`

Problems to address:
- provisioning script and deploy workflow expect different secret names
- setup is not reproducible for first-time production bootstrap
- some production secrets are not provisioned by the setup script

Required outcome:
- one canonical secret naming scheme
- setup script provisions the actual deploy contract
- all required env vars are documented

3. Add production-safe smoke checks

Files:
- `.github/workflows/deploy-production.yml`
- create `scripts/smoke-prod.sh`

Smoke scope:
- `/api/health`
- `/api/ready`
- auth route
- DB-backed route
- Redis/rate-limit route
- gateway reachability
- Qdrant reachability or app-level vector path

4. Standardize rollback documentation

Files:
- `docs/VM-RUNBOOK.md`
- `docs/SYSTEM-TOPOLOGY.md`
- existing deploy docs

Acceptance criteria:
- one documented rollback flow for app
- one documented rollback flow for gateway
- one restore flow for Qdrant/data plane

## Phase 2: Gateway Contract Hardening

Goal:
- make `ai-gateway` a trusted shared dependency instead of an informal sidecar

### Cross-repo contract

`EU-Funds` expects:
- authenticated `POST /v1/chat/completions`
- authenticated `POST /v1/embeddings`
- stable error codes
- public minimal `/ready`
- authenticated diagnostic `/ready`

### EU-Funds work

Files:
- add `app/tests/integration/ai-gateway-contract.test.ts`
- update `docs/SYSTEM-TOPOLOGY.md`

Required tests:
- gateway URL and auth configuration validation
- chat success path
- embeddings success path
- timeout/fallback behavior
- failure path when gateway is unavailable

### ai-gateway work

This repo is outside the current writable root, but the required follow-up is:
- document FundEU compatibility explicitly
- keep readiness behavior stable
- ensure embeddings stay release-gated
- make tenant policy rollout explicit

Recommended ai-gateway files:
- `docs/FUNDEU-CONTRACT.md`
- `docs/RELEASE-PROCESS.md`
- `docs/COMPATIBILITY.md`

Acceptance criteria:
- `EU-Funds` can validate gateway compatibility in CI or pre-release
- gateway release notes explicitly call out FundEU-impacting changes

## Phase 3: RAG as a Data Product

Goal:
- convert current retrieval functionality and local scripts into a governed knowledge system

### Canonical source model

Every ingested document/chunk must carry:
- source system
- source URL or origin path
- content hash
- program code
- call code
- document type
- language
- ingestion timestamp
- embedding model and version
- review status
- review notes or reviewer id
- retention/deletion markers

### EU-Funds files to update

Primary code:
- `app/src/lib/rag/pipeline.ts`
- `app/src/lib/vectors/store.ts`
- `app/src/lib/ai/knowledge/ingestor.ts`
- `app/src/app/api/admin/ingest-call/route.ts`
- `app/src/app/api/v1/admin/knowledge/ingest/route.ts`
- `app/src/app/api/auth/account/route.ts`

Operational scripts:
- `app/scripts/classify-documents.ts`
- `app/scripts/bulk-ingest-rag-knowledge.ts`
- `app/scripts/direct-ingest-guides.ts`
- `app/scripts/generate-knowledge-vault.ts`
- `app/scripts/create-reviewer-sheet.ts`

### Required improvements

1. Add provenance and freshness to retrieval results
- source identity
- ingestion time
- reviewed/unreviewed state
- stale-data indicator

2. Add a review stage for classification output
- low-confidence documents must be reviewable before publish to RAG
- reviewed artifacts should be tracked separately from raw script output

3. Define reindex strategy
- when embedding model changes
- when chunking changes
- when metadata schema changes

4. Add deletion consistency
- DSAR/account erasure should include vectors, documents, and derived knowledge artifacts where applicable

Acceptance criteria:
- no RAG chunk is effectively anonymous
- answer sources have traceable origin and freshness
- ingestion can be replayed or rolled back with auditability

## Phase 4: NotebookLM and Obsidian Operationalization

Goal:
- keep the knowledge workflows valuable without turning them into unmanaged shadow infrastructure

### Positioning

Obsidian:
- internal knowledge base and analyst workspace

NotebookLM:
- internal source exploration and synthesis layer

FundEU app:
- customer-facing system of record

### Required process

1. Classification
- raw documents are scanned and classified

2. Review
- low-confidence or sensitive classifications are manually reviewed

3. Publish
- approved documents go to RAG

4. Internal knowledge export
- optional Obsidian notes
- optional NotebookLM upload guides

### Files to standardize
- `app/scripts/classify-documents.ts`
- `app/scripts/generate-knowledge-vault.ts`
- `app/scripts/create-reviewer-sheet.ts`
- `CLAUDE.md` sections on ingestion and NotebookLM

### Required controls
- generated outputs remain gitignored
- absolute workstation paths do not become durable shared artifacts
- notebook source manifests are tracked
- generated vaults are reproducible from source manifests

Acceptance criteria:
- NotebookLM/Obsidian flows can be re-run from reviewed source manifests
- internal research artifacts are clearly separated from production runtime assets

## Phase 5: VM Formalization

Goal:
- define the new VM as an intentional subsystem

### Recommended VM role

Host these components:
- Qdrant
- batch classification output staging
- ingestion workers or scheduled ingestion jobs
- reindex/rebuild jobs
- optional internal export generation for Obsidian/NotebookLM

Do not host:
- public customer-facing app traffic
- mixed ad hoc operational scripts with no logging or service boundaries

### VM runbook requirements

Must document:
- hostname / purpose
- running services
- startup method
- data paths
- disk sizing and growth policy
- backup cadence
- restore drill
- network policy
- patching cadence
- access controls
- alerting

Acceptance criteria:
- VM can be recreated from documentation
- Qdrant data has a tested backup/restore path
- exposure surface is private and minimal

## Phase 6: Product and Domain Correctness

Goal:
- ensure FundEU does not over-trust AI for hard funding/compliance logic

### Required work

1. Introduce deterministic rules alongside AI

Examples:
- org-type eligibility
- budget ceilings
- region constraints
- call status
- hard legal thresholds

2. Restrict AI to advisory mode where appropriate
- proposal drafting: allowed
- legal verdicts: not AI-only
- compliance score: must show deterministic basis and source evidence

3. Improve user-visible trust
- show source freshness
- show reviewed vs unreviewed content
- show when no deterministic rule covers a claim

Suggested file areas:
- `app/src/app/api/ai/check-eligibility/route.ts`
- `app/src/lib/ai/compliance-validator.ts`
- `app/src/lib/ai/compliance-engine.ts`
- `app/src/app/api/v1/projects/[id]/compliance/route.ts`
- `app/src/app/api/v1/projects/[id]/compliance/ai-score/route.ts`

Acceptance criteria:
- hard eligibility logic is not delegated entirely to AI/RAG
- compliance-critical output has traceable basis

## Phase 7: Security and Observability Completion

Goal:
- close the highest-risk security gaps without adding more architecture drift

### Required EU-Funds follow-up
- restore secret-like redaction and prompt-leak filtering in `app/src/lib/ai/sanitize.ts`
- complete SSRF protections in `app/src/lib/connectors/crawler-engine.ts`
- tighten admin/operational endpoints and route-level tests
- add observability for:
  - gateway dependency failures
  - vector store failures
  - ingestion failures
  - stale data states

Acceptance criteria:
- AI output sanitization covers PII and secret/system leakage risks
- crawler SSRF protections cover more than literal IPv4 private ranges
- alerting exists for gateway, Qdrant, and ingestion failure modes

## Immediate P0 Checklist

Complete these first:
- fix `.github/workflows/deploy-production.yml`
- reconcile `scripts/setup-gcp.sh` with the actual deploy contract
- write `docs/SYSTEM-TOPOLOGY.md`
- write `docs/VM-RUNBOOK.md`
- add `app/tests/integration/ai-gateway-contract.test.ts`
- define and document the VM role
- define canonical RAG provenance metadata

## P1 Checklist

- add `docs/RAG-OPERATING-MODEL.md`
- add `docs/KNOWLEDGE-OPS.md`
- add reviewed classification workflow
- add stale-data and provenance exposure in retrieval paths
- finalize gateway compatibility and release coordination docs

## P2 Checklist

- deterministic rules engine expansion
- richer observability and SLO alignment
- full reindex/runbook support
- tighter NotebookLM/Obsidian reproducibility and manifests

## Notes

- This plan intentionally treats NotebookLM and Obsidian as important internal capabilities, but not as silent runtime dependencies.
- This plan intentionally treats the VM as a core production subsystem because stateful knowledge operations are strategically important and do not fit cleanly inside stateless Cloud Run request handlers.
- `ai-gateway` follow-up is included here for system completeness, but edits to that repo require a writable-root or approval change in this environment.

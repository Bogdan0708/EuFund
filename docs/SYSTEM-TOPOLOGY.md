# System Topology

Date: 2026-03-11
Status: target operating model for FundEU production hardening, aligned to current live GCP footprint

This document describes the intended runtime topology for FundEU based on the current codebase, deployment workflows, and shared dependencies.

It replaces stale assumptions that still appear elsewhere in the repo:
- AWS staging as the primary reference model
- Kubernetes as the active production target
- loosely defined AI/RAG ownership
- undocumented VM responsibilities

## 1. Runtime Overview

Known live footprint in project `eufunding` as of 2026-03-11:
- Cloud Run: `fondeu-platform` in `europe-west2`
- Cloud Run: `ai-gateway` in `europe-west2`
- Cloud Run: `primaria` in `europe-central2`
- Cloud SQL: `fondeu-postgres-prod` in `europe-west2`
- Compute Engine VM: `fondeu-qdrant` in `europe-west2-b`
- Persistent disk: `fondeu-qdrant`

Important current risk:
- `fondeu-qdrant` is currently running as a container-optimized VM on the `default` network with `qdrant/qdrant:v1.12.6`
- Qdrant ingress on `6333` is now restricted to the `fondeu-vpc-connector` CIDR `10.8.0.0/28`
- FundEU uses the internal Qdrant address `http://10.154.0.3:6333`
- the VM disk now has daily snapshots via policy `daily-backups`
- the VM still has an external IP, which should be reviewed for necessity even though Qdrant is no longer public

FundEU should be operated as four distinct layers:

1. Product runtime
- customer-facing web app and API surface
- owned by `EU-Funds`
- deployed on GCP Cloud Run

2. AI control plane
- shared chat/completion/embedding gateway
- owned by `ai-gateway`
- deployed independently on GCP Cloud Run

3. Knowledge data plane
- vector database and batch knowledge operations
- owned by FundEU platform ops
- hosted on the new VM

4. Internal knowledge operations
- analyst workflows for classification review, Obsidian exports, NotebookLM preparation
- internal only
- run from the VM or a controlled operator workstation, never from customer request paths

## 2. Component Map

### Public edge

Components:
- public FundEU URL
- TLS termination
- CDN / DNS if configured externally

Responsibilities:
- route user traffic to FundEU app
- provide TLS and domain stability

Notes:
- this document does not assume Cloudflare is mandatory
- if a CDN is used, ownership and configuration should be documented separately

### FundEU application runtime

Repo:
- `EU-Funds`

Runtime:
- Cloud Run service: `fondeu-platform`

Primary responsibilities:
- auth and session-backed user flows
- organizations, members, projects, documents, approvals, billing
- app APIs and dashboards
- customer-facing AI features
- orchestration of RAG-backed retrieval

Key runtime dependencies:
- Cloud SQL PostgreSQL
- Redis / Memorystore
- GCS buckets
- `ai-gateway`
- Qdrant on VM

Relevant files:
- `cloudbuild.production.yaml`
- `scripts/setup-gcp.sh`
- `app/src/app/api/**`
- `app/src/lib/db/**`
- `app/src/lib/ai/**`
- `app/src/lib/rag/**`
- `app/src/lib/vectors/store.ts`

Deployment note:
- GitHub Actions is retained for CI only
- production deployments run through GCP Cloud Build

### Shared AI gateway

Repo:
- `ai-gateway`

Runtime:
- Cloud Run service for provider routing and embeddings

Primary responsibilities:
- authenticated unified AI endpoint
- provider routing
- concurrency limiting
- tenant policy enforcement
- readiness diagnostics
- embeddings endpoint used by FundEU retrieval/indexing flows

FundEU integration points:
- `app/src/lib/ai/client.ts`
- `app/src/lib/ai/providers/gateway.ts`
- `app/src/app/api/ai/wizard/chat/route.ts`

Operational rule:
- gateway releases must be validated against FundEU chat and embeddings usage before promotion

### Relational data plane

Primary store:
- Cloud SQL PostgreSQL

Used for:
- users
- organizations and memberships
- projects and workflow state
- audit records
- billing state
- document metadata
- funding/program metadata

Ownership:
- FundEU app

Critical properties:
- authoritative store for customer and workflow state
- migrations must be release-gated
- restore path must be tested before production rollouts are considered safe

### Cache and rate-limit store

Primary store:
- Redis / Memorystore

Used for:
- AI rate limiting
- cache
- session-adjacent or abuse-control workloads

Ownership:
- FundEU app

Critical properties:
- some AI routes are fail-closed if Redis is unavailable
- Redis availability is therefore part of customer-facing product correctness, not an optional optimization

### Object storage

Primary store:
- GCS buckets

Used for:
- uploaded documents
- generated assets
- backups or export artifacts where applicable

Ownership:
- FundEU app

### Knowledge data plane on VM

Host class:
- the new VM `fondeu-qdrant`

Expected responsibilities:
- Qdrant
- stateful vector storage
- batch classification output staging
- controlled ingestion jobs
- reindex jobs
- optional generation of internal Obsidian / NotebookLM export artifacts

Must not be treated as:
- a general-purpose shell box for undocumented ad hoc operations
- a substitute for customer-facing app infrastructure

Ownership:
- FundEU platform ops

Current known facts:
- zone: `europe-west2-b`
- machine type: `e2-small`
- persistent disk: `fondeu-qdrant`, 20 GB
- created: 2026-03-10
- boot image: `cos-stable-121-18867-381-24`
- runtime form: container-optimized single-container VM
- container image: `qdrant/qdrant:v1.12.6`
- network: `default`
- internal Qdrant route: `10.154.0.3:6333`
- external IP: still present, but Qdrant ingress is no longer public
- backup plan: `daily-backups`, daily at 04:00 UTC, 7-day retention

## 3. Data Flows

### A. Customer app flow

User -> FundEU Cloud Run -> Cloud SQL / Redis / GCS

Used for:
- login
- project editing
- approvals
- billing
- document management

### B. AI completion flow

User -> FundEU Cloud Run -> `ai-gateway` -> upstream AI providers

Fallback path:
- some code paths in FundEU can fall back to direct provider routing if gateway is unavailable

Operational implication:
- this fallback must be intentional and observable, not silent architectural drift

### C. RAG retrieval flow

User -> FundEU Cloud Run -> embeddings generation -> Qdrant on VM -> retrieved chunks -> FundEU response generation

Current network path:
- FundEU Cloud Run reaches Qdrant over the VPC connector path
- Qdrant ingress is restricted to the connector CIDR `10.8.0.0/28`

Used for:
- chat assistance
- wizard flows
- compliance and analysis helpers
- proposal generation with contextual evidence

Operational implication:
- Qdrant availability and metadata quality directly affect product trust
- retrieval traffic no longer traverses the public internet

### D. Knowledge ingestion flow

Source documents -> classification -> review -> RAG publish -> optional internal exports

Sources include:
- uploaded guidance or call documents
- crawled/public funding sources
- EUR-Lex or other legal sources
- curated internal knowledge

Publishing outputs:
- vectors in Qdrant
- metadata in FundEU-owned records where appropriate
- optional Obsidian notes and NotebookLM guides for internal teams

## 4. Trust Boundaries

### Customer-visible production boundary

Customer-visible:
- FundEU app
- customer APIs
- customer documents and project state
- customer-facing AI outputs

Internal-only:
- raw classification outputs
- reviewer sheets
- NotebookLM source manifests
- Obsidian vault exports
- internal research notebooks

Rule:
- internal knowledge artifacts must never become silent runtime dependencies for the customer product

### Stateful boundary

Stateless:
- Cloud Run app
- Cloud Run AI gateway

Stateful:
- Cloud SQL
- Redis
- GCS
- Qdrant on VM

Rule:
- stateful backup, restore, and data-retention obligations must be documented separately for each store

## 5. Ownership Model

### EU-Funds repo

Owns:
- product runtime
- business logic
- auth, billing, org/project workflows
- app-side AI orchestration
- product-side RAG integration
- production deployment workflow for FundEU app

### ai-gateway repo

Owns:
- provider routing
- tenant policy
- upstream provider auth and readiness
- embeddings/chat API contract
- production deployment workflow for gateway

### VM operations

Owns:
- Qdrant runtime
- vector persistence
- ingestion/reindex scheduling
- internal knowledge artifact generation environment

## 6. Monitoring and Health Expectations

### FundEU Cloud Run

Minimum health expectations:
- `/api/health` for liveness and broad service summary
- `/api/ready` for deployment readiness

Operational requirement:
- readiness must not be so rate-limited that infrastructure checks can trip it accidentally

### AI gateway

Health model:
- public `/health` cheap and shallow
- public `/ready` minimal
- authenticated `/ready` diagnostic and provider-aware

### VM / Qdrant

Required health coverage:
- process/service availability
- disk usage
- memory usage
- query latency
- backup freshness
- reindex/ingestion job status

## 7. Non-Negotiable Operating Rules

1. Cloud Run app is the customer-facing runtime.
2. `ai-gateway` is the shared AI control plane and must be treated as a versioned dependency.
3. The VM is the stateful knowledge subsystem, not a vague operations convenience.
4. Qdrant is production infrastructure and must have backup/restore ownership.
5. NotebookLM and Obsidian workflows are internal-only.
6. Hard funding/compliance rules must not depend solely on AI or RAG.
7. Retrieval results must carry provenance and freshness metadata before FundEU is considered production-grade.

## 8. Immediate Follow-Up Documents

This topology doc depends on:
- `docs/VM-RUNBOOK.md`
- `docs/RAG-OPERATING-MODEL.md`
- `docs/KNOWLEDGE-OPS.md`

And should be referenced by:
- deploy docs
- production runbooks
- gateway compatibility docs

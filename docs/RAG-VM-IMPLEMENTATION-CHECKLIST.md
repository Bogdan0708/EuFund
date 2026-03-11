# RAG and VM Implementation Checklist

## Purpose

This checklist converts the architecture and operating docs into executable work. It is intentionally biased toward release gating and operational safety, not feature breadth.

## P0: Production Safety

### 1. Confirm the VM role in reality

Target:

- the VM is the only stateful runtime for Qdrant and batch knowledge jobs

Actions:

- inventory installed services
- inventory mounted data paths
- inventory scheduled jobs
- inventory firewall rules and public exposure
- inventory backup configuration

Acceptance:

- [VM-RUNBOOK.md](/home/godja/Dev/EU-Funds/docs/VM-RUNBOOK.md#L1) matches the actual machine
- Qdrant is not publicly reachable
- service ownership is explicit
- backup schedule or snapshot procedure is configured
- remaining external-IP/default-network posture is either removed or explicitly justified

### 2. Enforce production gateway dependency

Target:

- FundEU production deploy fails if the shared AI gateway is unavailable or misconfigured

Actions:

- inject `AI_GATEWAY_URL` in deploy runtime
- verify gateway `/health`
- verify authenticated gateway `/ready`

Acceptance:

- production workflow fails before declaring success if gateway is not healthy/ready

### 3. Close the staging architecture drift

Target:

- staging deployment model matches the current GCP/Cloud Run production direction

Actions:

- decide whether staging remains on AWS/ECS or moves to GCP
- remove stale deployment assumptions
- ensure smoke tests match the chosen platform

Acceptance:

- there is one maintained staging deploy path
- outdated staging infra is either removed or explicitly marked legacy

### 3a. Harden the live Qdrant VM

Target:

- `fondeu-qdrant` is production-safe as a stateful knowledge dependency

Actions:

- preserve internal-only ingress on `6333` from `10.8.0.0/28`
- decide whether the external IP should be removed entirely
- replace default-network assumptions with documented firewall rules
- validate disk snapshot recovery and Qdrant restore automation
- confirm whether the VM is Qdrant-only or also hosts ingestion jobs

Acceptance:

- internet exposure is understood and controlled
- backup posture exists
- the VM role is explicit

## P1: Governed RAG Publishing

### 4. Define the ingestion manifest schema

Target:

- every ingestion batch is traceable and reversible

Actions:

- add a manifest file format for batch runs
- include source hash, operator, timestamps, model version, chunking version, and target collection
- persist manifest ids with publish logs

Acceptance:

- no production publish occurs without a manifest id
- one manifest can identify every document/chunk added by a batch

### 5. Add review-state enforcement

Target:

- low-trust or unreviewed content does not silently enter high-confidence retrieval flows

Actions:

- add `review_status` and `trust_tier` enforcement in retrieval filters
- distinguish `official_reviewed` from `official_unreviewed`
- block high-confidence user-facing flows when only weak sources are available

Acceptance:

- app retrieval code filters by trust/review state
- UI surfaces unreviewed/stale states clearly

### 6. Add reindex and rollback mechanics

Target:

- embedding model or chunking changes are handled as data migrations

Actions:

- version Qdrant collections
- add alias-based cutover or equivalent
- document rollback by manifest id or collection version

Acceptance:

- one bad batch can be removed without manual vector surgery

## P1: Product Surface

### 7. Expose provenance in FundEU UX

Target:

- users can see why an AI answer should be trusted

Actions:

- show source title
- show source date
- show review state
- show stale indicator

Acceptance:

- customer-facing AI answers do not appear as uncited authoritative claims

### 8. Separate analyst tooling from product truth

Target:

- NotebookLM and Obsidian stay internal

Actions:

- keep generated exports outside application runtime paths
- require publish manifests before any derivative content reaches RAG
- document approved export/import flows

Acceptance:

- no product runtime depends on NotebookLM or Obsidian artifacts

## P2: Observability

### 9. Add knowledge pipeline telemetry

Target:

- ingestion and retrieval failures are visible before users report them

Actions:

- emit batch ids
- emit chunk/document counts
- emit failed document counts
- emit stale-source retrieval counts
- alert on repeated ingestion failures

Acceptance:

- operators can answer “what was published, when, by whom, and from which source set?”

### 10. Add post-deploy smoke coverage

Target:

- release validation covers the shared dependencies and critical AI flows

Actions:

- validate app `/api/health`
- validate gateway dependency checks
- validate one document-upload path
- validate one retrieval path against Qdrant-backed configuration

Acceptance:

- release failure is detected in CI/CD instead of by users

## Suggested File Targets

- [.github/workflows/deploy-production.yml](/home/godja/Dev/EU-Funds/.github/workflows/deploy-production.yml#L1)
- [.github/workflows/deploy-staging.yml](/home/godja/Dev/EU-Funds/.github/workflows/deploy-staging.yml#L1)
- [scripts/setup-gcp.sh](/home/godja/Dev/EU-Funds/scripts/setup-gcp.sh#L1)
- [app/src/lib/rag/pipeline.ts](/home/godja/Dev/EU-Funds/app/src/lib/rag/pipeline.ts#L1)
- [app/src/lib/vectors/store.ts](/home/godja/Dev/EU-Funds/app/src/lib/vectors/store.ts#L1)
- [app/src/lib/ai/knowledge/ingestor.ts](/home/godja/Dev/EU-Funds/app/src/lib/ai/knowledge/ingestor.ts#L1)
- [app/src/app/api/health/route.ts](/home/godja/Dev/EU-Funds/app/src/app/api/health/route.ts#L1)
- [docs/VM-RUNBOOK.md](/home/godja/Dev/EU-Funds/docs/VM-RUNBOOK.md#L1)
- [docs/RAG-OPERATING-MODEL.md](/home/godja/Dev/EU-Funds/docs/RAG-OPERATING-MODEL.md#L1)
- [docs/KNOWLEDGE-OPS.md](/home/godja/Dev/EU-Funds/docs/KNOWLEDGE-OPS.md#L1)

# Knowledge Operations

## Purpose

FundEU now has multiple knowledge workflows:

- document classification
- RAG ingestion
- analyst notes
- NotebookLM workspaces
- Obsidian vault exports

Without an explicit operating model, these workflows create silent data drift, hidden dependencies, and unreviewed AI output entering product decisions. This document defines the boundary and rules.

## Canonical Roles

1. FundEU app
- system of record for customer-facing workflows
- surfaces approved knowledge to users

2. Knowledge VM
- execution home for batch classification, ingestion, export, and reindex jobs
- stores working artifacts outside the web runtime

3. Obsidian
- analyst knowledge workspace
- suitable for reviewed internal notes, mappings, and synthesis

4. NotebookLM
- analyst augmentation tool for exploration and summarization
- not a source of truth

## Mandatory Principle

NotebookLM and Obsidian outputs are derivative artifacts. They are never authoritative on their own. Official source documents and explicitly reviewed internal notes remain the governing inputs.

## Approved Workflow

1. Acquire official or approved internal source.
2. Run classification on the knowledge VM.
3. Produce a manifest containing:
- source path
- source hash
- program/call mapping
- operator
- run timestamp
- classifier version
- confidence

4. Route low-confidence or high-impact items for review.
5. Publish reviewed content to RAG.
6. Optionally generate:
- Obsidian notes for analyst workflows
- NotebookLM upload packs for research workflows

## Working Directory Rules

Do not treat local workstation folders as durable production infrastructure.

Recommended VM-owned paths:

- `/srv/fondeu/knowledge/raw`
- `/srv/fondeu/knowledge/processed`
- `/srv/fondeu/knowledge/manifests`
- `/srv/fondeu/knowledge/obsidian-export`
- `/srv/fondeu/knowledge/notebooklm-export`
- `/srv/fondeu/qdrant`

Generated artifacts should stay out of the main product repo unless they are deliberate, reviewed documentation.

## Review Rules

Human review is required for:

- low-confidence classification
- call eligibility mappings
- legal or compliance-sensitive summaries
- status or deadline extraction used in customer-facing flows
- any AI-generated content promoted into shared knowledge

## Publication Rules

Only reviewed or explicitly tolerated content can move into serving collections.

Every publish action must record:

- operator or service identity
- manifest id
- target collection/version
- document count
- review status summary
- timestamp

## Failure Modes To Prevent

The following are considered unacceptable:

- NotebookLM output copied into product truth without review
- Obsidian notes treated as official evidence
- local one-off scripts publishing directly into production vectors
- no way to identify which source created a chunk
- no way to remove a poisoned or wrong ingestion batch
- no distinction between archived and active calls

## Operational Checklist

Before running a batch knowledge job:

- verify source set
- verify output directory
- verify target environment
- verify embedding model/version
- verify manifest destination
- verify publish mode is not implicitly production

After running a batch knowledge job:

- record job outcome
- inspect failed documents
- inspect low-confidence items
- review publish manifest
- verify retrieval quality against known queries

## Product Guardrails

Customer-facing FundEU features must:

- cite sources for important claims
- warn on unreviewed or stale knowledge
- avoid making compliance claims from generated notes alone
- preserve user trust by making provenance visible

## Release Gate

Knowledge operations are only production-grade when:

- the VM is the operational home for batch work
- manifests exist for every publish batch
- review rules are enforced
- derivative tooling remains clearly separated from the source-of-truth path

# RAG Operating Model

## Purpose

FundEU retrieval-augmented generation is a governed knowledge system, not a generic AI feature. The goal is to retrieve current, attributable, reviewable funding information without turning unofficial or stale content into product truth.

This document defines the operating model for:

- source ingestion
- chunking and embeddings
- Qdrant collection management
- provenance and freshness
- review and publishing
- rollback and reindexing

## System Boundary

RAG spans multiple runtimes:

- FundEU app on Cloud Run:
  - serves retrieval-backed user experiences
  - displays provenance, freshness, and review state
  - must not perform batch ingestion inside request paths
- `ai-gateway`:
  - optional shared control plane for chat and embeddings
  - must expose stable `/v1/chat/completions` and `/v1/embeddings` contracts
- Knowledge VM:
  - owns Qdrant, ingestion workers, reindexing, and knowledge exports
  - is the correct home for stateful or long-running RAG operations
- Internal knowledge tooling:
  - Obsidian and NotebookLM are analyst workflows only
  - they must not become hidden runtime dependencies for the customer-facing app

## Trust Model

Not all retrieved content has the same trust level. Every document and chunk must be assigned one of these tiers:

1. `official_reviewed`
- Official program guide, call text, annex, FAQ, or legal text
- Reviewed by a human operator before publish
- Can be used in high-confidence answers

2. `official_unreviewed`
- Official source, but not yet reviewed
- Can support discovery and analyst workflows
- Must be flagged in customer-facing responses

3. `internal_reviewed`
- Internal notes, templates, mappings, or playbooks
- Can support drafting, not compliance claims

4. `generated`
- AI-generated summaries, extracted notes, NotebookLM outputs
- Never treated as a source of truth
- Must not be cited as authoritative evidence

## Canonical Metadata Schema

Every ingested document must carry:

- `document_id`
- `source_system`
- `source_url`
- `source_type`
- `source_hash`
- `title`
- `language`
- `program_code`
- `call_code`
- `document_type`
- `published_at`
- `retrieved_at`
- `ingested_at`
- `review_status`
- `reviewed_by`
- `reviewed_at`
- `trust_tier`
- `embedding_model`
- `embedding_dimensions`
- `chunking_version`
- `tenant_scope`
- `retention_policy`

Every chunk must additionally carry:

- `chunk_id`
- `document_id`
- `chunk_index`
- `text_hash`
- `section_title`
- `page_ref`
- `effective_from`
- `effective_to`

## Publish Flow

The only acceptable publish flow is:

1. Acquire source document from an approved source.
2. Compute source hash and persist raw artifact.
3. Extract and classify metadata.
4. Chunk deterministically.
5. Generate embeddings with the current approved model.
6. Mark document as `draft` or `pending_review`.
7. Human-review low-confidence or high-impact content.
8. Publish to the serving collection only after review rules pass.

Do not publish directly from ad hoc scripts into the serving collection without a traceable manifest.

## Freshness Rules

Funding calls, annexes, FAQs, and legal guidance go stale. Retrieval without freshness controls is unsafe.

Required controls:

- record `published_at`, `retrieved_at`, and `ingested_at`
- expose stale indicators in the FundEU UI
- prefer newer official documents over older internal summaries
- block customer-facing “high confidence” answers when only stale or unreviewed sources are available

## Retrieval Rules

The FundEU app must:

- filter by trust tier
- filter by review state
- filter by tenant scope when applicable
- prefer official reviewed sources
- return provenance with each answer
- show source title and date when rendering AI-supported conclusions

RAG must not silently mix:

- unrelated programs
- archived and active calls
- internal notes and official guidance
- unreviewed and reviewed content without visible distinction

## Reindex and Rollback

RAG changes are data migrations. Treat them that way.

Trigger a controlled reindex when:

- embedding model changes
- chunking logic changes
- metadata schema changes
- a poisoning or bad-ingestion event is detected

Minimum rollback requirements:

- versioned collection naming
- publish via alias swap or equivalent cutover
- manifest per ingestion batch
- ability to remove one document set by `source_hash` or manifest id

## Security Requirements

RAG is an injection surface.

Required controls:

- sanitize extracted text before downstream prompting
- do not trust instructions embedded in source documents
- preserve raw source separately from prompt-safe text
- never expose secrets or internal system prompts in retrieval results
- restrict Qdrant network access to private consumers only

## Observability

At minimum, record:

- ingestion job id
- document count
- chunk count
- embedding model/version
- failed document count
- low-confidence classification count
- publish count
- retrieval hit rate
- stale-source answer count

## Release Gate

No RAG change is production-ready unless all of the following are true:

- canonical metadata is populated
- provenance is visible in the app
- stale/unreviewed states are surfaced
- reindex and rollback paths are documented
- the VM owns the stateful ingestion/runtime responsibilities

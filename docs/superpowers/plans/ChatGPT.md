I reviewed your uploaded redesign plan in detail. The direction is strong: the move to a two-page product, a 7-step orchestrator, streaming UX, funding discovery, and project export gives FondEU a much sharper product shape than a classic dashboard. The plan is also unusually implementation-ready, with phased dependencies, schema work, agent boundaries, tests, and migration notes already thought through. 

My headline view: **the plan is good enough to build, but not yet good enough to scale safely**. The biggest gaps are not in the UI or even the orchestrator idea; they are in durability, trust/compliance, evaluation, cost control, and operational workflow around human review. The current plan is strongest on feature decomposition and weakest on platform guarantees. 

## What is already strong

The plan has five major strengths.

First, the product simplification is correct. Moving from a multi-page dashboard to **Chat + Projects** is a strong UX decision because the user’s real job is not “manage software,” it is “find funding and produce an application.” The 7-step flow maps well to that job-to-be-done. 

Second, the plan separates concerns fairly well: schema/auth, gateway streaming, billing, orchestrator, discovery, export, then UI. That ordering is sane and reduces frontend rework. 

Third, the plan already anticipates several subtle implementation issues: Redis pub/sub for SSE bridging, JSONB defaults, enum migration edge cases, structured messages, post-completion edit mode, and session cleanup. That shows good engineering judgment. 

Fourth, the agent breakdown is practical. In particular, splitting match, validate, research, plan, and build is better than one giant “do everything” prompt, and it gives you good future control points for caching, fallback, human approval, and model routing. 

Fifth, the discovery pipeline plus human review loop is strategically important. It can become one of the platform’s real moats if you keep data freshness and call verification better than generic chatbots. 

## The main things missing or under-specified

### 1) Durable orchestration is not strong enough yet

Right now the plan uses a custom engine with DB state plus Redis/SSE mechanics. That can work, but for long-running, human-in-the-loop flows, retries, timeouts, resumptions, and partial failure handling become painful fast. Your plan talks about checkpoints and pause/resume, but it still behaves mostly like an app-level state machine, not a durable workflow runtime.

This is the single biggest architectural risk.

**Improvement:** introduce a true durable workflow layer for the orchestrator core.

Best options:

* **Temporal** if you want maximum execution guarantees, retries, resumability, and auditability. Temporal’s docs explicitly position workflows as durable execution that survives crashes and resumes from event history. ([docs.temporal.io][1])
* **LangGraph** if you want a more agent-native model with persistence, interrupts, human-in-the-loop, and checkpointing built around graph state. Its docs explicitly support interrupts, persistence, and durable execution for long-running agent flows. ([LangChain Docs][2])

My recommendation for FondEU:

* Keep your current DB schema.
* Replace only the **engine execution layer** with Temporal or LangGraph.
* Leave UI, billing, auth, and most agents intact.

That would reduce a lot of hidden complexity around session resurrection, duplicate runs, retries, step replay, dead-letter handling, and stuck jobs.

### 2) Human review is present, but trust workflow is still too weak

The plan has checkpoints at match and plan, and discovery has pending review. That is good, but for an EU-funding product you need more explicit “trust states.”

Right now the system can research a call, chunk results into Qdrant, mark them `verified: false`, and then proceed toward building application content. That risks blending verified and non-verified knowledge too early. 

**Improvement:** add a trust model with explicit evidence states:

* `official_verified`
* `official_unverified_parse`
* `secondary_source`
* `ai_inferred`
* `user_provided`
* `stale_needs_recheck`

And then enforce policy such as:

* matching may use mixed evidence
* validation must prefer official sources
* build/export may only cite `official_verified` + user-provided + explicitly approved inferred content

This is a big product trust upgrade.

### 3) No formal evaluation framework

You have test-first code scaffolding, but no real **system evaluation plan**. For this platform, you need more than unit tests. You need regression scoring for:

* match quality
* false positives on eligibility
* research completeness
* citation accuracy
* document section quality
* export correctness
* hallucination rate
* freshness drift

**Improvement:** add an `evals/` layer with golden datasets:

* 30–50 real historical funding calls
* 50 raw project ideas
* expected top-3 matches
* expected must-have documents
* expected warnings
* expected application section rubrics

Then track metrics like:

* Top-3 match hit rate
* validation precision
* missing requirement rate
* section acceptance by human reviewer
* average cost per completed project
* average human correction minutes per workflow

Without this, the platform will improve by intuition instead of evidence.

### 4) Compliance and legal posture are too thin

The plan rewrites RLS and simplifies auth, which is good, but there is not enough around:

* data retention
* deletion rules
* consent boundaries
* source traceability
* legal disclaimers
* generated-content provenance
* role separation for admin review
* export audit history

RLS is necessary, but it is not the same as compliance. 

**Improvement:**
Add these entities or capabilities:

* `evidence_records`
* `source_snapshots`
* `user_approvals`
* `export_audit`
* `retention_policies`
* `processing_purpose`
* `data_lineage` per generated section

For every generated section, store:

* prompt version
* model/provider
* source evidence ids
* timestamp
* reviewer status
* confidence score

That will matter later if municipalities, consultants, or enterprise customers want explainability.

### 5) Retrieval design is too light for a funding platform

The plan uses Qdrant and embeddings for knowledge retrieval, which is fine, but it does not specify retrieval quality controls. For this product, naive vector search is not enough.

**Improvement:**
Use a hybrid retrieval stack:

* lexical/BM25
* vector search
* metadata filters
* reranker
* evidence freshness weighting

Metadata should include:

* programme
* subprogramme
* region
* applicant type
* min/max budget
* submission window
* source type
* verification status
* last checked at
* language
* document section type

This will sharply improve match precision and research grounding.

### 6) Cost governance is not robust enough

The plan has tiers and usage counters, but not **real cost governance**. Redis counters are useful for quotas, but they do not manage model spend, token burn, or runaway workflows well. 

**Improvement:**
Add:

* per-step cost budgets
* provider fallback ladders
* max retry budgets
* dynamic model routing by task criticality
* per-session spend ceilings
* org/user profitability dashboards

Example routing:

* Enhance: cheap fast model
* Match: cheap model + reranker
* Validate: web/search-heavy, low creativity
* Research summary: medium model
* Build final export: premium model only after approval

That will protect margins.

### 7) Export is underspecified

The plan says “Project Builder & Export,” but I did not see enough detail on document generation quality, templates, reviewer mode, tracked changes, or versioned exports. 

**Improvement:**
FondEU should treat export as a product, not a file download.

Add:

* template families by programme
* reviewer mode with inline comments
* regenerated section diffing
* citation appendix
* evidence bundle export
* submission checklist export
* Romanian + English export packs
* DOCX plus structured JSON canonical representation

The canonical JSON model is important. DOCX/PDF should be render targets, not the source of truth.

### 8) Discovery pipeline needs source quality and freshness rules

The plan uses crawlers + Perplexity sweep + duplicate hashing + admin review. Good start. But discovery needs ranking and decay logic, not just ingestion. 

**Improvement:**
Add source-level governance:

* source trust score
* crawl cadence by source importance
* parser health score
* freshness SLAs
* expiry confidence
* alert when official source content changes materially
* “call changed since last review” diffing

This is where the platform can become much better than generic search.

## Specific plan-level concerns I would change

There are a few places in the plan where I would directly change the implementation.

### A) Do not remove enterprise too casually

The plan keeps `enterprise` as deprecated and maps users to `ultra`. That is fine technically, but from a go-to-market point of view I would keep **enterprise as a commercial concept** even if it maps internally to another enum. 

Use:

* internal enum: `free | plus | pro | ultra`
* commercial packaging: `free | plus | pro | enterprise`

That gives you room for negotiated pricing later.

### B) Google + magic link is good, but add Microsoft

For this product, you will almost certainly want **Microsoft login** for municipalities, consultancies, and institutional buyers. The plan only mentions Google + email magic link. 

### C) Team model is too narrow

`team_members` is owner/member only. That is too limited for a serious funds workflow. 

You need roles like:

* owner
* editor
* reviewer
* compliance reviewer
* external consultant
* read-only client

And project-scoped permissions, not just owner-member relationship.

### D) Research should snapshot source artifacts

If research downloads guides and extracts requirements, you should preserve source snapshot metadata and hashes, not just extracted text and synthesized findings. That is not clear enough in the current plan. 

## New developments and tools I would leverage

These are the most useful additions today.

### Temporal or LangGraph for durable agent workflows

Both are highly relevant upgrades over a custom orchestrator loop. Temporal gives stronger workflow durability and operational rigor; LangGraph gives better agent-state ergonomics and interrupts. ([LangChain Docs][2])

### Vercel AI SDK for streaming + structured output ergonomics

Even if you keep your gateway, the Vercel AI SDK is useful for typed streaming, tool calling, and structured output patterns in Next.js. Its `streamText`, tool-calling support, and structured output helpers are very aligned with your chat/product flow. ([sdk.vercel.ai][3])

### OpenTelemetry GenAI semantic conventions

You already think architecturally, so this one matters. OTel now has GenAI semantic conventions for spans, events, and metrics. That is a strong fit for step-level tracing, token/cost observability, and audit views. ([OpenTelemetry][4])

### Reranking layer

Whether you use a hosted reranker or local cross-encoder, add reranking between retrieval and final call selection. That is one of the highest ROI quality improvements for match and research.

### Document extraction pipeline

For EU-funding work, PDFs are often ugly. You should make document ingestion a first-class subsystem with:

* OCR fallback
* layout-aware parsing
* table extraction
* section classification
* citation anchoring by page/paragraph

### Feature flags and experiment framework

You need safe rollout of:

* new prompts
* new step order
* model routing changes
* retrieval pipelines
* build templates

### Queueing and backpressure

Discovery, ingestion, long builds, and export jobs should not all run directly in web request lifecycle. Add a proper job queue if not already present.

## Product features I think you are overlooking

These are likely more important than they first look.

### 1) Eligibility pre-check wizard

Before deep orchestration, run a fast structured eligibility screen:

* applicant type
* geography
* legal form
* project size
* co-financing ability
* timeline readiness

This will cut wasted workflows and improve conversion.

### 2) Readiness score

Give the user a project readiness score:

* idea clarity
* eligibility fit
* documents readiness
* timing risk
* data gaps
* financial readiness

This becomes a sticky dashboard primitive.

### 3) “Why this call / why not this call”

The match step should explicitly explain both inclusion and exclusion. That builds trust and reduces support load.

### 4) Reviewer cockpit

You need an internal/admin view where a human can:

* inspect evidence
* approve discovery items
* correct match rationales
* edit requirement extraction
* sign off final exports

### 5) Application timeline/calendar

Turn the action plan into an actual timeline:

* deadlines
* reminders
* dependencies
* document requests
* collaborator assignments

### 6) Reusable organization memory

For repeat applicants, store reusable profile data:

* entity info
* past projects
* certifications
* boilerplate sections
* budgets
* team CVs
* attachments

This will massively reduce repeat effort.

### 7) Budget builder

The plan talks about build and export, but budgeting deserves its own module:

* cost categories
* eligibility rules
* co-financing
* scenario modeling
* red-flag validation

### 8) Submission pack completeness check

Before export, run a pre-flight check:

* mandatory annexes
* signatures
* formatting
* document dates
* budget consistency
* missing declarations

## Future development ideas

These are the best next-wave ideas after v1.

**FondEU Copilot for consultants:** one consultant managing 20–100 active applications with shared org memory, templates, and reviewer queues.

**Municipality edition:** specialized workflows for local authorities, infrastructure, social projects, and public procurement-linked funding.

**Funding radar:** continuously personalized discovery with explainable alerts and “new since yesterday” diffs.

**Application benchmarking:** compare a draft against previously funded project patterns and known scoring criteria.

**Consortium builder:** suggest partner types and missing consortium roles for larger programmes.

**Grant intelligence graph:** connect calls, regulations, guides, FAQs, corrigenda, and user projects into a knowledge graph, not just a vector store.

**Outcome memory:** learn from submitted, rejected, and funded applications to improve matching and section generation over time.

## My recommended revised priorities

If this were my roadmap, I would reorder slightly:

**Priority 1**

* durable workflow runtime
* evidence/trust model
* evaluation harness
* reviewer cockpit
* source snapshotting

**Priority 2**

* better retrieval + reranking
* budget builder
* role-based collaboration
* Microsoft auth
* cost governance

**Priority 3**

* consultant edition
* benchmarking
* consortium builder
* graph-based intelligence layer

## Bottom line

Your plan is already **better than a normal feature spec**. It is concrete, buildable, and product-aware. The biggest opportunity is not “more features.” It is making FondEU a **trustworthy durable workflow system for high-stakes funding work**, not just an AI chat app that happens to generate project documents. The current plan covers the core flow, schema changes, agent stages, discovery, billing tiers, and SSE mechanics well. What it still lacks is the heavier platform layer: durable execution, evidence provenance, evaluation, compliance-grade auditability, and human-review operations.

Here is the source plan I audited: 

I can turn this into a **revised v2 implementation roadmap** with “keep / change / add / defer” sections and a sharper architecture recommendation.

[1]: https://docs.temporal.io/workflows?utm_source=chatgpt.com "Temporal Workflow | Temporal Platform Documentation"
[2]: https://docs.langchain.com/oss/javascript/langgraph/interrupts?utm_source=chatgpt.com "Interrupts - Docs by LangChain"
[3]: https://sdk.vercel.ai/docs/reference/ai-sdk-core/stream-text?utm_source=chatgpt.com "AI SDK Core: streamText"
[4]: https://opentelemetry.io/docs/specs/semconv/gen-ai/?utm_source=chatgpt.com "Semantic conventions for generative AI systems"

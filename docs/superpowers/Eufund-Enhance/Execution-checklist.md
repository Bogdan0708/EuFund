 Execution Checklist

  Track 1
  Core orchestrator schema and persistence.

  1. Add new context fields in app/src/lib/ai/orchestrator/types.ts

  - callRequirementsProfile
  - applicationStructure
  - eligibilityAssessment
  - knowledgeSources
  - keep selectedCallId

  2. Initialize and persist them in app/src/lib/ai/orchestrator/engine.ts

  - create-session defaults
  - checkpoint persistence
  - auto-advance persistence
  - completion snapshot handling

  3. Update baseline unit coverage

  - app/tests/unit/orchestrator-types.test.ts
  - app/tests/unit/orchestrator-engine.test.ts

  Expected diff

  - Small, ~80-150 LOC.

  ———

  Track 2
  Call-document resolution.

  1. Create app/src/lib/ai/orchestrator/call-requirements/types.ts

  - document metadata types
  - normalized requirement/profile types

  2. Create app/src/lib/ai/orchestrator/call-requirements/resolve-call-documents.ts

  - resolve canonical guide
  - resolve annexes
  - resolve form/template docs
  - resolve corrigenda/legal basis

  3. Add deterministic matching rules first

  - exact sourceUrl
  - call code match
  - title + program normalization
  - version/date tie-breaker

  4. Add tests

  - app/tests/unit/call-document-resolution.test.ts

  Expected diff

  - Medium, ~200-350 LOC.

  ———

  Track 3
  Qdrant evidence retrieval for the selected call.

  1. Create retrieve-qdrant-evidence.ts

  - query by selected call title/program/code
  - filter to guide/annex/legal chunks
  - return normalized evidence objects

  2. Reuse existing RAG utilities where possible

  - avoid a second retrieval stack
  - keep selected-call retrieval separate from match-agent broad search

  3. Add tests

  - app/tests/unit/qdrant-call-evidence.test.ts

  Expected diff

  - Medium, ~150-250 LOC.

  ———

  Track 4
  Obsidian vault retrieval.

  1. Create retrieve-vault-knowledge.ts

  - search notes by program/call
  - rank by exact call relevance
  - normalize excerpts and note metadata

  2. Define merge behavior

  - vault notes enrich
  - guide/legal docs remain authoritative

  3. Add tests

  - app/tests/unit/vault-knowledge-retrieval.test.ts

  Expected diff

  - Medium, ~150-250 LOC.

  ———

  Track 5
  Research-agent refactor.

  1. Update app/src/lib/ai/orchestrator/agents/research.ts

  - resolve call docs
  - pull Qdrant evidence
  - pull vault knowledge
  - use web fallback only for gaps

  2. Create assemble-call-requirements.ts

  - produce CallRequirementsProfile
  - include provenance and version info

  3. Change research output shape

  - move away from loose prose summary
  - preserve rawFindings only as debug/fallback

  4. Add/update tests

  - app/tests/unit/agent-research.test.ts

  Expected diff

  - Large, ~250-450 LOC.

  ———

  Track 6
  Application-structure extraction.

  1. Create extract-application-structure.ts

  - exact section headings
  - order
  - subsections
  - mandatory/optional
  - limits/hints if present

  2. Create normalize-form-structure.ts

  - unify guide-derived vs form-derived structures

  3. Store structure in orchestrator context
  4. Add tests

  - app/tests/unit/application-structure-extraction.test.ts

  Expected diff

  - Medium-large, ~250-400 LOC.

  ———

  Track 7
  Eligibility integration.

  1. Inspect and adapt app/src/lib/rules/eligibility.ts

  - map call profile fields into deterministic inputs

  2. Create map-call-profile-to-eligibility-input.ts
  3. Update app/src/lib/ai/orchestrator/agents/validate.ts

  - run deterministic checks
  - keep AI validation as supplementary, not primary

  4. Add blocking/non-blocking result model

  - blockers
  - warnings
  - missing data

  5. Add/update tests

  - app/tests/unit/agent-validate.test.ts
  - new eligibility-integration.test.ts

  Expected diff

  - Medium, ~200-350 LOC.

  ———

  Track 8
  Knowledge-agent upgrade.

  1. Update app/src/lib/ai/orchestrator/agents/knowledge.ts

  - read existing knowledge first
  - merge with research output
  - append only novel findings

  2. Create merge-knowledge-sources.ts
  3. Add/update tests

  - app/tests/unit/agent-knowledge.test.ts

  Expected diff

  - Medium, ~150-250 LOC.

  ———

  Track 9
  Build-agent rewrite around exact structure.

  1. Update app/src/lib/ai/orchestrator/agents/build.ts

  - require applicationStructure
  - generate sections in exact order
  - use exact heading text

  2. Update app/src/lib/ai/orchestrator/prompts/build.ts

  - section-specific prompts
  - inject only relevant evidence and rules
  - forbid invented headings

  3. Preserve fallback behavior for malformed AI JSON

  - but only within validated structure constraints

  4. Add/update tests

  - app/tests/unit/agent-build.test.ts

  Expected diff

  - Large, ~250-450 LOC.

  ———

  Track 10
  Post-build structural validation.

  1. Create validate-generated-application.ts

  - required headings present
  - order correct
  - no invented top-level sections
  - eligibility blockers respected
  - annex/document completeness check

  2. Call it from build or orchestrator completion path
  3. Surface structured validation issues to UI/stream
  4. Add tests

  - app/tests/unit/generated-application-validation.test.ts

  Expected diff

  - Medium, ~180-300 LOC.

  ———

  Track 11
  Program adapters.

  1. Add adapters:

  - pnrr.ts
  - peo.ts
  - pocidif.ts
  - regional.ts

  2. Define adapter responsibilities

  - document naming patterns
  - annex conventions
  - section naming quirks
  - form mapping hints

  3. Add one fixture test per adapter

  - app/tests/unit/call-adapter-pnrr.test.ts
  - etc.

  Expected diff

  - Large, but parallelizable.

  ———

  Track 12
  Checkpoint and UX safeguards.

  1. Add post-research checkpoint

  - resolved guide title/version
  - extracted section outline
  - annex count
  - eligibility blockers/warnings

  2. Update app/src/hooks/useOrchestrator.ts if needed for richer checkpoint rendering
  3. Add tests

  - checkpoint payload shape
  - resume flow correctness

  Expected diff

  - Small-medium, ~100-180 LOC.

  ———

  Suggested delivery slices

  1. Schema + persistence + call resolution
  2. Qdrant retrieval + research refactor
  3. Structure extraction + eligibility
  4. Build refactor + post-build validation
  5. Vault integration + knowledge merge
  6. Program adapters + UX checkpoint polish

  Test checklist

  - Context persists selectedCallId, profile, structure, eligibility.
  - Research prefers Qdrant/vault over web fallback.
  - Structure extraction preserves exact headings.
  - Eligibility blocks bad applicants deterministically.
  - Build output follows extracted section order exactly.
  - Final validation catches missing headings/annexes.
  - Existing orchestrator unit suite stays green.

  Definition of done

  - Selected call resolves to concrete guide/form/legal documents.
  - Research returns structured call requirements, not generic prose.
  - Eligibility engine runs in-flow.
  - Build uses exact applicant-guide headings.
  - Vault and Qdrant both contribute context.
  - Generated output is structurally validated before completion.
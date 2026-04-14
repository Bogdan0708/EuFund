Implementation Plan

  Phase 1
  Build the data contract and thread it through the orchestrator.

  - Add CallRequirementsProfile to app/src/lib/ai/orchestrator/types.ts.
  - Extend WorkflowContext with:
      - selectedCallId
      - callRequirementsProfile
      - eligibilityAssessment
      - applicationStructure
      - knowledgeSources
  - Update app/src/lib/ai/orchestrator/engine.ts persistence so these fields survive checkpoints and auto-advance.
  - Keep the existing flow shape; do not add new steps yet.

  Deliverables

  - Strong TS types for the new context.
  - Session persistence working for the new fields.

  Tests

  - Update app/tests/unit/orchestrator-types.test.ts.
  - Add/extend app/tests/unit/orchestrator-engine.test.ts to confirm context persists across checkpoint advance.

  ———

  Phase 2
  Introduce call-document resolution as a deterministic service.

  - Create app/src/lib/ai/orchestrator/call-requirements/resolve-call-documents.ts.
  - Input: selected matched call plus any known sourceUrl, program, call code.
  - Output: canonical document set:
      - applicant guide
      - annex list
      - application form / MySMIS form references
      - corrigenda / amendments
      - legal basis docs
  - Prefer deterministic matching against existing metadata first; only use AI/web as fallback.
  - Record document version/date/source URL for each resolved artifact.

  Files

  - New: app/src/lib/ai/orchestrator/call-requirements/resolve-call-documents.ts
  - Likely helper: app/src/lib/ai/orchestrator/call-requirements/types.ts

  Tests

  - Add unit tests with:
      - exact URL hit
      - program/code match
      - ambiguous call name
      - no canonical docs found

  ———

  Phase 3
  Use Qdrant for specific-call legal and guide retrieval.

  - Create retrieval service for selected call documents, not generic funding search.
  - Query Qdrant using:
      - call title
      - program
      - call code
      - annex names
      - legal basis names
  - Retrieve chunks tagged as:
      - ghid
      - anexa
      - cerere
      - legislation
      - corrigendum
  - Normalize results into structured evidence objects.

  Files

  - New: app/src/lib/ai/orchestrator/call-requirements/retrieve-qdrant-evidence.ts
  - Reuse existing RAG pipeline under @/lib/rag/* where possible.

  Tests

  - Unit test chunk filtering/ranking.
  - Integration test against mocked retrieval result sets.

  ———

  Phase 4
  Add Obsidian vault retrieval.

  - Create a vault adapter that can search notes by:
      - program
      - call code/title
      - annex/form names
      - compliance and implementation terms
  - Normalize retrieved notes into knowledgeSources separate from legal/document evidence.
  - Mark each source as:
      - vault_note
      - qdrant_doc
      - web_fallback

  Files

  - New: app/src/lib/ai/orchestrator/call-requirements/retrieve-vault-knowledge.ts
  - Possibly new shared adapter if vault access already exists elsewhere.

  Tests

  - Unit test note ranking and normalization.
  - Verify vault hits do not overwrite authoritative call docs.

  ———

  Phase 5
  Refactor research agent into structured requirements assembly.

  - Replace the current mostly web-driven research output in app/src/lib/ai/orchestrator/agents/research.ts.
  - New behavior:
      - resolve call documents
      - retrieve Qdrant evidence
      - retrieve vault knowledge
      - use web fallback only for missing pieces
      - assemble CallRequirementsProfile
  - Output should include:
      - legal framework
      - annex checklist
      - exact form sections
      - mandatory documents
      - deadlines
      - source provenance

  Files

  - Update app/src/lib/ai/orchestrator/agents/research.ts
  - New assembly helper: assemble-call-requirements.ts

  Tests

  - Replace generic “found X requirements” expectations with profile-based assertions.
  - Add one test where Qdrant is empty and web fallback is used.

  ———

  Phase 6
  Extract actual application structure from guide/form documents.

  - Create a parser that converts resolved guide/form evidence into ordered section definitions.
  - Produce:
      - exact heading text
      - subsection nesting
      - required/optional flags
      - field hints / character limits if available
      - form mapping keys for MySMIS or equivalent
  - Store result in applicationStructure.

  Files

  - New: extract-application-structure.ts
  - New: normalize-form-structure.ts

  Tests

  - Unit tests for:
      - exact headings preserved
      - ordering preserved
      - missing headings handled
      - generic fallback only when source docs are incomplete

  ———

  Phase 7
  Integrate deterministic eligibility checks.

  - Inspect and reuse app/src/lib/rules/eligibility.ts from the orchestrator flow.
  - Run eligibility:
      - immediately after selected call is known
      - again after requirements/profile assembly if more constraints were discovered
  - Persist result as eligibilityAssessment.
  - Hard blockers should produce a checkpoint or stop condition before build.

  Files

  - Update app/src/lib/ai/orchestrator/agents/validate.ts
  - Possibly new adapter: map-call-profile-to-eligibility-input.ts

  Tests

  - Add deterministic tests for:
      - eligible applicant
      - blocked applicant type
      - budget out of bounds
      - region mismatch
      - missing annex/document prerequisite

  ———

  Phase 8
  Make knowledge step read existing knowledge before writing new knowledge.

  - Update app/src/lib/ai/orchestrator/agents/knowledge.ts so it:
      - queries existing call/program knowledge
      - merges it into context
      - only then adds new findings if they are novel
  - Prevent step 5 from being a pure “embed what we just found” operation.

  Files

  - Update knowledge.ts
  - Add helper: merge-knowledge-sources.ts

  Tests

  - Ensure existing vault/Qdrant knowledge is present in context before build.
  - Ensure duplicate findings are not re-added.

  ———

  Phase 9
  Refactor build agent to use exact extracted structure.

  - Update app/src/lib/ai/orchestrator/agents/build.ts.
  - Replace generic section prompting with structure-driven generation:
      - loop through applicationStructure.sections
      - prompt with exact heading and requirement bundle
      - inject only relevant evidence for that section
  - Require output sections to match extracted headings exactly.

  Files

  - Update app/src/lib/ai/orchestrator/agents/build.ts
  - Update build prompt helper under prompts/build.ts

  Tests

  - Assert output ordering follows applicationStructure.
  - Assert exact heading preservation.
  - Assert fallback behavior if one section cannot be structured.

  ———

  Phase 10
  Add post-build compliance validation.

  - Create validator that compares generated sections to applicationStructure and eligibilityAssessment.
  - Validate:
      - all mandatory headings present
      - no missing required sections
      - annex checklist complete
      - hard eligibility blockers absent
      - provenance exists for critical sections
  - If validation fails, return structured issues instead of silently completing.

  Files

  - New: validate-generated-application.ts
  - Update app/src/lib/ai/orchestrator/engine.ts or build agent to run it before final completion.

  Tests

  - Missing-heading failure
  - extra-generic-section failure
  - blocked-eligibility failure
  - successful validated build

  ———

  Phase 11
  Add program-family adapters.

  - Start with:
      - PNRR
      - PEO
      - POCIDIF
      - Regional Programs
  - Each adapter maps program-specific document patterns into the common CallRequirementsProfile.

  Files

  - app/src/lib/ai/orchestrator/call-requirements/adapters/pnrr.ts
  - .../peo.ts
  - .../pocidif.ts
  - .../regional.ts

  Tests

  - One fixture per adapter with expected structure extraction and annex mapping.

  ———

  Phase 12
  Add orchestration checkpoints and UX safeguards.

  - Add a checkpoint after research/profile assembly showing:
      - resolved guide title/version
      - exact section outline
      - detected annexes
      - eligibility blockers/warnings
  - Let the user confirm before build.
  - This avoids generating against the wrong version of the guide.

  Files

  - Update app/src/lib/ai/orchestrator/agents/research.ts
  - Possibly update frontend handling in app/src/hooks/useOrchestrator.ts

  Tests

  - Checkpoint payload contains outline + blockers.
  - Flow resumes correctly into build.

  ———

  Suggested file map

  - app/src/lib/ai/orchestrator/types.ts
  - app/src/lib/ai/orchestrator/engine.ts
  - app/src/lib/ai/orchestrator/agents/validate.ts
  - app/src/lib/ai/orchestrator/agents/research.ts
  - app/src/lib/ai/orchestrator/agents/knowledge.ts
  - app/src/lib/ai/orchestrator/agents/build.ts
  - app/src/lib/ai/orchestrator/prompts/build.ts
  - app/src/lib/rules/eligibility.ts
  - New app/src/lib/ai/orchestrator/call-requirements/*

  Testing plan

  - Unit:
      - call resolution
      - Qdrant evidence normalization
      - vault retrieval normalization
      - structure extraction
      - eligibility mapping and evaluation
      - build output ordering
      - post-build validation
  - Integration:
      - one real-call fixture per program family
      - one fallback path with missing docs
      - one ineligible-project path
  - Regression:
      - existing 12-file orchestrator unit suite stays green

  Recommended implementation order

  1. Phase 1
  2. Phase 2
  3. Phase 3
  4. Phase 5
  5. Phase 6
  6. Phase 7
  7. Phase 9
  8. Phase 10
  9. Phase 4
  10. Phase 8
  11. Phase 11
  12. Phase 12

  Acceptance criteria

  - Research no longer depends primarily on generic web search.
  - Build output uses exact call-specific headings.
  - Eligibility engine is part of the flow.
  - Qdrant and vault both contribute context.
  - Final output can be validated against the actual call structure.
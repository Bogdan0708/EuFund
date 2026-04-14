Backlog

  P0
  Foundational changes that unblock everything else.

  1. orchestrator-context-contract

  - Priority: P0
  - Effort: S
  - Depends on: none
  - Scope:
      - extend app/src/lib/ai/orchestrator/types.ts
      - persist new fields in app/src/lib/ai/orchestrator/engine.ts
  - Output:
      - callRequirementsProfile
      - applicationStructure
      - eligibilityAssessment
      - knowledgeSources
  - Done when:
      - session persistence works across checkpoint and auto-advance
      - unit tests updated

  2. call-document-resolution

  - Priority: P0
  - Effort: M
  - Depends on: orchestrator-context-contract
  - Scope:
      - create deterministic resolver for guide, annexes, form docs, corrigenda, legal basis
  - Output:
      - canonical document bundle per selected call
  - Done when:
      - ambiguous and missing-document cases are handled explicitly
      - unit tests exist for exact match and fallback resolution

  3. qdrant-selected-call-retrieval

  - Priority: P0
  - Effort: M
  - Depends on: call-document-resolution
  - Scope:
      - targeted retrieval for legal/applicant-guide material
  - Output:
      - normalized evidence objects from indexed documents
  - Done when:
      - research can pull call-specific guide/legal chunks from Qdrant
      - tests cover ranking/filtering

  4. research-agent-structured-profile

  - Priority: P0
  - Effort: L
  - Depends on:
      - orchestrator-context-contract
      - call-document-resolution
      - qdrant-selected-call-retrieval
  - Scope:
      - refactor app/src/lib/ai/orchestrator/agents/research.ts
      - assemble CallRequirementsProfile
  - Output:
      - structured legal basis
      - required annexes
      - deadlines
      - guide version
      - provenance
  - Done when:
      - research is no longer primarily generic web prose
      - web is fallback-only

  5. application-structure-extraction

  - Priority: P0
  - Effort: L
  - Depends on: research-agent-structured-profile
  - Scope:
      - parse exact section headings and order from guide/form docs
  - Output:
      - applicationStructure
  - Done when:
      - structure contains exact required headings
      - generic headings are no longer used by default

  6. eligibility-engine-integration

  - Priority: P0
  - Effort: M
  - Depends on: research-agent-structured-profile
  - Scope:
      - wire app/src/lib/rules/eligibility.ts into orchestrator validation
  - Output:
      - deterministic blockers/warnings
  - Done when:
      - invalid applicant/budget/region cases are blocked before build

  7. template-driven-build-agent

  - Priority: P0
  - Effort: L
  - Depends on:
      - application-structure-extraction
      - eligibility-engine-integration
  - Scope:
      - refactor app/src/lib/ai/orchestrator/agents/build.ts
      - update app/src/lib/ai/orchestrator/prompts/build.ts
  - Output:
      - section generation using exact headings and ordered structure
  - Done when:
      - build output matches extracted structure exactly

  8. post-build-structure-validation

  - Priority: P0
  - Effort: M
  - Depends on:
      - template-driven-build-agent
      - application-structure-extraction
  - Scope:
      - validate headings/order/completeness before completion
  - Output:
      - structured validation issues
  - Done when:
      - missing required sections fail validation

  P1
  Important quality improvements after the core path works.

  9. obsidian-vault-retrieval

  - Priority: P1
  - Effort: M
  - Depends on: orchestrator-context-contract
  - Scope:
      - retrieve program/call-specific notes from the vault
  - Output:
      - normalized knowledgeSources
  - Done when:
      - vault notes enrich the flow without overriding authoritative docs

  10. knowledge-agent-read-before-write

  - Priority: P1
  - Effort: M
  - Depends on:
      - obsidian-vault-retrieval
      - research-agent-structured-profile
  - Scope:
      - refactor app/src/lib/ai/orchestrator/agents/knowledge.ts
  - Output:
      - existing knowledge merged before new findings are embedded
  - Done when:
      - step 5 is read+write, not write-only

  11. research-checkpoint-outline-review

  - Priority: P1
  - Effort: S
  - Depends on:
      - application-structure-extraction
      - eligibility-engine-integration
  - Scope:
      - add checkpoint after research showing guide version, outline, blockers
  - Output:
      - user confirmation before build
  - Done when:
      - users can confirm the exact document basis before generation

  12. provenance-per-section

  - Priority: P1
  - Effort: M
  - Depends on: template-driven-build-agent
  - Scope:
      - attach source metadata and unresolved assumptions to generated sections
  - Output:
      - auditable section provenance
  - Done when:
      - each critical section identifies supporting sources

  P2
  Coverage, adapter depth, and rollout polish.

  13. program-adapter-pnrr

  - Priority: P2
  - Effort: M
  - Depends on: call-document-resolution
  - Scope:
      - PNRR-specific document and annex patterns
  - Done when:
      - one realistic PNRR fixture passes end-to-end

  14. program-adapter-peo

  - Priority: P2
  - Effort: M
  - Depends on: call-document-resolution

  15. program-adapter-pocidif

  - Priority: P2
  - Effort: M
  - Depends on: call-document-resolution

  16. program-adapter-regional

  - Priority: P2
  - Effort: M
  - Depends on: call-document-resolution

  17. integration-fixtures-real-calls

  - Priority: P2
  - Effort: L
  - Depends on:
      - template-driven-build-agent
      - program adapters
  - Scope:
      - one fixture per major program family
  - Done when:
      - flow is tested against real-ish call structures

  18. feature-flag-rollout

  - Priority: P2
  - Effort: S
  - Depends on: P0 completion
  - Scope:
      - release behind a flag
      - canary on selected programs/users
  - Done when:
      - old flow and new flow can coexist safely

  Recommended sequence

  1. orchestrator-context-contract
  2. call-document-resolution
  3. qdrant-selected-call-retrieval
  4. research-agent-structured-profile
  5. application-structure-extraction
  6. eligibility-engine-integration
  7. template-driven-build-agent
  8. post-build-structure-validation
  9. obsidian-vault-retrieval
  10. knowledge-agent-read-before-write
  11. research-checkpoint-outline-review
  12. provenance-per-section
  13. program adapters
  14. integration fixtures
  15. feature-flag rollout

  Sprint-friendly cut

  - Sprint 1:
      - items 1-4
  - Sprint 2:
      - items 5-8
  - Sprint 3:
      - items 9-12
  - Sprint 4:
      - items 13-18

  Good first acceptance milestone

  - For one selected call, the flow:
      - resolves actual guide documents
      - extracts exact headings
      - runs deterministic eligibility
      - generates proposal sections in exact required order
      - fails if required sections are missing
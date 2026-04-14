PR Sequence

  PR 1
  Context and contracts

  - Scope:
      - extend app/src/lib/ai/orchestrator/types.ts
      - persist new fields in app/src/lib/ai/orchestrator/engine.ts
      - update app/tests/unit/orchestrator-types.test.ts
      - update app/tests/unit/orchestrator-engine.test.ts
  - New fields:
      - callRequirementsProfile
      - applicationStructure
      - eligibilityAssessment
      - knowledgeSources
  - Goal:
      - create the data model without changing external behavior much

  PR 2
  Call document resolution

  - Scope:
      - add app/src/lib/ai/orchestrator/call-requirements/types.ts
      - add app/src/lib/ai/orchestrator/call-requirements/resolve-call-documents.ts
      - add app/tests/unit/call-document-resolution.test.ts
  - Goal:
      - resolve selected call into canonical guide, annexes, legal basis, and form docs

  PR 3
  Qdrant selected-call retrieval

  - Scope:
      - add retrieve-qdrant-evidence.ts
      - wire into the call-requirements layer, not the match-agent broad search path
      - add qdrant-call-evidence.test.ts
  - Goal:
      - retrieve actual guide/legal chunks for the selected call

  PR 4
  Research agent structured profile

  - Scope:
      - refactor app/src/lib/ai/orchestrator/agents/research.ts
      - add assemble-call-requirements.ts
      - update app/tests/unit/agent-research.test.ts
  - Goal:
      - produce CallRequirementsProfile
      - make web search fallback-only

  PR 5
  Application structure extraction

  - Scope:
      - add extract-application-structure.ts
      - add normalize-form-structure.ts
      - add application-structure-extraction.test.ts
  - Goal:
      - derive exact headings and order from guide/form materials

  PR 6
  Eligibility integration

  - Scope:
      - add map-call-profile-to-eligibility-input.ts
      - update app/src/lib/ai/orchestrator/agents/validate.ts
      - add eligibility-integration.test.ts
      - update app/tests/unit/agent-validate.test.ts
  - Goal:
      - run deterministic eligibility checks in flow

  PR 7
  Build agent template refactor

  - Scope:
      - update app/src/lib/ai/orchestrator/agents/build.ts
      - update app/src/lib/ai/orchestrator/prompts/build.ts
      - update app/tests/unit/agent-build.test.ts
  - Goal:
      - build against exact extracted structure
      - stop using generic headings by default

  PR 8
  Post-build structural validation

  - Scope:
      - add validate-generated-application.ts
      - wire validation into build completion path
      - add generated-application-validation.test.ts
  - Goal:
      - reject incomplete or structurally invalid outputs

  PR 9
  Obsidian retrieval

  - Scope:
      - add retrieve-vault-knowledge.ts
      - add vault-knowledge-retrieval.test.ts
  - Goal:
      - pull program- and call-specific vault notes into the flow

  PR 10
  Knowledge agent read-before-write

  - Scope:
      - update app/src/lib/ai/orchestrator/agents/knowledge.ts
      - add merge-knowledge-sources.ts
      - update app/tests/unit/agent-knowledge.test.ts
  - Goal:
      - reuse existing knowledge before embedding new findings

  PR 11
  Research checkpoint and outline confirmation

  - Scope:
      - add checkpoint payload after research
      - update app/src/hooks/useOrchestrator.ts if needed
  - Goal:
      - let the user confirm guide version, structure, and blockers before build

  PR 12
  Program adapters

  - Scope:
      - add pnrr.ts, peo.ts, pocidif.ts, regional.ts
      - add one fixture test per adapter
  - Goal:
      - support call-family-specific document patterns cleanly

  PR 13
  Integration fixtures and rollout

  - Scope:
      - add end-to-end integration fixtures for real calls
      - add feature flag around new production-quality flow
  - Goal:
      - validate on representative programs before full rollout

  Suggested GitHub issues

  1. Add orchestrator context for call requirements, structure, eligibility, and knowledge
  2. Resolve selected funding call into canonical guide, annex, and legal documents
  3. Retrieve selected-call legislation and guide evidence from Qdrant
  4. Refactor research agent to build a structured call requirements profile
  5. Extract exact application structure from guide and form sources
  6. Integrate deterministic eligibility engine into orchestrator validation
  7. Refactor build agent to generate from exact call structure
  8. Add post-build structural compliance validator
  9. Add Obsidian vault retrieval for call-specific institutional knowledge
  10. Refactor knowledge agent to read existing knowledge before writing new findings
  11. Add research checkpoint for guide version and extracted outline confirmation
  12. Add program-specific adapters for PNRR, PEO, POCIDIF, and regional calls
  13. Add integration fixtures and feature-flag rollout for the new orchestrator flow

  Best merge order

  - PRs 1 through 8 first
  - PRs 9 through 11 next
  - PRs 12 and 13 last
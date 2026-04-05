• Plan

  1. Establish the source-of-truth contract

  - Define a per-call CallRequirementsProfile object that becomes the single input to downstream agents.
  - Include: legal basis, applicant-guide sections, exact form headings, required annexes, MySMIS field mapping, eligibility rules, deadlines, and
    evidence sources.
  - Persist it in orchestrator context alongside selectedCallId.

  2. Upgrade step 4 from web research to structured retrieval

  - Split research into three retrieval lanes:
      - Qdrant: fetch legislation, applicant guides, corrigenda, annexes, and prior indexed call documents for the selected call.
      - Obsidian vault: fetch program-specific notes, prior implementation guidance, institutional memory, and checklists.
      - Web fallback: use Perplexity/web only when the first two sources are incomplete.
  - Normalize all retrieved material into structured fields instead of raw prose.

  3. Add a call-document identification layer

  - Build a resolver that maps the matched call to its canonical documents:
      - ghid al solicitantului
      - application form / cerere de finantare
      - annex list
      - implementation instructions / corrigenda
  - Deduplicate by call code/version and track document version/date.
  - Fail closed when the call cannot be resolved to concrete documents.

  4. Introduce form-structure extraction

  - Parse the actual guide/form into an ordered schema:
      - exact section headings
      - subsection hierarchy
      - field-level constraints
      - length limits
      - mandatory attachments
  - Store this as applicationStructure in context so build never invents generic headings.

  5. Wire in deterministic eligibility checks

  - Call lib/rules/eligibility.ts immediately after call selection and again before final build.
  - Evaluate applicant, geography, CAEN/domain, budget, duration, partnership, and document prerequisites.
  - Surface blocking issues as structured warnings/checkpoints, not buried in prose.

  6. Expand the knowledge step from write-only to read+write

  - Change step 5 so it first queries existing knowledge from Obsidian/Qdrant for the selected program/call.
  - Only then append newly discovered findings back into the knowledge base.
  - Separate “retrieved institutional knowledge” from “newly learned facts” in context.

  7. Refactor the build agent around templates, not generic prose

  - Replace generic section generation with template-driven composition from applicationStructure.
  - For each required section, feed:
      - exact heading
      - source requirements
      - relevant legislation excerpts
      - retrieved vault guidance
      - project facts
  - Require the agent to output only the mandated structure in the mandated order.

  8. Add section-level provenance and compliance metadata

  - Every built section should carry:
      - source documents used
      - matched requirement IDs
      - unresolved assumptions
      - missing evidence flags
  - This enables review and later export into compliance/audit views.

  9. Support program-specific adapters

  - Add adapters for high-value program families first:
      - PNRR
      - PEO
      - POCIDIF
      - regional programs
  - Each adapter can map known call document patterns, annex naming, and form conventions into the common CallRequirementsProfile.

  10. Introduce strict checkpoints before final generation

  - After research/normalization: confirm the resolved call package and document version.
  - After eligibility: stop if hard blockers exist.
  - Before build: show the exact section outline extracted from the guide and ask for confirmation.

  11. Add validation after generation

  - Compare generated output against applicationStructure.
  - Check:
      - all mandatory headings present
      - no extra invented sections
      - annex checklist complete
      - eligibility blockers absent
      - source coverage acceptable
  - Reject or mark incomplete if the structure does not match.

  12. Testing and rollout

  - Add unit tests for:
      - call-to-document resolution
      - structure extraction
      - eligibility invocation
      - template-driven build ordering
  - Add integration tests for one real call per program family.
  - Roll out behind a feature flag, starting with one program/call class before generalizing.

  Recommended implementation order

  1. CallRequirementsProfile contract and context changes.
  2. Qdrant + Obsidian retrieval for selected call.
  3. document resolver + structure extractor.
  4. eligibility integration.
  5. template-driven build refactor.
  6. post-build compliance validator.
  7. program-specific adapters and broader coverage.

  If you want, I can turn this into a concrete implementation plan with files, phases, and test cases for this repo.

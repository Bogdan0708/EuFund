# Per-Track Candidate Lists — 2026-04-14

**Source:** synthesized from probe-01 through probe-11 in this folder.
**Consumers:** plans 3 (orchestrator retirement), 4 (orphaned AI modules), 5 (diagnostic sweep).
**Authority:** this file is the input contract for the deferred plans. Plans 3, 4, 5 do NOT re-run probes; they read this file.

---

## Track A — Orchestrator retirement (consumed by Plan 3)

### Sub-step (a): asistent-ai/page.tsx migration

Source: probe 03.

| File to migrate | Current hook | Target hook |
|-----------------|--------------|-------------|
| `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx` | `useOrchestrator` | `useAgent` |

### Sub-step (b): shared-type rehoming

Source: probe 10.

| Type/module to rehome | Current location | Importers (must update) | Target location |
|----------------------|------------------|------------------------|-----------------|
| `CallBlueprint`, `SectionSpec` | `@/lib/ai/orchestrator/types` | `app/src/lib/ai/agent/{types.ts,services/types.ts,services/blueprint.ts,prompt.ts,tools/*}` | `app/src/lib/ai/agent/types.ts` or a new shared non-orchestrator types module |
| `SectionResult` | `@/lib/ai/orchestrator/types` | `app/src/hooks/useOrchestrator.ts`, dashboard project pages, `app/src/lib/export/docx.ts`, `app/src/app/api/v1/workspace/route.ts`, orchestrator rollback/state routes | Shared non-orchestrator types module, then remove orchestrator ownership |
| `SubmissionDocument` | `@/lib/ai/orchestrator/types` | `app/src/lib/compliance/form-templates.ts`, dashboard project page, `app/src/app/api/v1/projects/[id]/submission-documents/[docId]/route.ts` | Shared non-orchestrator types module |
| `DEFAULT_SECTIONS`, `buildSectionSpecs`, `compactPreviousSections` | `@/lib/ai/orchestrator/section-specs` | `app/src/lib/ai/agent/section-specs.ts` | `app/src/lib/ai/agent/section-specs.ts` or adjacent agent-owned helper module |

### Sub-step (c): hook delete

Source: probe 03.

- File to delete: `app/src/hooks/useOrchestrator.ts`
- Pre-delete check: re-run probe 03 to confirm zero remaining importers.

### Sub-step (d): orchestrator route deletion

Source: probe 04 + probe 11 cross-reference.

| Route file to delete | Frontend refs | Notes |
|---------------------|---------------|-------|
| `app/src/app/api/ai/orchestrator/message/route.ts` | 1 | Migrate the `useOrchestrator` caller first |
| `app/src/app/api/ai/orchestrator/messages/route.ts` | 0 | Delete candidate |
| `app/src/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/rollback/route.ts` | 0 | Delete candidate |
| `app/src/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/state/route.ts` | 0 | Delete candidate |
| `app/src/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/versions/route.ts` | 0 | Delete candidate |
| `app/src/app/api/ai/orchestrator/sessions/route.ts` | 0 | Test-backed delete candidate (`3` test refs) |
| `app/src/app/api/ai/orchestrator/stream/route.ts` | 0 | Delete candidate |

### Sub-step (e): folder deletion

Source: probes 01 and 10.

- Directory to delete: `app/src/lib/ai/orchestrator/` (entire subtree)
- Preconditions: sub-steps (a) through (d) complete; probe 10 returns zero orchestrator-owned type/re-export dependencies.

### Sub-step (f): client-v2 sweep

Source: probe 01 part A.

- File: `app/src/lib/ai/client-v2.ts`
- Probe result: no `client-v2` string references found in `app/src`.
- Resolution: likely deletion candidate, but confirm with a direct file/import sweep when Plan 3 is written.

---

## Track B — Orphaned AI modules (consumed by Plan 4)

Source: probes 04 and 05.

### Confirmed delete candidates (zero external refs)

No root `app/src/lib/ai/*.ts` module returned a zero-reference result on current `master`.

### Migration candidates (non-zero refs)

| Module | Importer files | Replacement target | Notes |
|--------|---------------|--------------------|-------|
| `compliance-engine.ts` | `enhanced-proposal-generator.ts`, `app/api/v1/projects/[id]/compliance/ai-score/route.ts` | Keep or rehome into v1 compliance surface | Not orphaned on current `master` |
| `compliance-validator.ts` | compliance UI panel, `app/api/v1/projects/[id]/compliance/route.ts` | Keep or rehome into v1 compliance surface | Not orphaned on current `master` |
| `deadline-intelligence.ts` | `risk-assessment.ts` | Delete with downstream risk flow or rehome | Coupled helper, not standalone orphan |
| `document-analyzer.ts` | `app/api/documents/[id]/analyze/route.ts`, tests | Keep or rehome into documents surface | Not orphaned on current `master` |
| `enhanced-proposal-generator.ts` | `app/api/ai/generate-proposal-enhanced/route.ts` | Retire with route or rehome | Legacy route-coupled |
| `eu-ai-act.ts` | `app/api/ai/match-grants/route.ts`, `sanitize.ts` | Keep helper or rehome | Shared helper still live |
| `eu-knowledge-base.ts` | `enhanced-proposal-generator.ts`, `fact-checker.ts`, `knowledge-engine.ts`, `app/api/ai/generate-insights/route.ts` | Retire with dependent routes or rehome | Shared helper still live |
| `fact-checker.ts` | `app/api/ai/generate-proposal{,-enhanced}/route.ts` | Retire with proposal routes or rehome | Route-coupled |
| `grant-matcher.ts` | `app/api/ai/match-grants/route.ts` | Retire with route or rehome | Route-coupled |
| `knowledge-engine.ts` | `app/api/ai/generate-insights/route.ts` | Retire with route or rehome | Route-coupled |
| `proposal-generator.ts` | `app/api/ai/generate-proposal/route.ts` | Retire with route or rehome | Route-coupled |
| `reporting-engine.ts` | `app/api/ai/generate-report/route.ts` | Retire with route or rehome | Route-coupled |
| `risk-assessment.ts` | `app/api/v1/projects/[id]/risks/ai-assessment/route.ts` | Keep or rehome into v1 project risk surface | Not orphaned on current `master` |

### Route candidates (from probe 04, scoped to Plan 4)

| Route | Frontend refs | Test refs | Classification |
|-------|--------------|-----------|----------------|
| `/api/ai/check-eligibility` | 0 external (`2` route-internal instrumentation hits) | 1 | Delete candidate after test cleanup |
| `/api/ai/generate-insights` | 0 | 1 | Delete candidate after test cleanup |
| `/api/ai/generate-proposal` | 0 | 7 | Delete-or-migrate route; heavily test-backed only |
| `/api/ai/generate-proposal-enhanced` | 0 | 0 | Delete candidate |
| `/api/ai/generate-report` | 0 | 0 | Delete candidate |
| `/api/ai/ghid-to-tasks` | 0 | 0 | Delete candidate |
| `/api/ai/match-grants` | 0 | 3 | Delete-or-migrate route; test-backed only |
| `/api/ai/search-calls` | 0 | 0 | Delete candidate |

---

## Track C — Diagnostic sweep (consumed by Plan 5)

Source: probes 04 and 11.

- Route: `app/src/app/api/ai/diagnostic/route.ts`
- Frontend refs: `0`
- Test refs: `0`
- Public-surface note: `middleware.ts` still lists `/api/ai/diagnostic` in `publicPaths`
- Classification: independent candidate for deletion; if retained, the rationale must be explicit and operational rather than frontend-driven.

---

## Cross-cutting — Cleanup carried in retirement PRs

### Feature flags retiring with surfaces

| Flag | Owning surface (retires with) |
|------|------------------------------|
| `section_versioning` | Orchestrator section-versioning routes and engine path |

### Env vars retiring with surfaces

No env var was mapped cleanly to a retiring legacy surface by probe 08. The unread vars (`NEXTAUTH_URL`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) are configuration drift candidates but appear out of scope for plans 3, 4, and 5.

### Tests retiring with surfaces

| Test file | Owning surface |
|-----------|----------------|
| `app/tests/unit/{agent-build,agent-plan,agent-research,agent-enhance,agent-edit,agent-match,orchestrator-qa,orchestrator-types,section-specs}.test.ts` | Orchestrator runtime |
| `app/tests/unit/services/blueprint.test.ts` | Orchestrator shared-type bridge |
| `app/tests/unit/export-docx.test.ts` | Orchestrator-owned types in export path |
| `app/tests/integration/project-compliance-route.test.ts` | `compliance-validator.ts` |
| `app/tests/ai-components.test.ts` | `document-analyzer.ts` |
| `app/tests/integration/match-grants-route.test.ts` | `grant-matcher.ts` |
| `app/tests/integration/{critical-flows,tier-gating,security}.test.ts` | Multiple legacy AI routes/modules |
| `app/tests/integration/project-risk-ai-route.test.ts` | `risk-assessment.ts` |
| `app/e2e/funding-calls.spec.ts` | Missing funding route surface |
| `app/e2e/onboarding.spec.ts` | Mixed onboarding surface including missing `/ro/verifica-email` |

---

## Bridge legacy — handed to retention register, not to plans 3/4/5

- V1 dark-glass token files: see probe 06 V1-only set. Retention entry `V1 dark-glass tokens` covers them.
- V3 runtime modules: retained bridge surface pending Managed Phase 3. Retention entry `V3 runtime` covers them.

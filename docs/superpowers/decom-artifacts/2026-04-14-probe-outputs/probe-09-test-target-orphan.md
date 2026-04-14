# Probe 09 — Test-target orphan probe

**Run on:** 2026-04-14 against `master` at commit `1040228`.
**Spec reference:** Section 2, probe 9.
**Purpose:** Every `app/tests/**` file that imports a module flagged by probes 1–5 inherits its classification. Every `app/e2e/**` spec file that `goto`s a route not in the current route tree is an orphan test.

## Commands

```bash
rg -ln "from ['\"]@/lib/ai/orchestrator" app/tests/
rg -ln "useOrchestrator" app/tests/

for mod in compliance-engine compliance-validator deadline-intelligence document-analyzer enhanced-proposal-generator eu-ai-act eu-knowledge-base fact-checker grant-matcher knowledge-engine proposal-generator reporting-engine risk-assessment; do
  rg -l "@/lib/ai/$mod" app/tests/
done

rg -n "page\.goto\(['\"][^'\"]*['\"]" app/e2e/ | sort -u
```

## Raw output

```text
## A. Test files importing @/lib/ai/orchestrator/*
app/tests/unit/agent-build.test.ts
app/tests/unit/orchestrator-qa.test.ts
app/tests/unit/agent-plan.test.ts
app/tests/unit/orchestrator-types.test.ts
app/tests/unit/agent-research.test.ts
app/tests/unit/services/blueprint.test.ts
app/tests/unit/agent-enhance.test.ts
app/tests/unit/section-specs.test.ts
app/tests/unit/agent-edit.test.ts
app/tests/unit/agent-match.test.ts
app/tests/unit/export-docx.test.ts

## B. Test files importing useOrchestrator
(none)

## C. Test files importing legacy lib/ai root modules (cross-reference probe 05 results)
### compliance-validator
app/tests/integration/project-compliance-route.test.ts
### document-analyzer
app/tests/ai-components.test.ts
### grant-matcher
app/tests/integration/critical-flows.test.ts
app/tests/integration/match-grants-route.test.ts
### knowledge-engine
app/tests/integration/critical-flows.test.ts
### proposal-generator
app/tests/integration/tier-gating.test.ts
app/tests/integration/security.test.ts
app/tests/integration/critical-flows.test.ts
### risk-assessment
app/tests/integration/project-risk-ai-route.test.ts

## D. e2e specs that goto a route not in the (dashboard)/ tree
app/e2e/ai-assistant.spec.ts:10:    await page.goto('/ro/asistent-ai');
app/e2e/ai-assistant.spec.ts:15:    await page.goto('/ro/asistent-ai');
app/e2e/ai-assistant.spec.ts:20:    await page.goto('/ro/asistent-ai');
app/e2e/ai-assistant.spec.ts:31:    await page.goto('/ro/asistent-ai');
app/e2e/ai-assistant.spec.ts:5:    await page.goto('/ro/asistent-ai');
app/e2e/api-admin.spec.ts:8:    await page.goto('/ro/panou');
app/e2e/api-health.spec.ts:6:    await page.goto('/ro/panou');
app/e2e/auth.setup.ts:10:  await page.goto('/ro/autentificare');
app/e2e/auth.setup.ts:54:    await page.goto('/ro/panou');
app/e2e/auth.spec.ts:25:    await page.goto('/en/autentificare');
app/e2e/auth.spec.ts:35:    await page.goto('/ro/autentificare');
app/e2e/auth.spec.ts:47:    await page.goto('/ro/autentificare');
app/e2e/auth.spec.ts:63:    await page.goto('/ro/autentificare');
app/e2e/auth.spec.ts:6:    await page.goto('/ro/autentificare');
app/e2e/auth.spec.ts:81:    await page.goto('/ro/panou');
app/e2e/auth.spec.ts:86:    await page.goto('/en/panou');
app/e2e/auth.spec.ts:98:    await page.goto('/ro/autentificare');
app/e2e/dashboard.spec.ts:18:    await page.goto('/ro/panou');
app/e2e/dashboard.spec.ts:34:    await page.goto('/ro/panou');
app/e2e/dashboard.spec.ts:5:    await page.goto('/ro/panou');
app/e2e/documents.spec.ts:10:    await page.goto('/ro/documente');
app/e2e/documents.spec.ts:17:    await page.goto('/ro/documente');
app/e2e/documents.spec.ts:5:    await page.goto('/ro/documente');
app/e2e/full-qa-test.spec.ts:132:    await page.goto('/ro/proiecte');
app/e2e/full-qa-test.spec.ts:169:    await page.goto('/ro/documente');
app/e2e/full-qa-test.spec.ts:200:    await page.goto('/ro/asistent-ai');
app/e2e/full-qa-test.spec.ts:242:    await page.goto('/ro/setari');
app/e2e/full-qa-test.spec.ts:281:    await page.goto('/ro/panou');
app/e2e/full-qa-test.spec.ts:294:      await page.goto('/ro/panou');
app/e2e/full-qa-test.spec.ts:320:    await page.goto('/ro/panou');
app/e2e/full-qa-test.spec.ts:350:    await page.goto('/ro/panou');
app/e2e/full-qa-test.spec.ts:384:    await page.goto('/ro/pagina-inexistenta');
app/e2e/full-qa-test.spec.ts:422:    await page.goto('/ro/asistent-ai');
app/e2e/full-qa-test.spec.ts:544:    await page.goto('/ro/proiecte');
app/e2e/full-qa-test.spec.ts:552:    await page.goto('/ro/proiecte');
app/e2e/full-qa-test.spec.ts:57:    await page.goto('/ro/autentificare');
app/e2e/full-qa-test.spec.ts:595:    await page.goto('/ro/panou');
app/e2e/full-qa-test.spec.ts:77:    await page.goto('/ro/panou');
app/e2e/full-qa-test.spec.ts:99:    await page.goto('/ro/panou');
app/e2e/funding-calls.spec.ts:15:    await page.goto('/ro/finantari');
app/e2e/funding-calls.spec.ts:33:    await page.goto('/ro/finantari');
app/e2e/funding-calls.spec.ts:54:    await page.goto('/ro/finantari');
app/e2e/funding-calls.spec.ts:5:    await page.goto('/ro/finantari');
app/e2e/funding-calls.spec.ts:77:    await page.goto('/ro/finantari');
app/e2e/i18n.spec.ts:14:    await page.goto('/ro/autentificare');
app/e2e/i18n.spec.ts:19:    await page.goto('/en/autentificare');
app/e2e/i18n.spec.ts:26:    await page.goto('/ro/autentificare');
app/e2e/i18n.spec.ts:34:    await page.goto('/ro/autentificare');
app/e2e/i18n.spec.ts:44:    await page.goto('/en/autentificare');
app/e2e/i18n.spec.ts:52:    await page.goto('/en/autentificare');
app/e2e/i18n.spec.ts:62:    await page.goto('/ro');
app/e2e/i18n.spec.ts:68:    await page.goto('/en');
app/e2e/i18n.spec.ts:76:    await page.goto('/ro/pagina-care-nu-exista');
app/e2e/navigation.spec.ts:14:    await page.goto('/ro/panou');
app/e2e/navigation.spec.ts:35:      await page.goto('/ro/panou');
app/e2e/navigation.spec.ts:65:    const response = await page.goto('/ro/nonexistent');
app/e2e/navigation.spec.ts:73:    await page.goto('/ro');
app/e2e/onboarding.spec.ts:15:    await page.goto('/ro/interese');
app/e2e/onboarding.spec.ts:27:    await page.goto('/ro/verifica-email');
app/e2e/onboarding.spec.ts:5:    await page.goto('/ro/bun-venit');
app/e2e/projects-crud.spec.ts:10:    await page.goto('/ro/proiecte');
app/e2e/projects-crud.spec.ts:20:    await page.goto('/ro/proiecte/92598985-9804-46ed-a30c-c9809b2d54e0');
app/e2e/projects-crud.spec.ts:33:    await page.goto('/ro/proiecte/92598985-9804-46ed-a30c-c9809b2d54e0');
app/e2e/projects-crud.spec.ts:55:    await page.goto('/ro/proiecte');
app/e2e/projects-crud.spec.ts:5:    await page.goto('/ro/proiecte');
app/e2e/projects-crud.spec.ts:74:    await page.goto('/ro/proiecte');
app/e2e/section-versioning.spec.ts:8:    await page.goto('/ro/asistent-ai');
app/e2e/security.spec.ts:36:    const response = await page.goto('/ro/panou');
app/e2e/settings.spec.ts:10:    await page.goto('/ro/setari');
app/e2e/settings.spec.ts:15:    await page.goto('/ro/setari');
app/e2e/settings.spec.ts:27:    await page.goto('/ro/setari');
app/e2e/settings.spec.ts:5:    await page.goto('/ro/setari');
```

## Classification

| Test file | Owning surface | Classification |
|-----------|----------------|----------------|
| `app/tests/unit/{agent-build,agent-plan,agent-research,agent-enhance,agent-edit,agent-match,orchestrator-qa,orchestrator-types,section-specs}.test.ts` | Orchestrator runtime | Inherit orchestrator-track classification; migrate or delete with Plan 3 |
| `app/tests/unit/services/blueprint.test.ts` | Orchestrator shared types / blueprint bridge | Inherit orchestrator-track classification; likely rewrite after shared-type rehoming |
| `app/tests/unit/export-docx.test.ts` | Orchestrator-owned types in export path | Inherit orchestrator-track classification; rewrite after type rehoming |
| `app/tests/integration/project-compliance-route.test.ts` | `compliance-validator.ts` | Inherit Plan 4 module classification |
| `app/tests/ai-components.test.ts` | `document-analyzer.ts` | Inherit Plan 4 module classification |
| `app/tests/integration/match-grants-route.test.ts` | `grant-matcher.ts` | Inherit Plan 4 module classification |
| `app/tests/integration/{critical-flows,tier-gating,security}.test.ts` | Multiple legacy AI routes/modules | Mixed legacy coverage; requires selective pruning as routes retire |
| `app/tests/integration/project-risk-ai-route.test.ts` | `risk-assessment.ts` | Inherit Plan 4 module classification |
| `app/e2e/funding-calls.spec.ts` | Missing `/ro/finantari` route | Orphan e2e spec under current route tree |
| `app/e2e/onboarding.spec.ts` | Mixed onboarding surface including missing `/ro/verifica-email` | Partial orphan; split or prune when the suite is rebuilt |
| `app/e2e/full-qa-test.spec.ts`, `app/e2e/i18n.spec.ts`, `app/e2e/navigation.spec.ts` | Negative-path assertions (`/pagina-inexistenta`, `/nonexistent`) plus live routes | Not orphan by default; review during test-pyramid rebuild rather than deleting automatically |

## Notes

- Most `goto(...)` targets in section D are current Romanian dashboard/auth routes and are not orphan evidence on their own.
- The mechanically clear orphan e2e surface is the funding-calls route family; `/ro/verifica-email` is the other clearly missing route surfaced here.

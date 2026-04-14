# Probe 10 — Re-export / type-dependency probe

**Run on:** 2026-04-14 against `master` at commit `1040228`.
**Spec reference:** Section 2, probe 10.
**Purpose:** Identify type-only imports and re-exports that keep the orchestrator subtree load-bearing even when runtime imports are absent.

## Commands

```bash
rg -n "export.*from ['\"]@/lib/ai/orchestrator" app/src/
rg -n "import type.*from ['\"]@/lib/ai/orchestrator" app/src/
rg -n "from ['\"]@/lib/ai/orchestrator/types" app/src/
rg -n "from ['\"]@/lib/ai/orchestrator/section-specs" app/src/
rg -ln "@/lib/ai/orchestrator" app/src/lib/ai/agent/
```

## Raw output

```text
## A. Re-exports from @/lib/ai/orchestrator
app/src/lib/ai/agent/types.ts:24:export type { CallBlueprint, SectionSpec } from '@/lib/ai/orchestrator/types'
app/src/lib/ai/agent/section-specs.ts:3:export { DEFAULT_SECTIONS, buildSectionSpecs, compactPreviousSections } from '@/lib/ai/orchestrator/section-specs'

## B. Type-only imports from orchestrator (import type)
app/src/lib/compliance/form-templates.ts:1:import type { SubmissionDocument } from '@/lib/ai/orchestrator/types'
app/src/lib/export/docx.ts:2:import type { SectionResult } from '@/lib/ai/orchestrator/types'
app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx:12:import type { SubmissionDocument } from '@/lib/ai/orchestrator/types';
app/src/app/[locale]/(dashboard)/proiecte/[id]/components/SectionsTabContent.tsx:10:import type { SectionResult } from '@/lib/ai/orchestrator/types';
app/src/app/[locale]/(dashboard)/proiecte/[id]/sectiuni/[sectionId]/page.tsx:10:import type { SectionResult } from '@/lib/ai/orchestrator/types';
app/src/lib/ai/agent/tools/extract-structure.ts:5:import type { SectionSpec } from '@/lib/ai/orchestrator/types'
app/src/lib/ai/agent/services/types.ts:6:import type { CallBlueprint } from '@/lib/ai/orchestrator/types'
app/src/lib/ai/agent/services/blueprint.ts:20:import type { CallBlueprint, SectionSpec } from '@/lib/ai/orchestrator/types'
app/src/lib/ai/agent/prompt.ts:2:import type { CallBlueprint } from '@/lib/ai/orchestrator/types'
app/src/lib/ai/agent/tools/resolve-call.ts:5:import type { CallBlueprint, SectionSpec } from '@/lib/ai/orchestrator/types'
app/src/app/api/v1/workspace/route.ts:8:import type { SectionResult } from '@/lib/ai/orchestrator/types';
app/src/lib/ai/agent/tools/regenerate-section.ts:5:import type { SectionSpec } from '@/lib/ai/orchestrator/types'
app/src/lib/ai/agent/tools/get-call-blueprint.ts:4:import type { CallBlueprint, SectionSpec } from '@/lib/ai/orchestrator/types'
app/src/lib/ai/agent/tools/generate-section.ts:5:import type { SectionSpec } from '@/lib/ai/orchestrator/types'
app/src/lib/ai/agent/tools/generate-section.ts:16:import type { CallBlueprint } from '@/lib/ai/orchestrator/types'
app/src/app/api/v1/projects/[id]/submission-documents/[docId]/route.ts:8:import type { SubmissionDocument } from '@/lib/ai/orchestrator/types'
app/src/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/rollback/route.ts:6:import type { SectionResult } from '@/lib/ai/orchestrator/types';
app/src/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/state/route.ts:6:import type { SectionResult } from '@/lib/ai/orchestrator/types';

## C. All imports from @/lib/ai/orchestrator/types specifically
app/src/hooks/useOrchestrator.ts:11:} from '@/lib/ai/orchestrator/types';
app/src/lib/export/docx.ts:2:import type { SectionResult } from '@/lib/ai/orchestrator/types'
app/src/lib/compliance/form-templates.ts:1:import type { SubmissionDocument } from '@/lib/ai/orchestrator/types'
app/src/lib/ai/agent/services/types.ts:6:import type { CallBlueprint } from '@/lib/ai/orchestrator/types'
app/src/lib/ai/agent/services/blueprint.ts:20:import type { CallBlueprint, SectionSpec } from '@/lib/ai/orchestrator/types'
app/src/lib/ai/agent/prompt.ts:2:import type { CallBlueprint } from '@/lib/ai/orchestrator/types'
app/src/lib/ai/agent/tools/extract-structure.ts:5:import type { SectionSpec } from '@/lib/ai/orchestrator/types'
app/src/lib/ai/agent/tools/resolve-call.ts:5:import type { CallBlueprint, SectionSpec } from '@/lib/ai/orchestrator/types'
app/src/lib/ai/agent/tools/regenerate-section.ts:5:import type { SectionSpec } from '@/lib/ai/orchestrator/types'
app/src/lib/ai/agent/tools/generate-section.ts:5:import type { SectionSpec } from '@/lib/ai/orchestrator/types'
app/src/lib/ai/agent/tools/generate-section.ts:16:import type { CallBlueprint } from '@/lib/ai/orchestrator/types'
app/src/lib/ai/agent/tools/get-call-blueprint.ts:4:import type { CallBlueprint, SectionSpec } from '@/lib/ai/orchestrator/types'
app/src/lib/ai/agent/types.ts:24:export type { CallBlueprint, SectionSpec } from '@/lib/ai/orchestrator/types'
app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx:12:import type { SubmissionDocument } from '@/lib/ai/orchestrator/types';
app/src/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/state/route.ts:6:import type { SectionResult } from '@/lib/ai/orchestrator/types';
app/src/app/api/v1/workspace/route.ts:8:import type { SectionResult } from '@/lib/ai/orchestrator/types';
app/src/app/[locale]/(dashboard)/proiecte/[id]/components/SectionsTabContent.tsx:10:import type { SectionResult } from '@/lib/ai/orchestrator/types';
app/src/app/[locale]/(dashboard)/proiecte/[id]/sectiuni/[sectionId]/page.tsx:10:import type { SectionResult } from '@/lib/ai/orchestrator/types';
app/src/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/rollback/route.ts:6:import type { SectionResult } from '@/lib/ai/orchestrator/types';
app/src/app/api/v1/projects/[id]/submission-documents/[docId]/route.ts:8:import type { SubmissionDocument } from '@/lib/ai/orchestrator/types'

## D. All imports from @/lib/ai/orchestrator/section-specs
app/src/lib/ai/agent/section-specs.ts:3:export { DEFAULT_SECTIONS, buildSectionSpecs, compactPreviousSections } from '@/lib/ai/orchestrator/section-specs'

## E. V3 agent code importing orchestrator (any path)
app/src/lib/ai/agent/services/types.ts
app/src/lib/ai/agent/services/blueprint.ts
app/src/lib/ai/agent/prompt.ts
app/src/lib/ai/agent/section-specs.ts
app/src/lib/ai/agent/types.ts
app/src/lib/ai/agent/tools/extract-structure.ts
app/src/lib/ai/agent/tools/resolve-call.ts
app/src/lib/ai/agent/tools/generate-section.ts
app/src/lib/ai/agent/tools/get-call-blueprint.ts
app/src/lib/ai/agent/tools/regenerate-section.ts
```

## Classification

| Dependency surface | Importers / re-exporters | Classification |
|--------------------|--------------------------|----------------|
| `@/lib/ai/orchestrator/types` — `CallBlueprint`, `SectionSpec` | `app/src/lib/ai/agent/{types.ts,services/types.ts,services/blueprint.ts,prompt.ts,tools/*}` | Shared-type rehoming blocker for Plan 3 |
| `@/lib/ai/orchestrator/types` — `SectionResult` | `app/src/hooks/useOrchestrator.ts`, dashboard project pages, `app/src/lib/export/docx.ts`, `app/src/app/api/v1/workspace/route.ts`, orchestrator rollback/state routes | Shared-type rehoming blocker for Plan 3 |
| `@/lib/ai/orchestrator/types` — `SubmissionDocument` | `app/src/lib/compliance/form-templates.ts`, dashboard project page, `app/src/app/api/v1/projects/[id]/submission-documents/[docId]/route.ts` | Shared-type rehoming blocker for Plan 3 |
| `@/lib/ai/orchestrator/section-specs` — `DEFAULT_SECTIONS`, `buildSectionSpecs`, `compactPreviousSections` | `app/src/lib/ai/agent/section-specs.ts` | Re-export blocker; rehome before folder deletion |

## Notes

- Probe 01's zero runtime-import result was real but incomplete; probe 10 shows the orchestrator tree is still load-bearing as a type/schema owner.
- Ten V3 agent files still depend on orchestrator-owned types or helpers, so Plan 3 needs an explicit shared-type rehoming step before any subtree delete.

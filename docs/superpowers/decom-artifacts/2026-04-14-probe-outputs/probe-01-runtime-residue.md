# Probe 01 — Runtime residue grep

**Run on:** 2026-04-14 against `master` at commit `1040228`.
**Spec reference:** Section 2, probe 1.
**Purpose:** Identify orchestrator import callsites outside the orchestrator folder (migration candidates) and orchestrator-internal files with no external import (delete candidates).

## Commands

```bash
rg -n "useOrchestrator|client-v2" app/src/
rg -n "from '@/lib/ai/orchestrator" app/src/ | rg -v "lib/ai/orchestrator/"
```

## Raw output

```text
## A. useOrchestrator and orchestrator string references in app/src
app/src/hooks/useOrchestrator.ts:48:export function useOrchestrator(locale: string) {
app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx:7:import { useOrchestrator } from '@/hooks/useOrchestrator';
app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx:41:  } = useOrchestrator(locale);

## B. Imports from @/lib/ai/orchestrator (excluding files inside the orchestrator/ folder)
(no matches)

## C. Files inside lib/ai/orchestrator/ with no external import
(derived from B above by enumeration; classify in the artifact)
```

## Classification

| File | Match type | Classification |
|------|-----------|----------------|
| `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx:7` | `useOrchestrator` import | Migration candidate for Plan 3 sub-step (a) |
| `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx:41` | `useOrchestrator(...)` call | Migration candidate for Plan 3 sub-step (a) |
| `app/src/hooks/useOrchestrator.ts:48` | Hook definition | Delete candidate after the last caller migrates |
| `(none)` | `client-v2` reference | No live string reference found in `app/src`; keep as a direct sweep target in Plan 3 sub-step (f) |
| `(none)` | Cross-folder `@/lib/ai/orchestrator/*` runtime import | No runtime importer outside the orchestrator tree found by this grep; re-export and type dependencies are handled by probe 10 |

## Notes

- The only runtime caller surfaced here is the dashboard `asistent-ai` page.
- Zero cross-folder runtime imports does not make the orchestrator subtree deletable; probe 10 shows the remaining type and re-export blockers.

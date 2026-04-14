# Probe 03 — Hook-callsite sweep

**Run on:** 2026-04-14 against `master` at commit `1040228`.
**Spec reference:** Section 2, probe 3.
**Purpose:** Binary classification — every `useOrchestrator` caller is either migrated to `useAgent` or still on the bridge. No third category.

## Commands

```bash
rg -n "import.*useOrchestrator|from '@/hooks/useOrchestrator'" app/src/
rg -n "useOrchestrator\(" app/src/ | rg -v "app/src/hooks/useOrchestrator"
rg -n "import.*useAgent\b|from '@/hooks/useAgent'" app/src/
```

## Raw output

```text
## useOrchestrator import sites
app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx:7:import { useOrchestrator } from '@/hooks/useOrchestrator';

## useOrchestrator call sites (excluding the hook definition)
app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx:41:  } = useOrchestrator(locale);

## useAgent comparison (target hook callers)
app/src/components/agent/SectionCard.tsx:1:import type { AgentSectionState } from '@/hooks/useAgent'
app/src/components/agent/AgentConversation.tsx:4:import type { AgentMessage, AgentStatus } from '@/hooks/useAgent'
app/src/components/agent/OutlineView.tsx:1:import type { AgentSectionState } from '@/hooks/useAgent'
app/src/components/agent/AgentWorkspace.tsx:4:import type { AgentSectionState } from '@/hooks/useAgent'
app/src/components/agent/ValidationSummary.tsx:1:import type { AgentSectionState } from '@/hooks/useAgent'
app/src/app/[locale]/(dashboard)/proiecte/nou/page.tsx:5:import { useAgent } from '@/hooks/useAgent'
```

## Classification

| File | Hook | Classification |
|------|------|----------------|
| `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx` | `useOrchestrator` | Still on bridge — migration target for Plan 3 sub-step (a) |
| `app/src/app/[locale]/(dashboard)/proiecte/nou/page.tsx` | `useAgent` | Already migrated |
| `app/src/components/agent/{SectionCard,AgentConversation,OutlineView,AgentWorkspace,ValidationSummary}.tsx` | `useAgent` type imports | Already on the target hook surface; informational only |

## Notes

- The expected orchestrator caller (`asistent-ai/page.tsx`) is the only live runtime caller.
- After that page migrates, `app/src/hooks/useOrchestrator.ts` should be able to retire, subject to a re-run of this probe.

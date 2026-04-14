# Orchestrator Retirement Sub-step (a) — Rubric Evidence

**Plan:** `docs/superpowers/plans/2026-04-14-decom-orchestrator-retirement.md`
**Spec:** `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md` Section 3.
**Sub-step:** (a) — rewrite `asistent-ai` to the V3 AgentWorkspace UX (not a hook swap; full product-decision-backed UX rewrite).
**Branch:** `chore/decom-orchestrator-a`.

## 1. Runtime ownership declaration

Retiring caller: `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx` (orchestrator wizard UX).
Replacement: V3 agent runtime — `useAgent` hook + `AgentConversation` + `AgentWorkspace` components from `@/components/agent/`. Same pattern as `proiecte/nou/page.tsx`.
Product decision cited in plan: the orchestrator wizard UX (5-step progress bar, checkpoint cards, multi-tab canvas, auto-approve timer) is retired.

## 2. Reference sweep

Command run from worktree root:

```
$ grep -nE "useOrchestrator|CheckpointRenderers|CanvasTabs|ProposalTab|StepProgressBar|currentStep|canvasState" \
    "app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx" || echo "(clean)"
(clean)
```

Wizard refs in the asistent-ai directory tree:

```
$ grep -rn "useOrchestrator\|wizard\|CheckpointRenderers\|CanvasTabs\|ProposalTab" \
    "app/src/app/[locale]/(dashboard)/asistent-ai/" || echo "(clean)"
(clean)
```

`useOrchestrator` callers in app source (after this sub-step):

```
$ grep -rln "useOrchestrator" app/src/
app/src/hooks/useOrchestrator.ts
```

Only the hook definition itself remains (to be retired by sub-step (c)). No call-sites.

## 3. Build and route-surface verification

- `next build`: **PASS** (full production build completed; route table rendered; `/[locale]/asistent-ai` still present as a dynamic page). Log tail captured in `/tmp/orch-a-build.log` during execution; final lines show the First Load JS shared bundle and the `(Static)` / `(Dynamic)` legend.
- `tsc --noEmit`: **PASS** — `npm run typecheck` exits 0 with no output beyond the script banner. Log at `/tmp/orch-a-typecheck.log`.
- Route surface unchanged: the page URL is the same `/[locale]/asistent-ai`. `?session=<id>` URL param preserved by `useSearchParams()?.get('session')` → `useAgent(locale, initialSessionId)`.

## 4. Feature flag / env var sweep

N/A for this sub-step — no flag or env var exclusively gates `useOrchestrator` or the wizard-era components. Sub-step (d) handles the `section_versioning` flag that gates orchestrator routes.

## 5. Test-surface cleanup

```
$ grep -rln "useOrchestrator\|CheckpointRenderers\|CanvasTabs\|ProposalTab\|StepProgressBar" app/tests/
(no matches)
```

No test files reference the retired wizard hook or deleted components. No test retargeting or deletions required in this sub-step.

Full test suite run: **192 test files / 1124 tests pass, 15 skipped, 2 todo, 5 file-skips** (Vitest run completed in 6.06s after transform/import). No failures.

## 6. Migration diff

UX rewrite, not field-name migration. Documented:

- **Files rewritten:** `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx` (407 lines → 63 lines).
- **Files deleted:** `CanvasTabs.tsx`, `CheckpointRenderers.tsx`, `ProposalTab.tsx`, `StepProgressBar.tsx`, `MarkdownPreview.tsx`, `StreamingDots.tsx` (6 files, 1083 lines removed). The `components/` directory became empty and was removed.
- **Files retained:** none — all six components under `asistent-ai/components/` were deleted. `MarkdownPreview` was only consumed by the deleted `ProposalTab`, and `StreamingDots` was only consumed by the old `page.tsx`; the V3 `AgentConversation` provides its own streaming indicator.
- **UX behavior changes:**
  - 5-step progress bar → V3 phase display via `AgentWorkspace`
  - Interactive checkpoint cards (select/confirm/freetext) → V3 conversational prompts via `AgentConversation`
  - Multi-tab canvas (calls / plan / proposal) → `AgentWorkspace` outline + section cards + validation summary
  - Auto-approve timer → removed (V3 requires explicit user action via `onAction`)
  - Two-arg `sendMessage(id, label)` for checkpoint options → removed (replaced by `agent.sendAction` / `agent.sendMessage`)
  - `startNewSession()` imperative → removed (session lifecycle owned by `useAgent`)
  - `resumeSession(sessionId)` via useEffect → replaced by `initialSessionId` hook param passed into `useAgent`

## 7. Observability sweep

No wizard-specific logs, metrics, or Sentry tags were attached to the deleted components or the previous `asistent-ai/page.tsx` — all were UI-only React components with no `logAudit`, `Sentry.captureMessage`, or metrics emission. Route-level logging is preserved because the URL (`/[locale]/asistent-ai`) is unchanged, so any middleware/edge logging keyed on path continues unaffected. Negative result: expected and confirmed.

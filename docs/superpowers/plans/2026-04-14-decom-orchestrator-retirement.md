# Orchestrator Retirement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the V2 orchestrator runtime (`lib/ai/orchestrator/*`, `useOrchestrator` hook, `/api/ai/orchestrator/*` routes) from the repository, replaced by the V3 agent runtime (`useAgent`, `/api/ai/agent/*`) that is already the write-path keeper. Per spec Section 1 Axis 3, this is the "delete legacy" retirement cluster — blocked on rehoming orchestrator-owned shared types first.

**Architecture:** Six sequential sub-steps, each landing as its own rubric-carrying PR so blast radius stays reviewable. Each PR branches off the current master (not stacked) — after a sub-step's PR merges, the next sub-step rebases off fresh master. Strict dependency order: (a) migrate the last `useOrchestrator` caller → (b) rehome shared types → (c) delete hook → (d) delete routes → (e) delete folder → (f) sweep `client-v2.ts`. Each sub-step carries the seven-check rubric per spec Section 3.

**Tech Stack:** bash + ripgrep + `next build` + `tsc` + `vitest` + `git`.

**Spec reference:** `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md` Sections 1 (Axis 3), 3 (rubric), 4 Phase 2 (orchestrator track).
**Input contract:** `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/track-candidates.md` Track A; also consults probe artifacts 01, 03, 04, 07, 09, 10.

---

## Cross-cutting concerns (applies to every sub-step)

### Rubric evidence location

Each sub-step's PR carries an evidence file at `docs/superpowers/decom-artifacts/2026-04-14-orchestrator-retirement/sub-step-<letter>-rubric-evidence.md` with all seven checks populated. Evidence files accumulate on master — each sub-step's PR includes only its own evidence file.

### Worktree pattern

Each sub-step gets a fresh worktree off current master:

```bash
git -C /home/godja/Dev/EU-Funds fetch origin master
git -C /home/godja/Dev/EU-Funds worktree add -b chore/decom-orchestrator-<letter> /home/godja/Dev/EU-Funds-decom-orch-<letter> origin/master
```

After each sub-step's PR merges, remove the old worktree (`git worktree remove`) before starting the next sub-step's setup.

### Verification commands (standard)

Every sub-step runs these before opening its PR:

```bash
cd <worktree>/app && npm run build 2>&1 | tail -20   # rubric item 3 build
cd <worktree>/app && npm run typecheck 2>&1 | tail -10   # rubric item 3 typecheck
cd <worktree>/app && npm run test 2>&1 | tail -30   # rubric item 5 test
```

Expected: all pass. Pass count on `npm run test` compared against the master baseline from MEMORY.md "Known Pre-existing Test Failures" — new failures must be triaged before commit.

### Retiring cross-cutting resources

These retire with whichever sub-step's PR is the last to touch their owning surface (tracked sub-step by sub-step below):

- **Feature flag** `section_versioning` — retires with sub-step (d) orchestrator-route deletion (flag guards orchestrator section-versioning routes).
- **Tests** to delete: `app/tests/unit/{agent-build,agent-plan,agent-research,agent-enhance,agent-edit,agent-match,orchestrator-qa,orchestrator-types,section-specs}.test.ts`, `app/tests/unit/services/blueprint.test.ts`, `app/tests/unit/export-docx.test.ts` — these retire in the sub-step that deletes the surface they test (noted per-sub-step below).

---

## Sub-step (a): Rewrite `asistent-ai` to the V3 AgentWorkspace UX

> **Product decision (2026-04-14):** The orchestrator wizard UX — 5-step progress bar, interactive checkpoint cards (select/confirm/freetext), multi-tab canvas (calls/plan/proposal), and auto-approve timer — is **retired**. The V3 agent runtime was intentionally designed for a different UX (AgentConversation + AgentWorkspace) and is not API-compatible with `useOrchestrator`. Forcing an adapter would preserve the very legacy contract the program is retiring and would make later deletion harder. Sub-step (a) therefore rewrites the `asistent-ai` page against the V3 UX directly and retires the wizard-era child components.

**Sub-step scope:** Rewrite `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx` to use `useAgent` with the `AgentConversation` + `AgentWorkspace` component pattern already proven by `proiecte/nou/page.tsx`. Delete the wizard-era child components under `asistent-ai/components/` that are coupled to orchestrator-shaped data (`CheckpointRenderers`, `CanvasTabs`, `ProposalTab`, `StepProgressBar`). Generic components in that folder (`MarkdownPreview`, `StreamingDots`) are candidates for retention or retirement based on whether the rewritten page uses them.

**Input evidence:**
- Track A sub-step (a) — sole remaining `useOrchestrator` caller.
- Reference pattern: `app/src/app/[locale]/(dashboard)/proiecte/nou/page.tsx` using `useAgent` + `AgentConversation` + `AgentWorkspace` from `@/components/agent/`.

**Preconditions:** None (this is the first sub-step). This reframe is itself a precondition that has been satisfied by the patch that produced this plan revision.

**URL contract:** `/[locale]/asistent-ai` stays; this is the target route layer per spec Section 1 Axis 1. No URL change visible to users or bookmarks.

### Task a0: Worktree setup

- [ ] **Step 1: Fetch master and create worktree**

Run:
```bash
git -C /home/godja/Dev/EU-Funds fetch origin master && \
  git -C /home/godja/Dev/EU-Funds worktree add -b chore/decom-orchestrator-a /home/godja/Dev/EU-Funds-decom-orch-a origin/master
```

- [ ] **Step 2: Verify worktree clean**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-a && git status && git log --oneline -3
```
Expected: clean, HEAD at current master.

- [ ] **Step 3: Create evidence directory**

Run:
```bash
mkdir -p /home/godja/Dev/EU-Funds-decom-orch-a/docs/superpowers/decom-artifacts/2026-04-14-orchestrator-retirement
```

### Task a1: Audit the rewrite scope

The purpose of this task is not to produce a migration table (that was the failed framing). The purpose is to enumerate exactly which files are being rewritten or deleted, and which V3 components are the rewrite target.

- [ ] **Step 1: Read the current asistent-ai page and its components folder**

Run:
```bash
cat /home/godja/Dev/EU-Funds-decom-orch-a/app/src/app/[locale]/\(dashboard\)/asistent-ai/page.tsx
ls /home/godja/Dev/EU-Funds-decom-orch-a/app/src/app/[locale]/\(dashboard\)/asistent-ai/components/
```
Expected: prints current (orchestrator-based) implementation and its component folder. Folder should include `CanvasTabs.tsx`, `CheckpointRenderers.tsx`, `ProposalTab.tsx`, `StepProgressBar.tsx` (wizard-era), plus `MarkdownPreview.tsx`, `StreamingDots.tsx` (possibly generic).

- [ ] **Step 2: Read the reference page pattern**

Run:
```bash
cat /home/godja/Dev/EU-Funds-decom-orch-a/app/src/app/[locale]/\(dashboard\)/proiecte/nou/page.tsx
ls /home/godja/Dev/EU-Funds-decom-orch-a/app/src/components/agent/
```
Expected: prints `proiecte/nou/page.tsx` — the pattern the rewrite models itself on — and the agent component directory (should include `AgentConversation`, `AgentWorkspace`, `SectionCard`, `OutlineView`, `ValidationSummary`, `WarningsBar`).

- [ ] **Step 3: Verify wizard-era components are only consumed by `asistent-ai/page.tsx`**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-a && {
  for comp in CanvasTabs CheckpointRenderers ProposalTab StepProgressBar; do
    echo "## $comp consumers"
    rg -n "$comp" app/src/ 2>/dev/null | rg -v "app/src/app/\[locale\]/\(dashboard\)/asistent-ai/components/$comp\.tsx" || echo "(no external consumers)"
    echo
  done
}
```
Expected: each should show only the `asistent-ai/page.tsx` import line and no other consumers. If any component is consumed elsewhere, pause and escalate — it becomes shared surface rather than `asistent-ai`-local.

- [ ] **Step 4: Check `MarkdownPreview` and `StreamingDots` for external consumers**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-a && {
  for comp in MarkdownPreview StreamingDots; do
    echo "## $comp consumers"
    rg -n "$comp" app/src/ 2>/dev/null | rg -v "app/src/app/\[locale\]/\(dashboard\)/asistent-ai/components/$comp\.tsx" || echo "(no external consumers)"
    echo
  done
}
```
If external consumers exist: KEEP the component, its retirement belongs to a different workstream. If no external consumers AND the rewritten page (Task a3) doesn't use it: delete along with the wizard-era components. If no external consumers BUT the rewritten page does use it: keep.

- [ ] **Step 5: Document the scope decision for the rubric evidence (Task a4)**

Capture in notes for Task a4:
- Files being rewritten (just `asistent-ai/page.tsx`).
- Files being deleted (the wizard-era component list from Step 3, plus any from Step 4 that fail the "keep" criteria).
- Files being kept (any generic components the rewrite ends up using).
- V3 components the rewrite imports (from `@/components/agent/`).

### Task a2: Delete wizard-era child components

- [ ] **Step 1: Delete the four known wizard-era components**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-a && git rm \
  app/src/app/[locale]/\(dashboard\)/asistent-ai/components/CanvasTabs.tsx \
  app/src/app/[locale]/\(dashboard\)/asistent-ai/components/CheckpointRenderers.tsx \
  app/src/app/[locale]/\(dashboard\)/asistent-ai/components/ProposalTab.tsx \
  app/src/app/[locale]/\(dashboard\)/asistent-ai/components/StepProgressBar.tsx
```
Expected: four files shown as `rm`.

- [ ] **Step 2: Delete generic components if Task a1 Step 4 classified them as delete**

Only if the task a1 Step 4 audit returned zero external consumers AND the rewritten page in Task a3 will not use the component, run:

```bash
cd /home/godja/Dev/EU-Funds-decom-orch-a && git rm app/src/app/[locale]/\(dashboard\)/asistent-ai/components/<component>.tsx
```

Otherwise skip.

- [ ] **Step 3: If the `components/` directory becomes empty after deletions, remove it**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-a && find app/src/app/[locale]/\(dashboard\)/asistent-ai/components -type d -empty -delete
```

- [ ] **Step 4: Commit the component deletions**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-a && git -c commit.gpgsign=false commit -m "feat(decom): delete wizard-era asistent-ai child components

Part of Plan 3 sub-step (a) — the V2 orchestrator wizard UX is retired
(product decision 2026-04-14). These components were coupled to orchestrator-
shaped data (5-step progress, checkpoint select/confirm/freetext, multi-tab
canvas, proposal tab) and have no V3 equivalent. The asistent-ai page is
rewritten in the next commit to use the V3 AgentWorkspace UX pattern."
```

### Task a3: Rewrite `asistent-ai/page.tsx` to the V3 AgentWorkspace pattern

- [ ] **Step 1: Replace the page implementation**

Overwrite `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx` with a V3-based implementation modeled after `proiecte/nou/page.tsx`. The rewrite must:

- Use `useAgent(locale as 'ro' | 'en', initialSessionId)` — if the page historically supported `?session=<id>` URL params (check the old page for `useSearchParams` usage), preserve that behavior.
- Use `AgentConversation` from `@/components/agent/AgentConversation` for the chat surface.
- Use `AgentWorkspace` from `@/components/agent/AgentWorkspace` for the right-hand panel (outline, sections, validation).
- Import `useTranslations` from `next-intl` and use the existing `asistentAi` namespace keys (or whatever the translation file currently provides — verify by reading `app/src/messages/ro.json` and `en.json`).
- Preserve any page-level features that are still meaningful in V3: page title, locale-aware metadata if present.
- DO NOT import any of the deleted wizard-era components.
- DO NOT re-create checkpoint rendering, step progress, or canvas-tab scaffolding — those are retired.

Reference the structure of `proiecte/nou/page.tsx` exactly where applicable; adapt only for page-specific differences (the asistent-ai route might not be scoped to a specific project, so `useAgent` is called with no project context).

- [ ] **Step 2: Verify no wizard references remain**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-a && {
  echo "## Still-present wizard references in the rewritten page"
  rg -n "useOrchestrator|CheckpointRenderers|CanvasTabs|ProposalTab|StepProgressBar|currentStep|canvasState" app/src/app/[locale]/\(dashboard\)/asistent-ai/page.tsx 2>/dev/null || echo "(clean)"
}
```
Expected: `(clean)`.

- [ ] **Step 3: Typecheck the rewritten page**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-a/app && npm run typecheck 2>&1 | tee /tmp/orch-a-typecheck.log | tail -30
```
Expected: zero errors. If errors appear in the page, iterate until clean. If errors appear in OTHER files, investigate — those files may have depended on the wizard-era components, which is a signal that Task a1 Step 3's audit missed a consumer; in that case escalate.

- [ ] **Step 4: Commit the rewrite**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-a && git add app/src/app/[locale]/\(dashboard\)/asistent-ai/page.tsx && git -c commit.gpgsign=false commit -m "feat(agent): rewrite asistent-ai page against V3 AgentWorkspace UX

Replaces the orchestrator wizard UX (5-step progress + checkpoint cards + multi-tab
canvas + auto-approve timer) with the V3 pattern used by proiecte/nou/page.tsx:
useAgent hook + AgentConversation + AgentWorkspace. Product decision 2026-04-14.

Last remaining useOrchestrator caller removed, unblocking sub-steps (c) through (f)
of plan 2026-04-14-decom-orchestrator-retirement.md."
```

### Task a4: Rubric evidence file

- [ ] **Step 1: Create the evidence file**

Create `/home/godja/Dev/EU-Funds-decom-orch-a/docs/superpowers/decom-artifacts/2026-04-14-orchestrator-retirement/sub-step-a-rubric-evidence.md`:

```markdown
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

<command A: verify wizard references gone from rewritten page>
<output A: should be clean>

<command B: verify useOrchestrator no longer has callers in app code>
<output B: zero matches outside the hook definition file (which retires with sub-step c)>

## 3. Build and route-surface verification

- `next build`: <PASS / FAIL with any notes>
- `tsc --noEmit`: <PASS / FAIL>
- Route surface unchanged (page URL is the same `/[locale]/asistent-ai`).

## 4. Feature flag / env var sweep

N/A for this sub-step — no flag or env var exclusively gates `useOrchestrator` or the wizard-era components. Sub-step (d) handles the `section_versioning` flag that gates orchestrator routes.

## 5. Test-surface cleanup

<run `rg -ln "useOrchestrator\|CheckpointRenderers\|CanvasTabs\|ProposalTab\|StepProgressBar" app/tests/` and classify any matches>

- If zero: no test cleanup in this sub-step.
- If non-zero: each such test is either retargeted to the V3 surface in the same PR, or deleted if only exercising retired behaviour.

## 6. Migration diff

This is a UX rewrite, not a field-name migration. Document:

- **Files rewritten:** `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx` (complete rewrite against `useAgent` + `AgentConversation` + `AgentWorkspace`).
- **Files deleted:** `CanvasTabs.tsx`, `CheckpointRenderers.tsx`, `ProposalTab.tsx`, `StepProgressBar.tsx` (wizard-era, no V3 equivalent).
- **Files retained:** <list of generic components retained, e.g., MarkdownPreview or StreamingDots if still used by the rewritten page>.
- **UX behavior changes:**
  - 5-step progress bar → V3 phase display via `AgentWorkspace`.
  - Interactive checkpoint select/confirm/freetext cards → V3 conversational prompts handled by `AgentConversation`.
  - Multi-tab canvas (calls/plan/proposal) → `AgentWorkspace` outline + section cards + validation summary.
  - Auto-approve timer → removed (no V3 equivalent; V3 requires explicit user action).
  - Two-arg `sendMessage(id, label)` for checkpoint option → removed (V3 checkpoints are informational).
  - `startNewSession()` imperative → removed (V3 session lifecycle is managed differently).
  - `resumeSession(sessionId)` via `useEffect` → replaced by `initialSessionId` param on `useAgent` hook init.

## 7. Observability sweep

Wizard-specific logs/metrics/Sentry tags (if any existed on the deleted components or page): list here. The deleted components contained no custom telemetry beyond what their consumers emitted. Route-level logging (if any) is preserved because the route URL is unchanged.
```

- [ ] **Step 2: Fill in every `<...>` placeholder with actual data**

Replace each angle-bracket placeholder with the concrete output from Tasks a1, a2, a3, and the upcoming Task a5 build/test results. The "files retained" list comes from Task a1 Step 4 decisions and Task a2 Step 2 actions.

- [ ] **Step 3: Verify no placeholders remain**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-a && grep -c "<PASS\|<fill\|<paste\|<command\|<output\|<run\|<list" docs/superpowers/decom-artifacts/2026-04-14-orchestrator-retirement/sub-step-a-rubric-evidence.md
```
Expected: `0`.

- [ ] **Step 4: Commit the evidence**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-a && git add docs/superpowers/decom-artifacts/2026-04-14-orchestrator-retirement/sub-step-a-rubric-evidence.md && git -c commit.gpgsign=false commit -m "chore(decom): sub-step (a) rubric evidence"
```

### Task a5: Build, test, push, PR

- [ ] **Step 1: Run build, typecheck, test**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-a/app && npm run build 2>&1 | tail -20 && npm run typecheck 2>&1 | tail -10 && npm run test 2>&1 | tail -30
```
Expected: all pass. If any fails, diagnose and fix before proceeding. Update rubric evidence Section 3 with actual results.

- [ ] **Step 2: Push**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-a && git push -u origin chore/decom-orchestrator-a
```

- [ ] **Step 3: Open PR**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-a && gh pr create --title "feat(agent): rewrite asistent-ai page to V3 AgentWorkspace UX" --body "$(cat <<'EOF'
## Summary

Sub-step (a) of the orchestrator retirement program, reframed per 2026-04-14 product decision: the V2 orchestrator wizard UX is retired, not migrated. The V3 agent runtime's \`useAgent\` hook is intentionally not API-compatible with \`useOrchestrator\`, and forcing an adapter would preserve the legacy contract the program is retiring.

This PR:

- Deletes wizard-era child components (\`CanvasTabs\`, \`CheckpointRenderers\`, \`ProposalTab\`, \`StepProgressBar\`) that were coupled to orchestrator-shaped data.
- Rewrites \`app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx\` against the V3 UX pattern (\`useAgent\` + \`AgentConversation\` + \`AgentWorkspace\`) already proven by \`proiecte/nou/page.tsx\`.
- Preserves the \`/[locale]/asistent-ai\` URL so bookmarks are unaffected.

Last remaining \`useOrchestrator\` caller removed — unblocks sub-steps (b)-(f) of the plan.

## Rubric evidence

\`docs/superpowers/decom-artifacts/2026-04-14-orchestrator-retirement/sub-step-a-rubric-evidence.md\`

## Test plan

- [ ] CI passes under current gating policy
- [ ] Manual smoke: \`/ro/asistent-ai\` loads and renders the V3 AgentConversation + AgentWorkspace layout
- [ ] No references to wizard-era components remain in the codebase (covered in rubric Section 2)

## Plan reference

\`docs/superpowers/plans/2026-04-14-decom-orchestrator-retirement.md\` sub-step (a) (reframed).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Merge when CI passes, then remove the worktree**

After merge:
```bash
git -C /home/godja/Dev/EU-Funds worktree remove /home/godja/Dev/EU-Funds-decom-orch-a
```

---

## Sub-step (b): Rehome orchestrator-owned shared types and helpers

**Sub-step scope:** Move types and helpers currently living under `@/lib/ai/orchestrator/types` and `@/lib/ai/orchestrator/section-specs` to agent-owned modules, update every importer. This is the largest sub-step and the one that converts the retirement from "policy" to "unblocked."

**Input evidence:** Track A sub-step (b) — four type/helper groups and their importers.

**Preconditions:** Sub-step (a) merged.

### Rehoming plan

Target locations:

| Type/helper | Current | Target |
|-------------|---------|--------|
| `CallBlueprint`, `SectionSpec` | `@/lib/ai/orchestrator/types` | `@/lib/ai/agent/types` |
| `SectionResult` | `@/lib/ai/orchestrator/types` | `@/lib/ai/agent/types` |
| `SubmissionDocument` | `@/lib/ai/orchestrator/types` | `@/lib/ai/agent/types` |
| `DEFAULT_SECTIONS`, `buildSectionSpecs`, `compactPreviousSections` | `@/lib/ai/orchestrator/section-specs` | `@/lib/ai/agent/section-specs` |

All four groups land in agent-owned modules. No new top-level module is created; existing `app/src/lib/ai/agent/types.ts` and `app/src/lib/ai/agent/section-specs.ts` absorb the content. If a type name collision occurs in `agent/types.ts`, rename the orchestrator-side name to something axis-neutral (e.g., `CallBlueprint` stays, but verify by reading current `agent/types.ts` first).

### Task b0: Worktree setup

- [ ] **Step 1: Fetch latest master (which now includes sub-step (a)) and create worktree**

Run:
```bash
git -C /home/godja/Dev/EU-Funds fetch origin master && \
  git -C /home/godja/Dev/EU-Funds worktree add -b chore/decom-orchestrator-b /home/godja/Dev/EU-Funds-decom-orch-b origin/master
```

- [ ] **Step 2: Verify sub-step (a) landed**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-b && rg -n "useOrchestrator" app/src/app/[locale]/\(dashboard\)/asistent-ai/page.tsx 2>/dev/null
```
Expected: no matches (sub-step (a) migrated it).

### Task b1: Read current state of both sides

- [ ] **Step 1: Read orchestrator-owned types**

Run:
```bash
cat /home/godja/Dev/EU-Funds-decom-orch-b/app/src/lib/ai/orchestrator/types.ts
cat /home/godja/Dev/EU-Funds-decom-orch-b/app/src/lib/ai/orchestrator/section-specs.ts
```
Expected: prints the contents. Capture each exported identifier.

- [ ] **Step 2: Read agent-owned types**

Run:
```bash
cat /home/godja/Dev/EU-Funds-decom-orch-b/app/src/lib/ai/agent/types.ts
cat /home/godja/Dev/EU-Funds-decom-orch-b/app/src/lib/ai/agent/section-specs.ts
```
Expected: prints the contents. Identify any name collisions with orchestrator-side identifiers.

- [ ] **Step 3: Enumerate every importer**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-b && {
  echo "## Importers of @/lib/ai/orchestrator/types"
  rg -n "from ['\"]@/lib/ai/orchestrator/types" app/src/ app/tests/
  echo
  echo "## Importers of @/lib/ai/orchestrator/section-specs"
  rg -n "from ['\"]@/lib/ai/orchestrator/section-specs" app/src/ app/tests/
} > /tmp/orch-b-importers.txt
cat /tmp/orch-b-importers.txt
```
Expected: full list. Per Track A, importers span `app/src/lib/ai/agent/*`, `app/src/lib/compliance/form-templates.ts`, `app/src/lib/export/docx.ts`, `app/src/app/api/v1/workspace/route.ts`, project sections API, submission-documents API, plus dashboard project pages.

### Task b2: Move each type/helper group one at a time

One commit per group keeps the diff reviewable.

- [ ] **Step 1: Group 1 — `CallBlueprint`, `SectionSpec`**

  - [ ] Step 1.1: Open `app/src/lib/ai/orchestrator/types.ts`, locate the `export` statements for `CallBlueprint` and `SectionSpec`. Copy the full declarations (interface/type body included) to `app/src/lib/ai/agent/types.ts`, appending after the existing exports. Resolve any import dependencies inside the copied declarations by updating relative paths or adding imports at the top of `agent/types.ts`.
  - [ ] Step 1.2: In `app/src/lib/ai/orchestrator/types.ts`, replace the original `CallBlueprint` and `SectionSpec` exports with a re-export from the new location: `export type { CallBlueprint, SectionSpec } from '@/lib/ai/agent/types';`. This keeps importers working during the transition.
  - [ ] Step 1.3: Run typecheck to confirm no regressions:
    ```bash
    cd /home/godja/Dev/EU-Funds-decom-orch-b/app && npm run typecheck 2>&1 | tail -10
    ```
    Expected: zero errors.
  - [ ] Step 1.4: Update every importer to import directly from `@/lib/ai/agent/types` instead of `@/lib/ai/orchestrator/types`:
    ```bash
    cd /home/godja/Dev/EU-Funds-decom-orch-b && rg -l "from ['\"]@/lib/ai/orchestrator/types['\"]" app/src/ app/tests/ | while read f; do
      sed -i "s|from '@/lib/ai/orchestrator/types'|from '@/lib/ai/agent/types'|g" "$f"
      sed -i 's|from "@/lib/ai/orchestrator/types"|from "@/lib/ai/agent/types"|g' "$f"
    done
    ```
    (Only the `CallBlueprint`/`SectionSpec` importers actually need this change for this group, but the pattern is safe — agent/types.ts will re-export each group after all four groups are moved.)
  - [ ] Step 1.5: Run typecheck again:
    ```bash
    cd /home/godja/Dev/EU-Funds-decom-orch-b/app && npm run typecheck 2>&1 | tail -10
    ```
    Expected: zero errors.
  - [ ] Step 1.6: Commit:
    ```bash
    cd /home/godja/Dev/EU-Funds-decom-orch-b && git add -A && git -c commit.gpgsign=false commit -m "refactor(agent): rehome CallBlueprint and SectionSpec from orchestrator/types to agent/types"
    ```

- [ ] **Step 2: Group 2 — `SectionResult`**

Same four sub-steps as Step 1, but for `SectionResult`. Note: `SectionResult` has broader fan-out (hooks, dashboard pages, export, workspace API, orchestrator rollback routes). Commit message: `refactor(agent): rehome SectionResult from orchestrator/types to agent/types`.

- [ ] **Step 3: Group 3 — `SubmissionDocument`**

Same pattern. Importers per Track A: `app/src/lib/compliance/form-templates.ts`, dashboard project page, `app/src/app/api/v1/projects/[id]/submission-documents/[docId]/route.ts`. Commit message: `refactor(agent): rehome SubmissionDocument from orchestrator/types to agent/types`.

- [ ] **Step 4: Group 4 — `DEFAULT_SECTIONS`, `buildSectionSpecs`, `compactPreviousSections`**

These are helpers, not types. Move from `@/lib/ai/orchestrator/section-specs` to `@/lib/ai/agent/section-specs`. Same four-step pattern. Commit message: `refactor(agent): rehome section-specs helpers from orchestrator to agent`.

### Task b3: Remove the now-empty orchestrator re-export files (or keep them as thin passthroughs)

- [ ] **Step 1: Decide whether to delete the re-export shim now or defer to sub-step (e)**

The `orchestrator/types.ts` and `orchestrator/section-specs.ts` files are now pure re-export shims. Options:

- **Delete now (preferred):** sub-step (e)'s folder deletion becomes cleaner. But requires updating any straggler importers that the sed commands missed.
- **Defer to sub-step (e):** shim files stay until the whole folder is deleted.

Recommendation: delete now if probe 10 re-run returns zero orchestrator/types/section-specs importers; defer otherwise.

- [ ] **Step 2: Re-run probe 10 to confirm zero importers**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-b && rg -n "from ['\"]@/lib/ai/orchestrator/(types|section-specs)" app/src/ app/tests/ 2>&1 || echo "(none remaining)"
```

Expected: `(none remaining)`. If any remain, fix them before proceeding.

- [ ] **Step 3: Delete the shim files if Step 2 is clean**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-b && git rm app/src/lib/ai/orchestrator/types.ts app/src/lib/ai/orchestrator/section-specs.ts
```

- [ ] **Step 4: Re-run typecheck**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-b/app && npm run typecheck 2>&1 | tail -10
```
Expected: zero errors.

- [ ] **Step 5: Commit**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-b && git -c commit.gpgsign=false commit -m "refactor(agent): delete orchestrator re-export shims now that all types are rehomed"
```

### Task b4: Rubric evidence, build/test, push, PR

- [ ] **Step 1: Write evidence file**

Create `docs/superpowers/decom-artifacts/2026-04-14-orchestrator-retirement/sub-step-b-rubric-evidence.md` following the template pattern of sub-step (a)'s evidence file. Populate:

- Item 1 — ownership: types now owned by agent modules.
- Item 2 — reference sweep: `rg -n "from '@/lib/ai/orchestrator/(types|section-specs)" app/src/ app/tests/` returns zero.
- Item 3 — build/typecheck/test results.
- Item 4 — N/A (no flag/env scoped to these types).
- Item 5 — any test migrations.
- Item 6 — migration diff: summarize the four group moves.
- Item 7 — observability: N/A (type definitions don't carry telemetry).

- [ ] **Step 2: Build, typecheck, test**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-b/app && npm run build 2>&1 | tail -20 && npm run typecheck 2>&1 | tail -10 && npm run test 2>&1 | tail -30
```
Expected: all pass.

- [ ] **Step 3: Commit evidence, push, open PR**

```bash
cd /home/godja/Dev/EU-Funds-decom-orch-b && git add docs/superpowers/decom-artifacts/2026-04-14-orchestrator-retirement/sub-step-b-rubric-evidence.md && git -c commit.gpgsign=false commit -m "chore(decom): sub-step (b) rubric evidence"
git push -u origin chore/decom-orchestrator-b
gh pr create --title "refactor(agent): rehome orchestrator-owned types to agent modules" --body "$(cat <<'EOF'
## Summary

Sub-step (b) of the orchestrator retirement program. Moves CallBlueprint, SectionSpec, SectionResult, SubmissionDocument, and section-specs helpers from orchestrator-owned modules to agent-owned modules. Unblocks sub-step (e) folder deletion.

## Rubric evidence

\`docs/superpowers/decom-artifacts/2026-04-14-orchestrator-retirement/sub-step-b-rubric-evidence.md\`

## Test plan

- [ ] CI passes; all importers typecheck cleanly against the new locations.
- [ ] No behavioural change — types are structurally identical; only import paths changed.

## Plan reference

\`docs/superpowers/plans/2026-04-14-decom-orchestrator-retirement.md\`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Merge, remove worktree**

---

## Sub-step (c): Delete `useOrchestrator.ts` hook

**Preconditions:** Sub-step (a) merged (only caller migrated).

### Task c0: Worktree setup

- [ ] **Step 1: Fetch master, create worktree `chore/decom-orchestrator-c` at `/home/godja/Dev/EU-Funds-decom-orch-c`**

Run:
```bash
git -C /home/godja/Dev/EU-Funds fetch origin master && \
  git -C /home/godja/Dev/EU-Funds worktree add -b chore/decom-orchestrator-c /home/godja/Dev/EU-Funds-decom-orch-c origin/master
```

### Task c1: Pre-delete reference sweep

- [ ] **Step 1: Confirm zero importers**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-c && rg -n "useOrchestrator" app/src/ app/tests/ app/e2e/ 2>/dev/null | rg -v "app/src/hooks/useOrchestrator"
```
Expected: zero matches. If any remain, STOP — sub-step (a) was incomplete or a new caller was introduced since. Address before continuing.

### Task c2: Delete the hook

- [ ] **Step 1: Delete the file**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-c && git rm app/src/hooks/useOrchestrator.ts
```

- [ ] **Step 2: Commit**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-c && git -c commit.gpgsign=false commit -m "feat(decom): delete useOrchestrator hook

Zero importers after sub-step (a). Part of plan 2026-04-14-decom-orchestrator-retirement.md."
```

### Task c3: Rubric evidence, build, PR

- [ ] **Step 1: Create evidence file** `sub-step-c-rubric-evidence.md` following the standard template. Items 1-7:
  - Item 1 — ownership: deletion, no replacement needed (callers already migrated in (a)).
  - Item 2 — reference sweep zero-count confirmation.
  - Item 3 — build/typecheck/test pass.
  - Items 4, 6, 7 — N/A for a pure hook delete.
  - Item 5 — any test importing `useOrchestrator` is deleted in this PR.

- [ ] **Step 2: Build, typecheck, test**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-c/app && npm run build 2>&1 | tail -20 && npm run typecheck 2>&1 | tail -10 && npm run test 2>&1 | tail -30
```
Expected: all pass.

- [ ] **Step 3: Commit evidence, push, open PR titled `feat(decom): delete useOrchestrator hook`**

Body cites the evidence file. Merge when CI passes.

---

## Sub-step (d): Delete orchestrator API routes

**Preconditions:** Sub-step (b) merged (shared types no longer live under orchestrator).

**Scope:** Delete all 7 route files listed in Track A sub-step (d). Also retire the `section_versioning` feature flag in the same PR.

### Task d0: Worktree setup

- [ ] **Step 1: Create worktree `chore/decom-orchestrator-d` at `/home/godja/Dev/EU-Funds-decom-orch-d`**

Same pattern as previous sub-steps.

### Task d1: Pre-delete reference sweep

- [ ] **Step 1: Sweep each of the 7 route URLs**

Must cover all 7 route files listed in Task d2 — including the parameterized rollback/state/versions endpoints. For parameterized routes, sweep the static path prefix plus the distinguishing suffix so parameterized callers (`/api/ai/orchestrator/sessions/<uuid>/sections/<uuid>/rollback`) are caught regardless of the literal UUID.

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-d && {
  # Non-parameterized routes
  for route in \
    /api/ai/orchestrator/message \
    /api/ai/orchestrator/messages \
    /api/ai/orchestrator/stream; do
    echo "## $route"
    rg -n "['\"\\\`]$route" app/src/ app/tests/ 2>/dev/null || echo "(none)"
    echo
  done

  # Sessions listing (static path, but matches the parameterized prefix too — disambiguate by grepping the exact literal with a boundary)
  echo "## /api/ai/orchestrator/sessions (listing, not parameterized)"
  rg -n "['\"\\\`]/api/ai/orchestrator/sessions['\"\\\`]" app/src/ app/tests/ 2>/dev/null || echo "(none)"
  echo

  # Parameterized routes — sweep by distinguishing suffix inside the orchestrator/sessions path
  for suffix in rollback state versions; do
    echo "## /api/ai/orchestrator/sessions/<sessionId>/sections/<sectionId>/$suffix"
    rg -n "/api/ai/orchestrator/sessions/[^'\"\\\`]*/sections/[^'\"\\\`]*/$suffix" app/src/ app/tests/ 2>/dev/null || echo "(none)"
    echo
  done

  # Bulk-path check — any orchestrator-namespaced fetch we missed above
  echo "## Any other /api/ai/orchestrator/* string references"
  rg -n "/api/ai/orchestrator/" app/src/ app/tests/ 2>/dev/null || echo "(none)"
} > /tmp/orch-d-refs.txt
cat /tmp/orch-d-refs.txt
```

Expected: 0 frontend refs per route per Track A. The `sessions` listing shows 3 test refs — those tests are deleted in Task d3. Parameterized-route sweeps should show zero matches (the V3-analogue routes were already removed in an earlier cascade commit per the spec). The bulk check at the end catches any orchestrator-namespaced call missed by the explicit patterns above; any hit must be classified (migrated or deleted) before Task d2 proceeds.

- [ ] **Step 2: Flag sweep**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-d && rg -n "section_versioning" app/src/ app/tests/ app/drizzle/
```
Expected: lists flag readers and the seed migration. Plan to retire all in this PR.

### Task d2: Delete route files

- [ ] **Step 1: Delete the 7 route files**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-d && git rm \
  app/src/app/api/ai/orchestrator/message/route.ts \
  app/src/app/api/ai/orchestrator/messages/route.ts \
  app/src/app/api/ai/orchestrator/sessions/route.ts \
  app/src/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/rollback/route.ts \
  app/src/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/state/route.ts \
  app/src/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/versions/route.ts \
  app/src/app/api/ai/orchestrator/stream/route.ts
```
Expected: all 7 files shown as `rm`.

- [ ] **Step 2: Remove empty directories**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-d && find app/src/app/api/ai/orchestrator -type d -empty -delete
```
Expected: removes the now-empty subtree.

- [ ] **Step 3: Commit route deletion**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-d && git -c commit.gpgsign=false commit -m "feat(decom): delete /api/ai/orchestrator/* routes

7 route files. Per plan 2026-04-14-decom-orchestrator-retirement.md Track A sub-step (d)."
```

### Task d3: Delete corresponding tests

- [ ] **Step 1: Identify orchestrator-route tests**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-d && rg -ln "orchestrator" app/tests/ 2>/dev/null
```
Expected: lists test files that exercise orchestrator routes.

- [ ] **Step 2: Delete route-specific tests**

For each test file whose sole purpose is exercising a retired route, run `git rm <file>`. Tests that exercise a keeper surface *through* an orchestrator route stay — those get migrated, not deleted.

Also delete:
- `app/tests/unit/agent-{build,plan,research,enhance,edit,match}.test.ts`
- `app/tests/unit/orchestrator-qa.test.ts`
- `app/tests/unit/orchestrator-types.test.ts`

Commit message: `feat(decom): delete orchestrator-route and orchestrator-runtime tests`.

### Task d4: Retire `section_versioning` feature flag

- [ ] **Step 1: Remove the flag key readers from code**

Locate and remove any remaining `isFeatureEnabled('section_versioning')` calls. After sub-step (b) rehoming and this sub-step's route deletion, these calls should only be inside code that is being deleted — verify and remove.

- [ ] **Step 2: Create a migration to drop the flag row**

New migration file `app/drizzle/<next-number>_drop_section_versioning_flag.sql`:

```sql
DELETE FROM feature_flags WHERE key = 'section_versioning';
```

Also add an entry to `app/drizzle/meta/_journal.json` following the existing timestamp pattern.

- [ ] **Step 3: Commit flag retirement**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-d && git add app/drizzle/ && git -c commit.gpgsign=false commit -m "feat(decom): retire section_versioning feature flag with orchestrator routes"
```

### Task d5: Rubric evidence, build/test, push, PR

Same pattern as sub-step (b) Task b4. Items:

- Item 4 is substantive here (flag retirement) — document the flag row drop and migration addition.
- Item 5 lists the test files deleted.
- Item 7 — route-level telemetry: any `logAudit` event types scoped to orchestrator routes retire in this PR. Sweep with:
  ```bash
  rg -n "logAudit\(" app/src/ | rg -i "orchestrator"
  ```
  If matches exist in non-deleted code, clean up.

PR title: `feat(decom): delete /api/ai/orchestrator/* routes + section_versioning flag`.

---

## Sub-step (e): Delete `lib/ai/orchestrator/` folder

**Preconditions:** Sub-steps (a), (b), (c), (d) all merged.

**Scope:** Delete the entire `app/src/lib/ai/orchestrator/` subtree.

### Task e0: Worktree setup

- [ ] **Step 1: Create worktree `chore/decom-orchestrator-e`**

### Task e1: Final pre-delete probe

- [ ] **Step 1: Confirm zero external dependencies**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-e && {
  echo "## Imports of @/lib/ai/orchestrator/* from anywhere"
  rg -n "from ['\"]@/lib/ai/orchestrator" app/src/ app/tests/ 2>/dev/null || echo "(none)"
  echo
  echo "## Any remaining string references to orchestrator"
  rg -n "orchestrator" app/src/ | rg -v "lib/ai/orchestrator/"
} > /tmp/orch-e-final-probe.txt
cat /tmp/orch-e-final-probe.txt
```
Expected: first section `(none)`. Second section may have stragglers (e.g., comments, string literals) — each is individually classified: keep if a false-positive reference, edit if the code should not mention orchestrator anymore.

- [ ] **Step 2: If any real importers remain, STOP and fix them first**

The folder deletion fails the build if any importer remains. Do not proceed until the probe is clean.

### Task e2: Delete the folder

- [ ] **Step 1: Delete**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-e && git rm -r app/src/lib/ai/orchestrator/
```
Expected: every file in the subtree shown as `rm`.

- [ ] **Step 2: Commit**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-e && git -c commit.gpgsign=false commit -m "feat(decom): delete lib/ai/orchestrator folder

Final sub-step of the orchestrator retirement cluster.
Zero external importers confirmed via re-run of bootstrap probes 01 and 10.
Per plan 2026-04-14-decom-orchestrator-retirement.md Track A sub-step (e)."
```

### Task e3: Retire orchestrator-specific test files

- [ ] **Step 1: Delete test files that imported orchestrator internals**

Specifically:
- `app/tests/unit/services/blueprint.test.ts`
- `app/tests/unit/export-docx.test.ts` (only if it's exercising orchestrator-owned types from the old location)
- `app/tests/unit/section-specs.test.ts`

Sanity-check each one — if the test is actually exercising an agent-owned surface via orchestrator-path imports that are now broken, migrate the imports. Otherwise delete.

- [ ] **Step 2: Commit**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-e && git rm <test files> && git -c commit.gpgsign=false commit -m "feat(decom): delete tests that exercised orchestrator-internal surfaces"
```

### Task e4: Rubric evidence, build/test, push, PR

Standard pattern. Item 2 shows the final probe returns zero. Item 3 shows build passes with the whole folder gone. Item 7 sweeps for any observability surface still referencing `orchestrator`.

---

## Sub-step (f): `client-v2.ts` sweep

**Preconditions:** Sub-step (e) merged.

**Scope:** `app/src/lib/ai/client-v2.ts` — probe 01 showed zero `client-v2` string references in `app/src`, but spec Section 2 classifies it as a probe target, not yet confirmed. This sub-step confirms and retires.

### Task f0: Worktree setup

Standard `chore/decom-orchestrator-f` at `/home/godja/Dev/EU-Funds-decom-orch-f`.

### Task f1: Reference audit

- [ ] **Step 1: Confirm zero importers**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-f && {
  rg -n "client-v2" app/src/ app/tests/ 2>/dev/null || echo "(no string matches)"
  echo
  rg -n "from ['\"]@/lib/ai/client-v2['\"]" app/src/ app/tests/ 2>/dev/null || echo "(no import matches)"
}
```
Expected: both empty.

- [ ] **Step 2: If any match exists, migrate the caller before delete**

If the match is a real importer using `client-v2`, move the caller to `@/lib/ai/client` (the target client) or equivalent, then return to Step 1. Do not delete `client-v2.ts` while any caller remains.

### Task f2: Delete

- [ ] **Step 1: `git rm` the file**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-f && git rm app/src/lib/ai/client-v2.ts
```

- [ ] **Step 2: Commit + rubric evidence + push + PR**

Standard pattern. This is the smallest sub-step. Title: `feat(decom): delete lib/ai/client-v2.ts (zero importers)`.

---

## Cross-program verification — after sub-step (f) merges

- [ ] **Step 1: Re-run the bootstrap probes against master**

Run the commands from `docs/superpowers/plans/2026-04-14-decom-program-bootstrap.md` Tasks 2, 5, 10, 11 (probes 01, 05, 09, 10) against current master. Expected outcome: zero orchestrator references anywhere.

- [ ] **Step 2: Update the retention register**

The "Orchestrator-owned shared types" temporary-retention entry in `docs/superpowers/legacy-retention-register.md` should now be removed — its conversion trigger has fired. Edit the register to remove that entry, commit with message `chore(decom): close orchestrator-owned-types retention entry (trigger fired)`, land as a tiny standalone PR.

---

## Self-review checklist (for the whole plan)

- [ ] Six sub-step PRs landed in order: (a), (b), (c), (d), (e), (f).
- [ ] Each sub-step's evidence file exists on master with all 7 rubric sections populated and zero placeholders.
- [ ] Final bootstrap-probe re-run shows zero orchestrator references anywhere in `app/src`.
- [ ] Retention register's "Orchestrator-owned shared types" entry closed.
- [ ] No file outside the retiring surfaces was modified except the documented migration edits (sub-step (b)) and flag retirement (sub-step (d)).
- [ ] `feature_flags` table no longer has a `section_versioning` row (verify via seed migration or DB inspection).
- [ ] MEMORY.md "Active Work" section updated to reflect orchestrator retirement completion (out of scope for this plan but noted as follow-up).

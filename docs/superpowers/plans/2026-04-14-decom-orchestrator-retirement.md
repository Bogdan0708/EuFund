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

## Sub-step (a): Migrate `asistent-ai/page.tsx` from `useOrchestrator` to `useAgent`

**Sub-step scope:** Single page migration. Preserves the conversational experience but on the V3 runtime.

**Input evidence:** Track A sub-step (a) — one file, one hook swap. Probe 03 confirmed this is the sole remaining `useOrchestrator` caller in app code.

**Preconditions:** None (this is the first sub-step).

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

### Task a1: Read the current page to understand what it imports

- [ ] **Step 1: Read the page**

Run:
```bash
cat /home/godja/Dev/EU-Funds-decom-orch-a/app/src/app/[locale]/\(dashboard\)/asistent-ai/page.tsx
```
Expected: prints current implementation. Note: (1) the `useOrchestrator` import line, (2) the destructured return values used elsewhere in the component, (3) any child components that receive those values as props.

- [ ] **Step 2: Read the `useAgent` hook to understand its return shape**

Run:
```bash
cat /home/godja/Dev/EU-Funds-decom-orch-a/app/src/hooks/useAgent.ts | head -80
```
Expected: hook signature is `useAgent(locale: 'ro' | 'en', initialSessionId?: string)`. Note the return-object field names — they will be compared against what the page currently destructures from `useOrchestrator`.

- [ ] **Step 3: Read the `useOrchestrator` hook for comparison**

Run:
```bash
cat /home/godja/Dev/EU-Funds-decom-orch-a/app/src/hooks/useOrchestrator.ts | head -80
```
Expected: prints hook signature. Identify the return-object field shape.

- [ ] **Step 4: Compare the two return shapes and identify the field-name mapping**

Open both files side-by-side. Produce a table of mappings, for example:

| `useOrchestrator` return field | `useAgent` equivalent | Notes |
|-------------------------------|------------------------|-------|
| `messages` | `messages` | Same shape |
| `sendMessage` | `sendAction` | Different name — migration must rename callsite |
| `status` | `status` | Compare enum values |
| (other field) | (equivalent) | ... |

Document the mapping inline in the rubric evidence file (Task a3).

### Task a2: Perform the migration edit

- [ ] **Step 1: Replace the import and hook invocation**

Edit `/home/godja/Dev/EU-Funds-decom-orch-a/app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx`:

- Replace `import { useOrchestrator } from '@/hooks/useOrchestrator';` with `import { useAgent } from '@/hooks/useAgent';`.
- Replace the hook invocation `useOrchestrator(locale)` with `useAgent(locale as 'ro' | 'en')`.
- Rename each destructured field per the mapping table from Task a1 Step 4. Example: `sendMessage` → `sendAction`, or whatever the actual mapping shows.
- Update downstream callsites within the file that used renamed fields.

- [ ] **Step 2: Verify the import is gone**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-a && rg -n "useOrchestrator" app/src/app/[locale]/\(dashboard\)/asistent-ai/page.tsx 2>/dev/null
```
Expected: no matches.

- [ ] **Step 3: Typecheck to catch any missed rename**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-a/app && npm run typecheck 2>&1 | tee /tmp/orch-a-typecheck.log | tail -20
```
Expected: zero errors in `asistent-ai/page.tsx`. Any remaining TS error in that file means a field was missed in the rename — fix inline, re-run.

- [ ] **Step 4: Commit the migration**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-a && git add app/src/app/[locale]/\(dashboard\)/asistent-ai/page.tsx && git -c commit.gpgsign=false commit -m "feat(agent): migrate asistent-ai page from useOrchestrator to useAgent

Last remaining useOrchestrator caller. Enables downstream hook/route/folder
retirement in subsequent sub-steps of plan 2026-04-14-decom-orchestrator-retirement.md."
```

### Task a3: Rubric evidence file

- [ ] **Step 1: Create the evidence file**

Create `/home/godja/Dev/EU-Funds-decom-orch-a/docs/superpowers/decom-artifacts/2026-04-14-orchestrator-retirement/sub-step-a-rubric-evidence.md`:

```markdown
# Orchestrator Retirement Sub-step (a) — Rubric Evidence

**Plan:** `docs/superpowers/plans/2026-04-14-decom-orchestrator-retirement.md`
**Spec:** `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md` Section 3.
**Sub-step:** (a) — migrate `asistent-ai/page.tsx` from `useOrchestrator` to `useAgent`.
**Branch:** `chore/decom-orchestrator-a`.

## 1. Runtime ownership declaration

Retiring caller: `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx` importing `useOrchestrator`.
Replacement: `useAgent` hook + `/api/ai/agent/*` runtime (V3 agent runtime — Axis 3 keeper in target).

## 2. Reference sweep

\`\`\`bash
rg -n "useOrchestrator" app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx
\`\`\`

Post-edit: zero matches.

\`\`\`bash
rg -n "useOrchestrator" app/src/ | rg -v "app/src/hooks/useOrchestrator"
\`\`\`

Post-edit: <paste current count — must be zero or the only remaining matches are inside the hook's own definition file, which is sub-step (c)'s target>.

## 3. Build and route-surface verification

- `next build`: <PASS / FAIL>
- `tsc --noEmit`: <PASS / FAIL>
- Route surface unchanged (page URL is the same `/[locale]/asistent-ai`).

## 4. Feature flag / env var sweep

N/A for this sub-step — no flag or env var exclusively gates `useOrchestrator`. Sub-step (d) handles the `section_versioning` flag that gates orchestrator routes.

## 5. Test-surface cleanup

Check: any test importing `useOrchestrator` via this page?

\`\`\`bash
rg -ln "useOrchestrator" app/tests/ app/e2e/
\`\`\`

- If zero: no test cleanup in this sub-step.
- If non-zero: each such test is either migrated to `useAgent` in the same PR or deleted if only exercising retired behaviour.

## 6. Migration diff

Field-name mapping applied to the page:

| useOrchestrator field | useAgent field |
|-----------------------|-----------------|
| <fill with the actual mapping from Task a1 Step 4> | <...> |

## 7. Observability sweep

No dedicated logs, metrics, or Sentry tags are scoped to the page-level `useOrchestrator` invocation. The hook itself may have telemetry — that retires with sub-step (c) or (d).
```

- [ ] **Step 2: Fill in the `<PASS / FAIL>` results and zero-count confirmations using the outputs from Tasks a1 and a2**

- [ ] **Step 3: Verify no placeholders remain**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-a && grep -c "<PASS\|<fill\|<paste" docs/superpowers/decom-artifacts/2026-04-14-orchestrator-retirement/sub-step-a-rubric-evidence.md
```
Expected: `0`.

- [ ] **Step 4: Commit the evidence**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orch-a && git add docs/superpowers/decom-artifacts/2026-04-14-orchestrator-retirement/sub-step-a-rubric-evidence.md && git -c commit.gpgsign=false commit -m "chore(decom): sub-step (a) rubric evidence"
```

### Task a4: Build, test, push, PR

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
cd /home/godja/Dev/EU-Funds-decom-orch-a && gh pr create --title "feat(agent): migrate asistent-ai from useOrchestrator to useAgent" --body "$(cat <<'EOF'
## Summary

Sub-step (a) of the orchestrator retirement program. Migrates the last remaining \`useOrchestrator\` caller (\`app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx\`) to the V3 \`useAgent\` hook. This unblocks sub-steps (b)-(f) — rehoming shared types, deleting the hook, routes, and folder.

## Rubric evidence

\`docs/superpowers/decom-artifacts/2026-04-14-orchestrator-retirement/sub-step-a-rubric-evidence.md\`

## Test plan

- [ ] CI passes under current gating policy
- [ ] Manual smoke: \`/ro/asistent-ai\` loads, conversational flow works identically on the V3 runtime

## Plan reference

\`docs/superpowers/plans/2026-04-14-decom-orchestrator-retirement.md\`

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

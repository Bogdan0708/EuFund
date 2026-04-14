# Orphaned AI Modules Retirement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the generation-zero AI surface that predates both V3 and Managed Agents. Per Plan 1's probe outputs (Track B), no `lib/ai/*.ts` root module is zero-ref on current master — the real delete candidates are the legacy `/api/ai/*` routes, plus their route-coupled helpers that become orphans once the routes are gone. Route-first sweep.

**Architecture:** Five PRs total. PR #1 bundles four trivial routes with zero frontend + zero test references. PRs #2–#5 each retire one route with non-zero tests (must migrate or delete those tests first). After each route deletion, an inline helper-orphan probe determines whether any `lib/ai/` root module has flipped to zero-ref and can be retired in the same PR. A final cleanup PR handles any helpers that become orphaned only after multiple route deletions.

**Tech Stack:** bash + ripgrep + `next build` + `tsc` + `vitest` + `git`.

**Spec reference:** `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md` Sections 1 (Axis 4), 3 (rubric).
**Input contract:** `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/track-candidates.md` Track B; `probe-04-api-route-orphan.md`; `probe-05-lib-ai-root-references.md`; `probe-09-test-target-orphan.md`.

---

## Cross-cutting — standard per-route PR procedure

Each PR in this plan follows this five-phase shape. Per-task sections below specify which route(s) and which tests are in scope for that PR, then invoke this procedure.

### Phase 1 — Worktree and evidence setup

```bash
git -C /home/godja/Dev/EU-Funds fetch origin master
git -C /home/godja/Dev/EU-Funds worktree add -b <branch> /home/godja/Dev/EU-Funds-<slug> origin/master
cd /home/godja/Dev/EU-Funds-<slug>
mkdir -p docs/superpowers/decom-artifacts/2026-04-14-orphaned-ai/<pr-slug>
```

### Phase 2 — Pre-delete reference sweep (rubric item 2)

For each route URL being retired in this PR:

```bash
rg -n "<route-url>" app/src/ app/tests/ app/e2e/ app/scripts/ docs/
```

For each helper module also retiring, use the **helper reference sweep** (below) — a direct-path grep alone undercounts consumers when the helper is re-exported from the `lib/ai/index.ts` barrel.

#### Helper reference sweep (must run for every helper being considered for deletion)

`app/src/lib/ai/index.ts` is a barrel file that re-exports many symbols from the root-level helpers. Any consumer doing `import { symbol } from '@/lib/ai'` hits the barrel, not the helper module directly. A plain `rg "from '@/lib/ai/<helper>"` misses every such consumer and produces a false "zero-ref" reading. Skipping the barrel audit is how helper deletion breaks the build.

Run all four steps below for each helper module:

```bash
# 1. Direct path consumers (original probe-5 pattern)
rg -n "from ['\"]@/lib/ai/<helper>['\"]" app/src app/tests app/scripts

# 2. Relative consumers inside lib/ai/ (other root helpers importing this one)
rg -n "from ['\"]\\./<helper>['\"]" app/src/lib/ai/

# 3. Barrel re-export detection — does index.ts re-export this helper?
rg -n "from ['\"]\\./<helper>['\"]" app/src/lib/ai/index.ts

# 4. Barrel-consumer detection — for each symbol the barrel re-exports from this helper, grep for the symbol imported from '@/lib/ai' (without the helper path)
# Read index.ts to enumerate the re-exported symbols, then for each <symbol>:
rg -n "import .*\\b<symbol>\\b.* from ['\"]@/lib/ai['\"]" app/src app/tests app/scripts
```

If Step 3 returns a match, the helper IS re-exported through the barrel, and Step 4 must enumerate every symbol the barrel exposes from it. The post-delete plan must (a) remove the re-export line from `index.ts` AND (b) migrate or delete every consumer found in Step 4, not just Step 1.

Write all four probe outputs to the PR's `reference-sweep.md` artifact. The artifact's "Expected post-delete ref count" column must account for barrel consumers — a helper with "0 direct-path consumers" but "5 barrel consumers" cannot be deleted in this PR unless those 5 are also handled.

### Phase 3 — Delete routes + tests + orphaned helpers

Order matters:

1. `git rm` the test files scoped exclusively to the retiring route. (Tests that exercise a keeper via the retiring route migrate or are deleted based on their shape — inspect each individually; do not blanket-delete.)
2. `git rm` the route file(s).
3. After route delete, run the full helper reference sweep from Phase 2 for every helper module the route imported. Classify each helper:
   - **Zero consumers across all four probe steps** → include in this PR's deletion (Steps 3a–3c below).
   - **Zero direct-path consumers but non-zero barrel consumers** → EITHER migrate those barrel consumers to direct imports of the replacement surface (agent tools / Managed tools / keeper modules) before deleting the helper, OR retain the helper in this PR and retire it in a later PR once the barrel consumers are handled.
   - **Non-zero direct-path consumers** → defer to a later PR as before.
4. For helpers passing step 3's classification as "delete now":
   - **3a.** Edit `app/src/lib/ai/index.ts` to remove every `export ... from './<helper>'` line for the helper being deleted. This is one commit with the index edit plus the helper `git rm`, so the tree is never in a broken re-exporting state.
   - **3b.** `git rm` the helper file(s).
   - **3c.** Verify `rg -n "<helper>" app/src/lib/ai/index.ts` returns zero matches before committing.
5. If a helper module itself imports other helpers, rerun the full Phase 2 helper reference sweep for those transitively — a helper going to zero may cascade.
6. Remove empty directories: `find app/src/app/api/ai -type d -empty -delete`.

### Phase 4 — Verification (rubric items 3 and 5)

```bash
cd app && npm run build 2>&1 | tail -20       # rubric item 3
cd app && npm run typecheck 2>&1 | tail -10   # rubric item 3
cd app && npm run test 2>&1 | tail -30        # rubric item 5
```

Pass count compared against master baseline. New failures triaged before PR.

### Phase 5 — Rubric evidence file + push + PR

Evidence file at `docs/superpowers/decom-artifacts/2026-04-14-orphaned-ai/<pr-slug>/rubric-evidence.md` covers all 7 checks with concrete per-PR data. Push branch, open PR with title pattern `feat(decom): retire /api/ai/<route-name> + <helpers>`. Body cites the evidence file.

### Rubric evidence template (per-PR)

```markdown
# <PR title> — Rubric Evidence

**Plan:** `docs/superpowers/plans/2026-04-14-decom-orphaned-ai-modules.md`
**Spec:** `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md` Section 3.
**Branch:** `<branch>`.
**Scope:** <list routes and helpers retired in this PR>.

## 1. Runtime ownership declaration

<Route(s) retired with no direct replacement — the capability is absorbed by the agent/Managed tool surface, which is already live. Specifically: <tool name from spec Section 3 table or Managed Agents architecture spec>.>

## 2. Reference sweep

See `reference-sweep.md` alongside this file. Zero frontend refs per route.

## 3. Build and route-surface verification

- `next build`: <PASS / FAIL>
- `tsc --noEmit`: <PASS / FAIL>
- Route-surface: `/api/ai/<name>` no longer in `middleware.ts` `publicPaths`, sitemap, or nav config.

## 4. Feature flag / env var sweep

<None / list flags and env vars deleted with this PR>. Cite probe 07 and probe 08 data where relevant.

## 5. Test-surface cleanup

Tests deleted:
- <list test files>

Tests migrated (if any):
- <list>

## 6. Migration diff

<If the retired surface had callers, list them and their migrations. Otherwise: "Surface had zero frontend callers per probe 04; no migration.">

## 7. Observability sweep

- `logAudit(` event types scoped to retired routes: <list / none>
- Sentry tags: <list / none>
- Metrics: <list / none>
```

---

## PR #1 — Bundle deletion of four zero-ref routes

**Scope:** Routes with both zero frontend refs AND zero test refs (Track B).

- `/api/ai/generate-proposal-enhanced` (→ `app/src/app/api/ai/generate-proposal-enhanced/route.ts`)
- `/api/ai/generate-report` (→ `app/src/app/api/ai/generate-report/route.ts`)
- `/api/ai/ghid-to-tasks` (→ `app/src/app/api/ai/ghid-to-tasks/route.ts`)
- `/api/ai/search-calls` (→ `app/src/app/api/ai/search-calls/route.ts`)

Helper modules likely to become orphans in this PR:

- `enhanced-proposal-generator.ts` — imported only by `/api/ai/generate-proposal-enhanced`; will be 0-ref after its route is deleted.
- `reporting-engine.ts` — imported only by `/api/ai/generate-report`; 0-ref after deletion.

Helpers that may NOT become orphans (because used by other legacy routes still alive in subsequent PRs):

- `fact-checker.ts` — also used by `/api/ai/generate-proposal` (retires in PR #4). Stays.
- `eu-knowledge-base.ts` — used by `enhanced-proposal-generator`, `fact-checker`, `knowledge-engine`, `/api/ai/generate-insights`. Still has callers after PR #1.

### Task 1.0 — Worktree and evidence setup

- [ ] **Step 1: Create worktree**

Run:
```bash
git -C /home/godja/Dev/EU-Funds fetch origin master && \
  git -C /home/godja/Dev/EU-Funds worktree add -b chore/decom-orphan-bundle1 /home/godja/Dev/EU-Funds-decom-orphan-1 origin/master && \
  mkdir -p /home/godja/Dev/EU-Funds-decom-orphan-1/docs/superpowers/decom-artifacts/2026-04-14-orphaned-ai/pr1-bundle-zeroref
```

- [ ] **Step 2: Verify worktree on clean master**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-1 && git status && git log --oneline -1
```
Expected: clean, HEAD at current master.

### Task 1.1 — Reference sweep

- [ ] **Step 1: Sweep all four route URLs**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-1 && {
  for route in \
    /api/ai/generate-proposal-enhanced \
    /api/ai/generate-report \
    /api/ai/ghid-to-tasks \
    /api/ai/search-calls; do
    echo "## $route"
    echo "### Frontend + tests + e2e + scripts + docs"
    rg -n "['\"\\\`]$route" app/src app/tests app/e2e app/scripts docs 2>/dev/null || echo "(none)"
    echo
  done
} > /tmp/orphan-pr1-refs.txt
cat /tmp/orphan-pr1-refs.txt
```
Expected: each route shows `(none)` or only the route's own handler file.

- [ ] **Step 2: Sweep helper module importers — full barrel-aware sweep per Phase 2 guidance**

Run the four-step helper reference sweep from Cross-cutting Phase 2 for each of the four candidate helpers. The critical addition beyond the naive `@/lib/ai/<mod>` grep is that `app/src/lib/ai/index.ts` re-exports symbols from these helpers, and consumers importing those symbols via `@/lib/ai` never match a direct-path grep.

```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-1 && {
  for mod in enhanced-proposal-generator reporting-engine fact-checker eu-knowledge-base; do
    echo "## $mod — direct path consumers"
    rg -n "from ['\"]@/lib/ai/$mod['\"]" app/src app/tests app/scripts 2>/dev/null || echo "(none)"
    echo
    echo "## $mod — relative consumers inside lib/ai/"
    rg -n "from ['\"]\\./$mod['\"]" app/src/lib/ai/ 2>/dev/null || echo "(none)"
    echo
    echo "## $mod — barrel re-export in index.ts"
    rg -n "from ['\"]\\./$mod['\"]" app/src/lib/ai/index.ts 2>/dev/null || echo "(not re-exported)"
    echo
  done
} > /tmp/orphan-pr1-helper-refs.txt
cat /tmp/orphan-pr1-helper-refs.txt
```

After reading the barrel re-export lines from the third section above, capture every symbol the barrel exports from each helper. Then grep for barrel consumers of those symbols:

```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-1 && {
  # Read index.ts once and enumerate the re-exported symbols from enhanced-proposal-generator
  # Example (actual symbol list comes from reading index.ts on the current master):
  #   enhanced-proposal-generator exports: generateEnhancedProposal, EnhancedProposalInput, EUProposal, EnhancedProposalOutput
  #   reporting-engine exports: generateReport, quickReportSummary, ReportGeneration, ReportInput, FinancialReport, ProgressReport, RiskReport, PartnerReport, ComplianceReport
  #   fact-checker exports: (read from index.ts)
  #   eu-knowledge-base exports: EU_PROGRAMS, getProgramInfo, getEvaluationCriteria, getBudgetCategories, getProposalSections, getRomanianAdvantages, findBestProgram, EUProgramKey
  echo "## Barrel consumers of enhanced-proposal-generator symbols (via @/lib/ai)"
  for sym in generateEnhancedProposal EnhancedProposalInput EUProposal EnhancedProposalOutput; do
    echo "### $sym"
    rg -n "import .*\\b$sym\\b.* from ['\"]@/lib/ai['\"]" app/src app/tests app/scripts 2>/dev/null || echo "(none)"
  done
  echo
  echo "## Barrel consumers of reporting-engine symbols (via @/lib/ai)"
  for sym in generateReport quickReportSummary ReportGeneration ReportInput FinancialReport ProgressReport RiskReport PartnerReport ComplianceReport; do
    echo "### $sym"
    rg -n "import .*\\b$sym\\b.* from ['\"]@/lib/ai['\"]" app/src app/tests app/scripts 2>/dev/null || echo "(none)"
  done
  echo
  # fact-checker and eu-knowledge-base barrel consumers: enumerate their exported symbols from index.ts first, then grep each
  echo "## fact-checker barrel consumers — first read its exported symbols from index.ts then grep each here"
  echo "(expand this section after reading the current index.ts)"
  echo
  echo "## eu-knowledge-base barrel consumers"
  for sym in EU_PROGRAMS getProgramInfo getEvaluationCriteria getBudgetCategories getProposalSections getRomanianAdvantages findBestProgram EUProgramKey; do
    echo "### $sym"
    rg -n "import .*\\b$sym\\b.* from ['\"]@/lib/ai['\"]" app/src app/tests app/scripts 2>/dev/null || echo "(none)"
  done
} > /tmp/orphan-pr1-barrel-consumers.txt
cat /tmp/orphan-pr1-barrel-consumers.txt
```

Expected: captures the true consumer set. If a helper has barrel consumers, those consumers must be migrated (switched to import from the replacement agent/Managed surface) or deleted alongside the helper in this PR. If migration is large, defer the helper deletion to a later PR and retire only the route(s) here.

**Critical classification rule:** a helper is only a "confirmed delete candidate in PR #1" if ALL four probe sections above return zero matches after the PR #1 route deletes. "Zero direct path consumers" alone is not sufficient.

- [ ] **Step 3: Write the reference-sweep artifact**

Create `/home/godja/Dev/EU-Funds-decom-orphan-1/docs/superpowers/decom-artifacts/2026-04-14-orphaned-ai/pr1-bundle-zeroref/reference-sweep.md`:

```markdown
# PR #1 Bundle Deletion — Reference Sweep

**Routes scoped:** /api/ai/generate-proposal-enhanced, /api/ai/generate-report, /api/ai/ghid-to-tasks, /api/ai/search-calls.

## Route URL references

\`\`\`
<paste /tmp/orphan-pr1-refs.txt>
\`\`\`

## Helper module importers (pre-delete)

\`\`\`
<paste /tmp/orphan-pr1-helper-refs.txt>
\`\`\`

## Expected post-delete helper classification

All counts below are expectations to verify, not assertions. The actual barrel-consumer counts come from the Task 1.1 Step 2 output. If any barrel consumers exist (and they likely do — `index.ts` re-exports these helpers and consumers import via `@/lib/ai`), the disposition column must be revised before Task 1.3.

| Helper | Direct-path consumers (pre) | Barrel consumers (pre) | Post-route-delete direct | Post-route-delete barrel | Disposition in this PR |
|--------|------------------------------|--------------------------|---------------------------|----------------------------|------------------------|
| enhanced-proposal-generator.ts | 1 (route) | <fill from barrel sweep> | 0 | <fill — may be non-zero> | Delete only if total (direct + barrel + relative) is 0 after the route and any needed migrations |
| reporting-engine.ts | 1 (route) | <fill from barrel sweep> | 0 | <fill> | Same rule |
| fact-checker.ts | 2 (both proposal routes) | <fill> | 1 | <fill> | Stays (still direct-path consumed) |
| eu-knowledge-base.ts | 4 (multiple callers) | <fill> | 3 | <fill> | Stays (still direct-path consumed) |

Every "Delete in this PR" row must also trigger the `index.ts` edit per Phase 3 Step 4a.
```

- [ ] **Step 4: Commit the sweep artifact**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-1 && git add docs/superpowers/decom-artifacts/2026-04-14-orphaned-ai/pr1-bundle-zeroref/reference-sweep.md && git -c commit.gpgsign=false commit -m "chore(decom): PR #1 bundle reference sweep"
```

### Task 1.2 — Delete the four routes

- [ ] **Step 1: Delete route files**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-1 && git rm \
  app/src/app/api/ai/generate-proposal-enhanced/route.ts \
  app/src/app/api/ai/generate-report/route.ts \
  app/src/app/api/ai/ghid-to-tasks/route.ts \
  app/src/app/api/ai/search-calls/route.ts
```
Expected: four files shown as `rm`.

- [ ] **Step 2: Remove empty directories**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-1 && find app/src/app/api/ai -type d -empty -delete
```

- [ ] **Step 3: Commit**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-1 && git -c commit.gpgsign=false commit -m "feat(decom): delete 4 zero-ref /api/ai/* routes

Routes: generate-proposal-enhanced, generate-report, ghid-to-tasks, search-calls.
0 frontend refs + 0 test refs per bootstrap probe 04."
```

### Task 1.3 — Re-probe helpers, handle barrel, delete those that hit zero

- [ ] **Step 1: Re-run the full four-part helper reference sweep after route deletion**

Use the same command block as Task 1.1 Step 2 (direct path + relative + barrel re-export + barrel consumers). Target helpers: `enhanced-proposal-generator`, `reporting-engine`.

```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-1 && {
  for mod in enhanced-proposal-generator reporting-engine; do
    echo "## $mod — post-route-delete direct path"
    rg -n "from ['\"]@/lib/ai/$mod['\"]" app/src app/tests app/scripts 2>/dev/null || echo "(none)"
    echo "## $mod — relative inside lib/ai/"
    rg -n "from ['\"]\\./$mod['\"]" app/src/lib/ai/ 2>/dev/null || echo "(none)"
    echo "## $mod — barrel re-export in index.ts"
    rg -n "from ['\"]\\./$mod['\"]" app/src/lib/ai/index.ts 2>/dev/null || echo "(not re-exported)"
    echo
  done
}
```

Expected: direct-path and relative both `(none)` after the route deletes. The barrel re-export line is still present — that's what Step 2 handles.

- [ ] **Step 2: Handle barrel consumers BEFORE helper file deletion**

For each helper that shows a barrel re-export in Step 1, enumerate the exported symbols (read `app/src/lib/ai/index.ts` directly) and grep for each symbol being imported via `@/lib/ai`:

```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-1 && cat app/src/lib/ai/index.ts | head -40
# Identify the re-export lines for enhanced-proposal-generator and reporting-engine, then:
for sym in <every symbol exported from those helpers via index.ts>; do
  echo "### $sym"
  rg -n "import .*\\b$sym\\b.* from ['\"]@/lib/ai['\"]" app/src app/tests app/scripts 2>/dev/null || echo "(none)"
done
```

Branch on results:
- **All symbols have zero barrel consumers across the grep** → proceed to Step 3. The helpers are safely orphan.
- **Any symbol has non-zero barrel consumers** → STOP this PR's helper-deletion scope. Proceed to Step 3 but ONLY delete the helpers whose barrel-consumer count is zero. Helpers with non-zero barrel consumers are deferred to a later PR that first migrates those consumers to the replacement surface. Document the deferral decision in the rubric evidence (Section 5 / Section 6).

- [ ] **Step 3: Edit `app/src/lib/ai/index.ts` to remove re-exports for the helpers being deleted in this PR**

For each helper being deleted in this PR (per Step 2's classification), edit `app/src/lib/ai/index.ts` to remove the entire `export { ... } from './<helper>';` line.

After editing, verify:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-1 && {
  for mod in enhanced-proposal-generator reporting-engine; do
    rg -n "from ['\"]\\./$mod['\"]" app/src/lib/ai/index.ts && echo "FAIL: $mod still re-exported" || echo "OK: $mod re-export removed"
  done
}
```
Expected: both print `OK: <mod> re-export removed`. If either prints `FAIL`, edit again.

- [ ] **Step 4: Delete the helper file(s)**

Run (only for helpers that passed Step 2's classification AND had their index.ts re-export removed in Step 3):

```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-1 && git rm app/src/lib/ai/enhanced-proposal-generator.ts app/src/lib/ai/reporting-engine.ts
```

If Step 2 deferred either helper, skip it in the `git rm` — only delete what Step 2 approved.

- [ ] **Step 5: Transitively re-probe `eu-knowledge-base.ts` (barrel-aware)**

Run the four-part helper sweep for `eu-knowledge-base`:

```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-1 && {
  echo "## eu-knowledge-base — direct path"
  rg -n "from ['\"]@/lib/ai/eu-knowledge-base['\"]" app/src app/tests app/scripts 2>/dev/null || echo "(none)"
  echo "## eu-knowledge-base — relative inside lib/ai/"
  rg -n "from ['\"]\\./eu-knowledge-base['\"]" app/src/lib/ai/ 2>/dev/null || echo "(none)"
  echo "## eu-knowledge-base — barrel re-export in index.ts"
  rg -n "from ['\"]\\./eu-knowledge-base['\"]" app/src/lib/ai/index.ts 2>/dev/null || echo "(not re-exported)"
  echo "## eu-knowledge-base — barrel consumers (enumerate symbols from index.ts first)"
  for sym in EU_PROGRAMS getProgramInfo getEvaluationCriteria getBudgetCategories getProposalSections getRomanianAdvantages findBestProgram EUProgramKey; do
    echo "### $sym"
    rg -n "import .*\\b$sym\\b.* from ['\"]@/lib/ai['\"]" app/src app/tests app/scripts 2>/dev/null || echo "(none)"
  done
}
```

Expected: direct-path and relative still non-zero (callers: fact-checker.ts, knowledge-engine.ts, /api/ai/generate-insights). Do NOT delete in this PR — retires in final cleanup after PR #3 deletes knowledge-engine dependencies.

- [ ] **Step 6: Commit the helper deletions and the index.ts edit together**

The index.ts edit and the `git rm` of helper files must land in one commit so the tree is never in a state where `index.ts` re-exports a file that no longer exists.

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-1 && git add app/src/lib/ai/index.ts && git -c commit.gpgsign=false commit -m "feat(decom): delete orphan helpers enhanced-proposal-generator, reporting-engine

Both became 0-ref after their route deletions above. app/src/lib/ai/index.ts
updated in the same commit to remove the re-export lines."
```

### Task 1.4 — Verification

- [ ] **Step 1: Build, typecheck, test**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-1/app && npm run build 2>&1 | tail -20 && npm run typecheck 2>&1 | tail -10 && npm run test 2>&1 | tail -30
```
Expected: all pass.

### Task 1.5 — Rubric evidence, push, PR

- [ ] **Step 1: Create `rubric-evidence.md`**

Create `/home/godja/Dev/EU-Funds-decom-orphan-1/docs/superpowers/decom-artifacts/2026-04-14-orphaned-ai/pr1-bundle-zeroref/rubric-evidence.md` following the template from the Cross-cutting section. Populate all seven checks with actual PR #1 data.

- [ ] **Step 2: Commit evidence**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-1 && git add docs/superpowers/decom-artifacts/2026-04-14-orphaned-ai/pr1-bundle-zeroref/rubric-evidence.md && git -c commit.gpgsign=false commit -m "chore(decom): PR #1 bundle rubric evidence"
```

- [ ] **Step 3: Push and PR**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-1 && git push -u origin chore/decom-orphan-bundle1 && gh pr create --title "feat(decom): retire 4 zero-ref /api/ai/* routes + 2 orphan helpers" --body "$(cat <<'EOF'
## Summary

PR #1 of 5 in the orphaned AI modules retirement program. Deletes four /api/ai/* routes that probe 04 showed have 0 frontend references and 0 test references:

- \`/api/ai/generate-proposal-enhanced\`
- \`/api/ai/generate-report\`
- \`/api/ai/ghid-to-tasks\`
- \`/api/ai/search-calls\`

Also deletes two helper modules that became 0-ref after the above route deletions:

- \`lib/ai/enhanced-proposal-generator.ts\`
- \`lib/ai/reporting-engine.ts\`

## Rubric evidence

\`docs/superpowers/decom-artifacts/2026-04-14-orphaned-ai/pr1-bundle-zeroref/rubric-evidence.md\`

## Test plan

- [ ] CI passes under current gating policy.
- [ ] Manual: GET each of the four retired routes returns 404.
- [ ] No keeper behaviour regressed (build + typecheck + test pass).

## Plan reference

\`docs/superpowers/plans/2026-04-14-decom-orphaned-ai-modules.md\`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Merge on green, remove worktree**

---

## PR #2 — Retire `/api/ai/check-eligibility` + tests

**Scope:** `app/src/app/api/ai/check-eligibility/route.ts`, 1 test file, any helpers hitting 0-ref.

### Task 2.0 — Worktree setup

Standard: branch `chore/decom-orphan-check-eligibility`, worktree `/home/godja/Dev/EU-Funds-decom-orphan-2`, off current master (PR #1 should have merged first to keep the worktree clean, but this PR is independent of PR #1 and can proceed in parallel if branch conflicts don't arise).

### Task 2.1 — Reference sweep

- [ ] **Step 1: Sweep route URL**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-2 && rg -n "/api/ai/check-eligibility" app/src app/tests app/e2e app/scripts docs
```
Expected: 0 frontend refs per probe 04. The 1 test reference should be the sole test file.

- [ ] **Step 2: Identify the test file**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-2 && rg -l "/api/ai/check-eligibility" app/tests
```
Expected: one test file. Inspect it: does it solely exercise the route, or does it exercise a keeper via the route?

- [ ] **Step 3: Classify test decision**

If the test solely exercises the route → delete it.
If it exercises a keeper (e.g., uses the route as a convenience for testing eligibility rules) → migrate it to call the eligibility engine directly (`lib/rules/eligibility.ts`).

Document the classification in the PR's `reference-sweep.md` artifact.

### Task 2.2 — Delete route + test

- [ ] **Step 1: Delete the test (if Task 2.1 Step 3 chose delete)**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-2 && git rm <test-path-identified-in-2.1>
```

- [ ] **Step 2: Delete the route**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-2 && git rm app/src/app/api/ai/check-eligibility/route.ts
```

- [ ] **Step 3: Remove empty directories**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-2 && find app/src/app/api/ai -type d -empty -delete
```

- [ ] **Step 4: Re-probe helpers the route imported**

Inspect which `lib/ai/*` helpers were imported by the retired route (read the file from git before committing the delete if needed: `git show HEAD:app/src/app/api/ai/check-eligibility/route.ts | grep "^import"`). Re-run probe 5 against each. Any that hit 0 get a follow-up `git rm`.

- [ ] **Step 5: Commit**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-2 && git -c commit.gpgsign=false commit -m "feat(decom): retire /api/ai/check-eligibility route + test"
```

### Task 2.3 — Verification, rubric evidence, push, PR

Follow the Cross-cutting Phases 4 and 5. PR title: `feat(decom): retire /api/ai/check-eligibility`.

---

## PR #3 — Retire `/api/ai/generate-insights` + tests + `knowledge-engine`

**Scope:** `/api/ai/generate-insights` route, 1 test file, `knowledge-engine.ts` helper (sole importer retires with the route).

### Task 3.0 — Worktree setup

Standard: `chore/decom-orphan-generate-insights`, worktree `/home/godja/Dev/EU-Funds-decom-orphan-3`.

### Task 3.1 — Reference sweep

- [ ] **Step 1: Sweep route + helper**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-3 && {
  echo "## /api/ai/generate-insights"
  rg -n "/api/ai/generate-insights" app/src app/tests app/e2e app/scripts docs
  echo
  echo "## knowledge-engine importers"
  rg -n "from ['\"]@/lib/ai/knowledge-engine" app/src app/tests app/scripts
}
```
Expected: 0 frontend refs for the route, 1 test ref. `knowledge-engine` should show only `/api/ai/generate-insights` as importer.

- [ ] **Step 2: Document in reference-sweep.md**

Same artifact pattern as PR #1, #2.

### Task 3.2 — Delete route + test + helper

- [ ] **Step 1: Delete route + test + knowledge-engine in one commit**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-3 && git rm \
  app/src/app/api/ai/generate-insights/route.ts \
  <test-file-path> \
  app/src/lib/ai/knowledge-engine.ts && \
  find app/src/app/api/ai -type d -empty -delete
```

- [ ] **Step 2: Commit**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-3 && git -c commit.gpgsign=false commit -m "feat(decom): retire /api/ai/generate-insights + knowledge-engine helper"
```

### Task 3.3 — Verification, rubric evidence, push, PR

Standard. Note: `eu-knowledge-base.ts` still has callers after this PR (fact-checker + enhanced-proposal-generator's replacement logic might still exist; verify). If `eu-knowledge-base.ts` hits 0-ref here, include it. Otherwise it falls to the final cleanup PR.

---

## PR #4 — Retire `/api/ai/generate-proposal` + tests + `proposal-generator` + `fact-checker`

**Scope:** Largest PR. `/api/ai/generate-proposal` route, 7 test files, `proposal-generator.ts` (sole importer), `fact-checker.ts` (sole remaining importer after PR #1 retired `generate-proposal-enhanced`).

### Task 4.0 — Worktree setup

Standard: `chore/decom-orphan-generate-proposal`, `/home/godja/Dev/EU-Funds-decom-orphan-4`.

**Precondition:** PR #1 merged (removed `generate-proposal-enhanced` which also imported `fact-checker`).

### Task 4.1 — Reference sweep

- [ ] **Step 1: Sweep the route and its helpers**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-4 && {
  echo "## /api/ai/generate-proposal"
  rg -n "/api/ai/generate-proposal\\b" app/src app/tests app/e2e app/scripts docs
  echo
  echo "## proposal-generator importers"
  rg -n "from ['\"]@/lib/ai/proposal-generator" app/src app/tests app/scripts
  echo
  echo "## fact-checker importers"
  rg -n "from ['\"]@/lib/ai/fact-checker" app/src app/tests app/scripts
}
```
Expected: 7 test files for the route; `proposal-generator` only used by the route; `fact-checker` only used by the route (PR #1 removed the other caller).

- [ ] **Step 2: List the 7 test files**

Capture them into a variable or write to the reference-sweep artifact explicitly.

### Task 4.2 — Test file classification

- [ ] **Step 1: For each of the 7 test files, inspect and classify**

Read each test file. Classification:

- **Pure route test** (exercises the route alone) → delete.
- **Keeper-via-route test** (uses the route to exercise agent or database behaviour) → migrate to hit the agent surface directly, OR delete if the keeper is already covered by another test.

Typical outcome: most are pure route tests (delete all 7). Some may be integration tests like `critical-flows.test.ts` that touch multiple routes — those need granular edits, not wholesale deletion.

- [ ] **Step 2: Document classification**

Write each test file's classification into the PR's `reference-sweep.md` artifact.

### Task 4.3 — Delete route + tests + helpers

- [ ] **Step 1: Delete all scoped files in one commit**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-4 && git rm \
  app/src/app/api/ai/generate-proposal/route.ts \
  <every pure-route test file from Task 4.2> \
  app/src/lib/ai/proposal-generator.ts \
  app/src/lib/ai/fact-checker.ts && \
  find app/src/app/api/ai -type d -empty -delete
```

- [ ] **Step 2: Migrate any keeper-via-route tests (if Task 4.2 flagged any)**

For each test that needs migration, edit it to call the keeper surface directly. Typecheck to confirm migrations compile.

- [ ] **Step 3: Commit**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-4 && git add -A && git -c commit.gpgsign=false commit -m "feat(decom): retire /api/ai/generate-proposal + proposal-generator + fact-checker + tests"
```

### Task 4.4 — Verification, rubric evidence, push, PR

Standard pattern. This PR's rubric item 5 is heavier than others — document every test classification decision.

---

## PR #5 — Retire `/api/ai/match-grants` + tests + `grant-matcher`

**Scope:** Route, 3 test files, `grant-matcher.ts` helper.

### Task 5.0 — Worktree setup

Standard: `chore/decom-orphan-match-grants`, `/home/godja/Dev/EU-Funds-decom-orphan-5`.

### Task 5.1 — Reference sweep + test classification

Same pattern as Task 4.1 and Task 4.2 but scoped to 3 tests instead of 7.

### Task 5.2 — Delete route + tests + helper

- [ ] **Step 1: Delete in one commit**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-5 && git rm \
  app/src/app/api/ai/match-grants/route.ts \
  <test files from Task 5.1> \
  app/src/lib/ai/grant-matcher.ts && \
  find app/src/app/api/ai -type d -empty -delete
```

- [ ] **Step 2: Commit**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-5 && git -c commit.gpgsign=false commit -m "feat(decom): retire /api/ai/match-grants + grant-matcher + tests"
```

### Task 5.3 — Transitive helper check: `eu-ai-act`

- [ ] **Step 1: Re-probe `eu-ai-act`**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-5 && rg -n "from ['\"]@/lib/ai/eu-ai-act" app/src app/tests app/scripts
```
Expected: after `match-grants` retirement, only `sanitize.ts` (keeper) still imports `eu-ai-act`. `eu-ai-act` stays.

- [ ] **Step 2: Document in rubric evidence**

Note explicitly: `eu-ai-act.ts` is retained because `sanitize.ts` still consumes it. If a later keeper-surface refactor retires that dependency, `eu-ai-act` retires then.

### Task 5.4 — Verification, rubric evidence, push, PR

Standard pattern. PR title: `feat(decom): retire /api/ai/match-grants + grant-matcher`.

---

## Final cleanup PR — `eu-knowledge-base.ts`

**Scope:** This helper may end up at 0-ref after PRs #1–#5 merge (its callers: `enhanced-proposal-generator` (PR #1), `fact-checker` (PR #4), `knowledge-engine` (PR #3), `/api/ai/generate-insights` (PR #3)). After all four retire, `eu-knowledge-base` is orphan.

### Task 6.0 — Worktree setup

Standard: `chore/decom-orphan-cleanup`, `/home/godja/Dev/EU-Funds-decom-orphan-6`.

**Precondition:** PRs #1, #3, #4 all merged.

### Task 6.1 — Re-probe

- [ ] **Step 1: Confirm zero references**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-6 && rg -n "from ['\"]@/lib/ai/eu-knowledge-base" app/src app/tests app/scripts
```
Expected: `(none)`. If any callers remain, investigate — likely means PRs missed a cleanup.

### Task 6.2 — Delete

- [ ] **Step 1: Delete the helper**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-6 && git rm app/src/lib/ai/eu-knowledge-base.ts
```

- [ ] **Step 2: Commit**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-orphan-6 && git -c commit.gpgsign=false commit -m "feat(decom): retire eu-knowledge-base helper

All direct and transitive importers retired in PRs #1, #3, #4."
```

### Task 6.3 — Verification, rubric evidence, push, PR

Small PR. Standard pattern. Title: `feat(decom): retire eu-knowledge-base helper (orphan after route cleanup)`.

---

## Modules explicitly NOT retired in this plan

Per Track B's classification, these `lib/ai/*.ts` root modules stay on master because they're consumed by keeper surfaces (v1 project/compliance/document routes that are part of the target architecture):

- `compliance-engine.ts` — v1 compliance surface keeper
- `compliance-validator.ts` — v1 compliance surface keeper
- `deadline-intelligence.ts` — consumed by `risk-assessment.ts` (keeper)
- `document-analyzer.ts` — documents surface keeper
- `eu-ai-act.ts` — consumed by `sanitize.ts` (keeper)
- `risk-assessment.ts` — v1 project risk surface keeper

Each of these has a non-zero ref count to a keeper surface. Retiring them is out of scope for this plan and would require a different retirement axis (v1 API retirement or rehoming).

---

## Self-review checklist (for the whole plan)

- [ ] Five rubric-carrying PRs landed in order: PR #1 bundle → PR #2 → PR #3 → PR #4 → PR #5 → Final cleanup.
- [ ] Each PR's `rubric-evidence.md` exists on master with all 7 checks populated.
- [ ] Final probe re-run (probe 04 + probe 05 commands from the bootstrap plan) shows the 8 retired routes return 0 results and the 6 retired helpers return "module not found."
- [ ] `compliance-engine`, `compliance-validator`, `deadline-intelligence`, `document-analyzer`, `eu-ai-act`, `risk-assessment` remain on master (keeper surface).
- [ ] No `app/e2e/*.spec.ts` file was modified (Rule 1 — e2e belongs to follow-on test-pyramid-rebuild spec).
- [ ] No feature flag changes beyond those explicitly retiring with their owning routes (probe 07 cross-reference documented per-PR).

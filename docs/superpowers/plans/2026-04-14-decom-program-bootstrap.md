# Decommissioning Program Bootstrap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the evidence base and retention register that the legacy decommissioning program (spec `2026-04-11-legacy-decommissioning-design.md`) requires before any retirement PR can land. This plan runs all 11 Section 2 probes against current post-cascade master, captures their outputs as tracked artifacts, creates the retention register file with seed entries, and synthesizes the per-track candidate lists that constitute the downstream contracts for plans 3, 4, and 5.

**Architecture:** Pure documentation + shell-probe plan. No application code is modified. All outputs are tracked markdown artifacts under `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/` plus one register file at `docs/superpowers/legacy-retention-register.md`. Each probe is one task; each task produces one artifact file and one commit. The final task locks in the downstream-contract paths that plans 3, 4, and 5 will consume.

**Tech Stack:** bash + ripgrep (`rg`) + `find` + `git`. No new dependencies. Runs on Linux (WSL2). Probes assume cwd is the execution worktree root.

**Spec reference:** `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md` Sections 2 and 6.

**Companion spec:** `docs/superpowers/specs/2026-04-11-e2e-gate-rollback-design.md` (cascade landed 2026-04-14).

---

## Downstream contracts (locked at plan completion)

These artifact paths are the inputs that the deferred plans 3, 4, and 5 consume. After this plan executes, the following files exist on `master` and are referenced by name in the next writing-plans session. Path drift breaks the contract.

| Artifact path | Consumer plan | Purpose |
|---------------|---------------|---------|
| `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/README.md` | All | Index, validity timestamp, command-replay instructions |
| `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-01-runtime-residue.md` | Plan 3 | Orchestrator import callsites and migration candidates |
| `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-02-route-tree-diff.md` | Plan 2 (informational) | Route-tree state on master |
| `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-03-hook-callsite-sweep.md` | Plan 3 | `useOrchestrator` callers (binary classification) |
| `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-04-api-route-orphan.md` | Plan 4, Plan 5 | API route reference counts |
| `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-05-lib-ai-root-references.md` | Plan 4 | Reference counts for `lib/ai/*.ts` root modules |
| `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-06-design-token-coexistence.md` | Retention register (Plan 1 itself) | V1/V2 token interleave file list |
| `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-07-feature-flag-reach.md` | Plans 2, 3, 4 | Flag readers, retire-with-surface candidates |
| `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-08-env-var-reach.md` | Plans 2, 3, 4 | Env var readers |
| `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-09-test-target-orphan.md` | Plans 2, 3, 4 | Tests inheriting classification + e2e route orphans |
| `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-10-reexport-type-dependency.md` | Plan 3 | Type-only and re-export importers of orchestrator |
| `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-11-public-surface.md` | Plan 2 | publicPaths, sitemap, robots, nav, slug-map state |
| `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/track-candidates.md` | Plans 3, 4, 5 | Synthesized per-track candidate lists with classifications |
| `docs/superpowers/legacy-retention-register.md` | All | Live retention-justification register |

Plans 3, 4, 5 are explicitly forbidden from re-running probes; they consume these artifacts as authoritative input. If an artifact is stale at the time the deferred plans are written, this plan is re-executed (whole, not selectively) before the next writing-plans session — see Task 16.

---

## File structure

**Created by this plan:**

- `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/README.md` — index file, lists all probes, validity timestamp, command-replay instructions
- `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-01-runtime-residue.md` through `probe-11-public-surface.md` — one artifact per probe
- `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/track-candidates.md` — synthesized per-track candidate lists
- `docs/superpowers/legacy-retention-register.md` — retention register

**Not modified:** application code, tests, configuration, CI workflows, MEMORY.md.

**Worktree:** Execution happens in a fresh worktree off post-cascade master at `/home/godja/Dev/EU-Funds-decom-bootstrap` on branch `chore/decom-program-bootstrap`. The brainstorm worktree (`/home/godja/Dev/EU-Funds-decom`) is left untouched.

**Each artifact file follows this template:**

```markdown
# Probe NN — <Probe Name>

**Run on:** <ISO date> against `master` at commit `<sha>`
**Spec reference:** Section 2, probe NN.
**Purpose:** <one line from spec>

## Commands

\`\`\`bash
<exact commands run>
\`\`\`

## Raw output

\`\`\`
<command output, or summary if very long with full output linked>
\`\`\`

## Classification

<table or list applying probe-specific rules from spec>

## Notes

<any judgment calls, ambiguities, or follow-up items>
```

---

## Task 0: Set up execution worktree

**Files:**
- Create: branch `chore/decom-program-bootstrap` off `origin/master`
- Create: worktree at `/home/godja/Dev/EU-Funds-decom-bootstrap`

- [ ] **Step 1: Verify post-cascade master is on local**

Run:
```bash
cd /home/godja/Dev/EU-Funds && git fetch origin master && git log --oneline origin/master | head -10
```
Expected: master HEAD includes commits `1040228` (PR #19), `3cad5e5` (PR #18), `5f018d9` (PR #11), `db3c041` (PR #17), `e9b52b2` (PR #16) per the cascade-completion report.

- [ ] **Step 2: Create execution worktree off post-cascade master**

Run:
```bash
cd /home/godja/Dev/EU-Funds && git worktree add -b chore/decom-program-bootstrap /home/godja/Dev/EU-Funds-decom-bootstrap origin/master
```
Expected: `Preparing worktree (new branch 'chore/decom-program-bootstrap')` and worktree directory exists.

- [ ] **Step 3: Verify worktree state is clean and on the right commit**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-bootstrap && git status && git log --oneline -1
```
Expected: clean working tree, HEAD matches `origin/master` HEAD from Step 1.

- [ ] **Step 4: Create artifact directory**

Run:
```bash
mkdir -p /home/godja/Dev/EU-Funds-decom-bootstrap/docs/superpowers/decom-artifacts/2026-04-14-probe-outputs
```
Expected: directory created (no output on success).

- [ ] **Step 5: Commit empty directory marker**

Skip — git does not track empty directories. The first probe artifact will populate it.

---

## Task 1: Create artifact README skeleton

**Files:**
- Create: `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/README.md`

- [ ] **Step 1: Write README skeleton**

Create file `/home/godja/Dev/EU-Funds-decom-bootstrap/docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/README.md` with content:

```markdown
# Decommissioning Probe Outputs — 2026-04-14

**Validity:** snapshot of `master` at commit `<filled in at Task 16>`, run on 2026-04-14.
**Plan reference:** `docs/superpowers/plans/2026-04-14-decom-program-bootstrap.md`.
**Spec reference:** `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md` Section 2.

## Probes

| # | Probe | Artifact |
|---|-------|----------|
| 1 | Runtime residue grep | `probe-01-runtime-residue.md` |
| 2 | Route-tree diff | `probe-02-route-tree-diff.md` |
| 3 | Hook-callsite sweep | `probe-03-hook-callsite-sweep.md` |
| 4 | API-route orphan probe | `probe-04-api-route-orphan.md` |
| 5 | `lib/ai/` root module reference sweep | `probe-05-lib-ai-root-references.md` |
| 6 | Design-token coexistence grep | `probe-06-design-token-coexistence.md` |
| 7 | Feature-flag reach | `probe-07-feature-flag-reach.md` |
| 8 | Env-var reach | `probe-08-env-var-reach.md` |
| 9 | Test-target orphan probe | `probe-09-test-target-orphan.md` |
| 10 | Re-export / type-dependency probe | `probe-10-reexport-type-dependency.md` |
| 11 | Public-surface probe | `probe-11-public-surface.md` |

## Synthesized contracts

- `track-candidates.md` — per-track candidate lists (orchestrator, orphaned AI, diagnostic sweep)
- `../../legacy-retention-register.md` — live retention register (created with seed entries by this plan)

## Replay

To reproduce these artifacts from a clean worktree:

\`\`\`bash
git worktree add -b chore/decom-bootstrap-replay <path> origin/master
cd <path>
# Run each probe's commands per its artifact file, capture output, regenerate.
\`\`\`

## Validity windows

Per spec Section 6, retention register entries older than 60 days without a `last_verified` update become presumptively invalid. These probe outputs follow the same convention: if more than 60 days elapse before plans 3, 4, 5 are written, re-run this plan whole rather than consuming stale outputs.
```

- [ ] **Step 2: Verify file exists and is non-empty**

Run:
```bash
test -s /home/godja/Dev/EU-Funds-decom-bootstrap/docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/README.md && echo OK
```
Expected: `OK`.

- [ ] **Step 3: Commit**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-bootstrap && git add docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/README.md && git -c commit.gpgsign=false commit -m "chore(decom): add probe-output artifact skeleton

Index file for the 11 Section 2 probes plus synthesized contracts.
Per plan 2026-04-14-decom-program-bootstrap.md."
```
Expected: one new commit, README committed.

---

## Task 2: Probe 1 — Runtime residue grep

**Files:**
- Create: `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-01-runtime-residue.md`

- [ ] **Step 1: Run runtime residue grep**

Run, capturing output to a tmp file:
```bash
cd /home/godja/Dev/EU-Funds-decom-bootstrap && {
  echo "## A. useOrchestrator and orchestrator string references in app/src"
  rg -n "useOrchestrator|client-v2" app/src/ || echo "(no matches)"
  echo
  echo "## B. Imports from @/lib/ai/orchestrator (excluding files inside the orchestrator/ folder)"
  rg -n "from '@/lib/ai/orchestrator" app/src/ | rg -v "lib/ai/orchestrator/" || echo "(no matches)"
  echo
  echo "## C. Files inside lib/ai/orchestrator/ with no external import"
  echo "(derived from B above by enumeration; classify in the artifact)"
} > /tmp/probe-01-output.txt
```
Expected: file `/tmp/probe-01-output.txt` exists and contains the three sections with either match lines or `(no matches)`.

- [ ] **Step 2: Inspect the output**

Run:
```bash
cat /tmp/probe-01-output.txt
```
Expected: human-readable output to inspect for the artifact write.

- [ ] **Step 3: Write the artifact file**

Create `/home/godja/Dev/EU-Funds-decom-bootstrap/docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-01-runtime-residue.md` with content following the template:

```markdown
# Probe 01 — Runtime residue grep

**Run on:** 2026-04-14 against `master` at commit `<HEAD>`.
**Spec reference:** Section 2, probe 1.
**Purpose:** Identify orchestrator import callsites outside the orchestrator folder (migration candidates) and orchestrator-internal files with no external import (delete candidates).

## Commands

\`\`\`bash
rg -n "useOrchestrator|client-v2" app/src/
rg -n "from '@/lib/ai/orchestrator" app/src/ | rg -v "lib/ai/orchestrator/"
\`\`\`

## Raw output

\`\`\`
<paste full content of /tmp/probe-01-output.txt here>
\`\`\`

## Classification

| File | Match type | Classification |
|------|-----------|----------------|
| <file>:<line> | `useOrchestrator` import | Migration candidate (replace with `useAgent`) |
| <file>:<line> | `client-v2` reference | Probe target (per spec Section 2 seed) |
| <file>:<line> | `@/lib/ai/orchestrator/<x>` runtime import | Migration candidate or rehome candidate (cross-reference probe 10) |

(Fill rows by reading raw output above.)

## Notes

- Files inside `app/src/lib/ai/orchestrator/` itself are not listed here — they are addressed by probe 5 and probe 10.
- Empty result sets are valid outcomes — record them explicitly so the absence is audited, not assumed.
```

- [ ] **Step 4: Replace the `<paste...>` and `<file>` placeholders with actual data from `/tmp/probe-01-output.txt`**

This is the human-judgment step. Open the file, paste the raw output verbatim into the code block, then build the classification table by reading the matches and applying the rules from the Purpose section. No external dependencies — the spec defines the rules.

- [ ] **Step 5: Verify file is non-empty and contains "Raw output"**

Run:
```bash
test -s /home/godja/Dev/EU-Funds-decom-bootstrap/docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-01-runtime-residue.md && grep -q "Raw output" /home/godja/Dev/EU-Funds-decom-bootstrap/docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-01-runtime-residue.md && echo OK
```
Expected: `OK`.

- [ ] **Step 6: Commit**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-bootstrap && git add docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-01-runtime-residue.md && git -c commit.gpgsign=false commit -m "chore(decom): probe 01 — runtime residue grep

Per plan 2026-04-14-decom-program-bootstrap.md."
```
Expected: one new commit.

---

## Task 3: Probe 2 — Route-tree diff

**Files:**
- Create: `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-02-route-tree-diff.md`

- [ ] **Step 1: Enumerate both route groups**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-bootstrap && {
  echo "## A. (app)/ subtree (English-named legacy)"
  find "app/src/app/[locale]/(app)" -type d 2>/dev/null | sort || echo "(directory absent)"
  echo
  echo "## B. (dashboard)/ subtree (Romanian-named target)"
  find "app/src/app/[locale]/(dashboard)" -type d 2>/dev/null | sort || echo "(directory absent)"
  echo
  echo "## C. Diff (segment-name overlap)"
  comm -12 \
    <(find "app/src/app/[locale]/(app)" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | xargs -I{} basename {} | sort) \
    <(find "app/src/app/[locale]/(dashboard)" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | xargs -I{} basename {} | sort) || echo "(no overlap)"
} > /tmp/probe-02-output.txt
cat /tmp/probe-02-output.txt
```
Expected: prints A, B, C sections. Section A may be present (legacy route layer surviving cascade) or absent (already removed by cascade — possible).

- [ ] **Step 2: Write the artifact file**

Create `/home/godja/Dev/EU-Funds-decom-bootstrap/docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-02-route-tree-diff.md` with content:

```markdown
# Probe 02 — Route-tree diff

**Run on:** 2026-04-14 against `master` at commit `<HEAD>`.
**Spec reference:** Section 2, probe 2.
**Purpose:** Identify `(app)/*` routes that have a matching `(dashboard)/*` route (delete candidates) versus unmatched `(app)/*` routes (migration candidate or genuine feature deletion, declared per PR).

## Commands

\`\`\`bash
find "app/src/app/[locale]/(app)" -type d
find "app/src/app/[locale]/(dashboard)" -type d
comm -12 <(...) <(...)  # overlap
\`\`\`

## Raw output

\`\`\`
<paste /tmp/probe-02-output.txt verbatim>
\`\`\`

## Classification

| `(app)/` segment | Matching `(dashboard)/` segment | Classification |
|------------------|--------------------------------|----------------|
| ai | asistent-ai | Delete candidate (renamed) |
| projects | proiecte | Delete candidate (renamed) |
| files | documente | Delete candidate (renamed) |
| settings | setari | Delete candidate (renamed) |
| calls | (none) | Migration candidate or genuine deletion — declare in Plan 2 PR |

(Fill from raw output above. Adjust if cascade already removed `(app)/` — in which case Plan 2 is a no-op and this artifact records that state.)

## Notes

- If `(app)/` is absent from master (already removed by cascade), Plan 2 closes as a no-op with this artifact as evidence.
- If `(app)/` is present, the seed list in spec Section 2 is the starting point; the rows above must reflect actual `find` output, not the spec's snapshot.
```

- [ ] **Step 3: Replace placeholders with raw output and complete the classification**

Same human-judgment step pattern as Task 2 Step 4.

- [ ] **Step 4: Verify and commit**

Run:
```bash
test -s /home/godja/Dev/EU-Funds-decom-bootstrap/docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-02-route-tree-diff.md && \
  grep -q "Raw output" /home/godja/Dev/EU-Funds-decom-bootstrap/docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-02-route-tree-diff.md && \
  cd /home/godja/Dev/EU-Funds-decom-bootstrap && \
  git add docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-02-route-tree-diff.md && \
  git -c commit.gpgsign=false commit -m "chore(decom): probe 02 — route-tree diff"
```
Expected: file passes verification, one new commit.

---

## Task 4: Probe 3 — Hook-callsite sweep

**Files:**
- Create: `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-03-hook-callsite-sweep.md`

- [ ] **Step 1: Enumerate `useOrchestrator` callers**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-bootstrap && {
  echo "## useOrchestrator import sites"
  rg -n "import.*useOrchestrator|from '@/hooks/useOrchestrator'" app/src/ || echo "(no matches)"
  echo
  echo "## useOrchestrator call sites (excluding the hook definition)"
  rg -n "useOrchestrator\(" app/src/ | rg -v "app/src/hooks/useOrchestrator" || echo "(no matches)"
  echo
  echo "## useAgent comparison (target hook callers)"
  rg -n "import.*useAgent\b|from '@/hooks/useAgent'" app/src/ || echo "(no matches)"
} > /tmp/probe-03-output.txt
cat /tmp/probe-03-output.txt
```
Expected: lists every import and call site, plus the comparison set of pages already on `useAgent`.

- [ ] **Step 2: Write the artifact**

Create `/home/godja/Dev/EU-Funds-decom-bootstrap/docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-03-hook-callsite-sweep.md` with content:

```markdown
# Probe 03 — Hook-callsite sweep

**Run on:** 2026-04-14 against `master` at commit `<HEAD>`.
**Spec reference:** Section 2, probe 3.
**Purpose:** Binary classification — every `useOrchestrator` caller is either migrated to `useAgent` or still on the bridge. No third category.

## Commands

\`\`\`bash
rg -n "import.*useOrchestrator|from '@/hooks/useOrchestrator'" app/src/
rg -n "useOrchestrator\(" app/src/ | rg -v "app/src/hooks/useOrchestrator"
rg -n "import.*useAgent\b|from '@/hooks/useAgent'" app/src/
\`\`\`

## Raw output

\`\`\`
<paste /tmp/probe-03-output.txt verbatim>
\`\`\`

## Classification

| File | Hook | Classification |
|------|------|----------------|
| <file>:<line> | `useOrchestrator` | Still on bridge — migration target for Plan 3 sub-step (a) |
| <file>:<line> | `useAgent` | Already migrated |

## Notes

- The asistent-ai page is the well-known orchestrator caller per spec Section 2; verify it appears here.
- If any unexpected file appears in the `useOrchestrator` list, flag it in Plan 3 sub-step (a) scope.
```

- [ ] **Step 3: Replace placeholders, verify, commit**

Same pattern as Task 3 Step 4. Commit message: `chore(decom): probe 03 — hook-callsite sweep`.

---

## Task 5: Probe 4 — API-route orphan probe

**Files:**
- Create: `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-04-api-route-orphan.md`

- [ ] **Step 1: Enumerate all API routes under inspection**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-bootstrap && {
  echo "## A. /api/ai/* routes"
  find app/src/app/api/ai -name "route.ts" -type f | sort
  echo
  echo "## B. /api/v1/* routes (informational, broader scope)"
  find app/src/app/api/v1 -name "route.ts" -type f | sort
} > /tmp/probe-04-routes.txt
cat /tmp/probe-04-routes.txt
```
Expected: list of every route file. Use this list to drive the per-route reference sweep.

- [ ] **Step 2: Build the per-route reference table**

For each route under `/api/ai/`, derive its URL path and grep for the path string. Run the sweep loop:

```bash
cd /home/godja/Dev/EU-Funds-decom-bootstrap && {
  echo "# Per-route reference counts"
  for route_file in $(find app/src/app/api/ai -name "route.ts" -type f); do
    # Convert filesystem path to URL path
    url=$(echo "$route_file" | sed -e 's|app/src/app||' -e 's|/route.ts||')
    echo
    echo "## Route: $url ($route_file)"
    echo "### Frontend references (app, components, hooks)"
    rg -n "\"$url\"|'$url'|\`$url\`" app/src/app app/src/components app/src/hooks 2>/dev/null || echo "(none)"
    echo "### Test references"
    rg -n "\"$url\"|'$url'|\`$url\`" app/tests app/e2e 2>/dev/null || echo "(none)"
  done
} > /tmp/probe-04-output.txt
wc -l /tmp/probe-04-output.txt
```
Expected: large file with per-route subsections. Sanity-check: at least the well-known `/api/ai/agent` and `/api/ai/orchestrator/message` routes appear.

- [ ] **Step 3: Write the artifact**

Create `/home/godja/Dev/EU-Funds-decom-bootstrap/docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-04-api-route-orphan.md`:

```markdown
# Probe 04 — API-route orphan probe

**Run on:** 2026-04-14 against `master` at commit `<HEAD>`.
**Spec reference:** Section 2, probe 4.
**Purpose:** Classify each `/api/ai/*` and `/api/v1/*` route by frontend reference count and test reference count. Zero frontend + zero non-route-test references → orphan candidate.

## Commands

(See per-loop commands above. Reproduce verbatim from `/tmp/probe-04-output.txt` generation script.)

## Per-route results

\`\`\`
<paste /tmp/probe-04-output.txt verbatim, trimmed if oversized>
\`\`\`

## Classification

| Route | Frontend refs | Test refs | Classification |
|-------|--------------|-----------|----------------|
| /api/ai/agent | <count> | <count> | Keeper (target runtime) |
| /api/ai/orchestrator/message | <count> | <count> | Migration candidate or delete |
| /api/ai/check-eligibility | <count> | <count> | Orphan candidate (probe target for Plan 4) |
| /api/ai/diagnostic | <count> | <count> | Independent sweep (Plan 5) — classify on its own evidence |
| ... | ... | ... | ... |

(Fill from raw output. One row per route. The classification rule is mechanical: zero frontend + zero non-route-test refs → orphan; non-zero refs → keeper-or-migration based on whether the surface is a target axis or legacy axis per spec Section 1.)

## Notes

- `/api/v1/*` routes are surveyed here for completeness but most are out of program scope (org/project CRUD belongs to non-program code per spec Section 7 non-criteria).
- Routes whose URLs include path parameters (`[id]`, `[sessionId]`) are matched on the static prefix only — known limitation, document any path-param routes that may be undercounted.
```

- [ ] **Step 4: Replace placeholders, verify, commit**

Pattern as before. Commit message: `chore(decom): probe 04 — API-route orphan probe`.

---

## Task 6: Probe 5 — `lib/ai/` root module reference sweep

**Files:**
- Create: `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-05-lib-ai-root-references.md`

- [ ] **Step 1: Enumerate `lib/ai/*.ts` root modules**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-bootstrap && find app/src/lib/ai -maxdepth 1 -name "*.ts" -type f | sort > /tmp/probe-05-modules.txt && cat /tmp/probe-05-modules.txt
```
Expected: list of root-level `.ts` files (excludes `agent/` and `orchestrator/` subfolders by `-maxdepth 1`).

- [ ] **Step 2: Per-module reference sweep**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-bootstrap && {
  echo "# Per-module external reference counts"
  while IFS= read -r module_file; do
    # Derive the module specifier shape used in imports
    base=$(basename "$module_file" .ts)
    echo
    echo "## Module: $module_file"
    echo "### Imports referencing @/lib/ai/$base or relative paths"
    rg -n "from ['\"]@/lib/ai/$base['\"]|from ['\"]\\./$base['\"]|from ['\"]\\.\\./ai/$base['\"]" app/src app/tests app/scripts 2>/dev/null | rg -v "^$module_file:" || echo "(none)"
  done < /tmp/probe-05-modules.txt
} > /tmp/probe-05-output.txt
wc -l /tmp/probe-05-output.txt
```
Expected: per-module subsections with reference lines or `(none)`.

- [ ] **Step 3: Write the artifact**

Create `/home/godja/Dev/EU-Funds-decom-bootstrap/docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-05-lib-ai-root-references.md`:

```markdown
# Probe 05 — `lib/ai/` root module reference sweep

**Run on:** 2026-04-14 against `master` at commit `<HEAD>`.
**Spec reference:** Section 2, probe 5.
**Purpose:** For each file at `app/src/lib/ai/*.ts` not inside `agent/` or `orchestrator/`, count external references. Zero → presumptive delete candidate. Non-zero → callers classified first.

## Commands

\`\`\`bash
find app/src/lib/ai -maxdepth 1 -name "*.ts" -type f
# Then per-module: rg "@/lib/ai/<base>" across app/src, app/tests, app/scripts
\`\`\`

## Per-module results

\`\`\`
<paste /tmp/probe-05-output.txt verbatim>
\`\`\`

## Classification

| Module | External ref count | Classification |
|--------|--------------------|----------------|
| compliance-engine.ts | <count> | <Presumptive delete / migration target> |
| compliance-validator.ts | <count> | ... |
| deadline-intelligence.ts | <count> | ... |
| document-analyzer.ts | <count> | ... |
| enhanced-proposal-generator.ts | <count> | ... |
| eu-ai-act.ts | <count> | ... |
| eu-knowledge-base.ts | <count> | ... |
| fact-checker.ts | <count> | ... |
| grant-matcher.ts | <count> | ... |
| knowledge-engine.ts | <count> | ... |
| proposal-generator.ts | <count> | ... |
| reporting-engine.ts | <count> | ... |
| risk-assessment.ts | <count> | ... |
| (any other root .ts) | <count> | ... |

Rule: count == 0 → "Presumptive delete candidate (Plan 4 deletion PR)". count > 0 → "Migration candidate (Plan 4 migration PR — classify each caller per spec Section 1 axis)".

## Notes

- `index.ts`, `config.ts`, `types.ts`, `utils.ts`, `sanitize.ts` and similarly named utility files are likely keepers; record their ref counts but do not classify them as delete unless they also appear as orphans.
- The asymmetry between "presumptive delete" and "confirmed delete" is per spec Section 1 claim discipline — this probe produces the presumption, not the warrant.
```

- [ ] **Step 4: Replace placeholders, verify, commit**

Commit message: `chore(decom): probe 05 — lib/ai/ root module reference sweep`.

---

## Task 7: Probe 6 — Design-token coexistence grep

**Files:**
- Create: `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-06-design-token-coexistence.md`

- [ ] **Step 1: Run the dual-token grep**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-bootstrap && {
  echo "## A. Files with V1 dark-glass tokens (g-card | glass-panel | #06060A | liquid-glass)"
  rg -l "g-card|glass-panel|#06060A|liquid-glass" app/src/ 2>/dev/null | sort > /tmp/probe-06-v1.txt
  cat /tmp/probe-06-v1.txt || echo "(none)"
  echo
  echo "## B. Files with V2 Stitch tokens (surface-container | #faf8fe | #0071E3)"
  rg -l "surface-container|#faf8fe|#0071E3" app/src/ 2>/dev/null | sort > /tmp/probe-06-v2.txt
  cat /tmp/probe-06-v2.txt || echo "(none)"
  echo
  echo "## C. Coexistence (intersection of A and B)"
  comm -12 /tmp/probe-06-v1.txt /tmp/probe-06-v2.txt || echo "(none)"
  echo
  echo "## D. V1-only (still on legacy)"
  comm -23 /tmp/probe-06-v1.txt /tmp/probe-06-v2.txt || echo "(none)"
  echo
  echo "## E. V2-only (already migrated)"
  comm -13 /tmp/probe-06-v1.txt /tmp/probe-06-v2.txt || echo "(none)"
} > /tmp/probe-06-output.txt
cat /tmp/probe-06-output.txt
```
Expected: five sections produced, each with a file list or `(none)`.

- [ ] **Step 2: Write the artifact**

Create `/home/godja/Dev/EU-Funds-decom-bootstrap/docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-06-design-token-coexistence.md`:

```markdown
# Probe 06 — Design-token coexistence grep

**Run on:** 2026-04-14 against `master` at commit `<HEAD>`.
**Spec reference:** Section 2, probe 6.
**Purpose:** Files matching both V1 and V2 design tokens are bridge-legacy (cannot retire until V2 visual completion finishes). Files with V1-only are pure legacy waiting on the same workstream. Files with V2-only are clean.

## Commands

\`\`\`bash
rg -l "g-card|glass-panel|#06060A|liquid-glass" app/src/
rg -l "surface-container|#faf8fe|#0071E3" app/src/
# Then comm -12, -23, -13 for intersection and disjoint sets.
\`\`\`

## Raw output

\`\`\`
<paste /tmp/probe-06-output.txt verbatim>
\`\`\`

## Classification

### Coexistence (V1 ∩ V2) — bridge legacy, retain with retention entry

| File | Notes |
|------|-------|
| <file> | Token interleave; do not retire until V2 visual completion |

### V1-only — pure legacy, blocked on same workstream

| File | Notes |
|------|-------|
| <file> | Pure dark-glass; same retention bucket |

### V2-only — clean

(Counted only; not enumerated unless useful.)

## Retention register impact

The seed retention entry "V1 dark-glass tokens" in the register file (created by Task 14) covers all files in the Coexistence and V1-only sets above. The conversion trigger is "every file in this list is off the list."
```

- [ ] **Step 3: Replace placeholders, verify, commit**

Commit message: `chore(decom): probe 06 — design-token coexistence grep`.

---

## Task 8: Probe 7 — Feature-flag reach

**Files:**
- Create: `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-07-feature-flag-reach.md`

- [ ] **Step 1: Enumerate flag keys**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-bootstrap && {
  echo "## A. Flag keys defined in lib/feature-flags/*"
  rg -n "^\s*key:|^\s*['\"]\w+['\"]:" app/src/lib/feature-flags/ 2>/dev/null || echo "(no obvious key list)"
  echo
  echo "## B. Flag keys referenced via isFeatureEnabled(...) calls"
  rg -n "isFeatureEnabled\(['\"]([^'\"]+)['\"]" app/src/ -or '$1' 2>/dev/null | sort -u || echo "(none)"
  echo
  echo "## C. Flag rows seeded in drizzle migrations (look for INSERT INTO feature_flags)"
  rg -n "INSERT INTO feature_flags|feature_flags.*VALUES" app/drizzle/ 2>/dev/null || echo "(none)"
} > /tmp/probe-07-keys.txt
cat /tmp/probe-07-keys.txt
```
Expected: produces a deduplicated list of flag keys. Flag-key inference may not be perfect — capture what the grep returns and complete by inspection if needed.

- [ ] **Step 2: Per-flag reader sweep**

For each flag key from Step 1, count readers:

```bash
cd /home/godja/Dev/EU-Funds-decom-bootstrap && {
  echo "# Per-flag reader counts"
  for flag in agent_v3_enabled managed_agent_enabled <add others discovered in Step 1>; do
    echo
    echo "## Flag: $flag"
    echo "### Readers in app/src (excluding tests)"
    rg -n "['\"]$flag['\"]" app/src/ 2>/dev/null | rg -v "/tests/" || echo "(none)"
    echo "### Readers in app/tests"
    rg -n "['\"]$flag['\"]" app/tests/ 2>/dev/null || echo "(none)"
  done
} > /tmp/probe-07-output.txt
cat /tmp/probe-07-output.txt
```
Expected: per-flag subsections.

- [ ] **Step 3: Write the artifact**

Create `/home/godja/Dev/EU-Funds-decom-bootstrap/docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-07-feature-flag-reach.md`:

```markdown
# Probe 07 — Feature-flag reach

**Run on:** 2026-04-14 against `master` at commit `<HEAD>`.
**Spec reference:** Section 2, probe 7.
**Purpose:** Flags with zero non-test readers are candidates for deletion. Flags read only by a retiring surface retire with the surface (rubric item 4).

## Commands

(See enumeration + per-flag sweep above.)

## Raw output

\`\`\`
<paste /tmp/probe-07-keys.txt and /tmp/probe-07-output.txt>
\`\`\`

## Classification

| Flag key | Non-test readers | Test readers | Classification |
|----------|------------------|--------------|----------------|
| agent_v3_enabled | <count> | <count> | Keeper (gates V3 bridge — retires with V3) |
| managed_agent_enabled | <count> | <count> | Keeper (gates Managed pilot — keeps target runtime) |
| <other> | <count> | <count> | Candidate / keeper / retire-with-surface |

## Notes

- Drizzle seed migrations (e.g., `0022_managed_agent_enabled_flag.sql`) that seed retiring flags must be deleted in the same retirement PR per rubric item 4.
- If the enumeration step missed a flag (the grep is heuristic), add it manually and re-run the per-flag sweep.
```

- [ ] **Step 4: Replace placeholders, verify, commit**

Commit message: `chore(decom): probe 07 — feature-flag reach`.

---

## Task 9: Probe 8 — Env-var reach

**Files:**
- Create: `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-08-env-var-reach.md`

- [ ] **Step 1: Enumerate env vars from declaration sources**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-bootstrap && {
  echo "## A. Vars in app/.env.example (or root .env.example)"
  rg -n "^[A-Z_]+=" app/.env.example .env.example 2>/dev/null | sed 's/=.*//' | sort -u || echo "(no .env.example found)"
  echo
  echo "## B. Vars in cloudbuild.production.yaml"
  rg -n "^_[A-Z_]+:|--set-env-vars" app/cloudbuild.production.yaml cloudbuild.production.yaml 2>/dev/null || echo "(none)"
  echo
  echo "## C. Vars referenced via process.env.X in app/src and app/scripts"
  rg -n "process\.env\.[A-Z_]+" app/src app/scripts 2>/dev/null | rg -o "process\.env\.[A-Z_]+" | sort -u || echo "(none)"
} > /tmp/probe-08-vars.txt
cat /tmp/probe-08-vars.txt
```
Expected: produces a union list of env vars.

- [ ] **Step 2: Identify unread vars (declared but not read)**

Run a set-difference comparison on the lists from Step 1, capturing into `/tmp/probe-08-output.txt`. Manual / scripted; the simplest form:

```bash
cd /home/godja/Dev/EU-Funds-decom-bootstrap && {
  declared=$(rg -n "^[A-Z_]+=" app/.env.example 2>/dev/null | sed 's/:.*=.*//' | awk -F: '{print $NF}' | sort -u)
  read=$(rg -n "process\.env\.[A-Z_]+" app/src app/scripts 2>/dev/null | rg -o "[A-Z_]+$" | sort -u)
  echo "# Declared in .env.example but never read in app/src or app/scripts"
  comm -23 <(echo "$declared") <(echo "$read") || echo "(none)"
} > /tmp/probe-08-output.txt
cat /tmp/probe-08-output.txt
```
Expected: list of declared-but-unread env vars (likely candidates).

- [ ] **Step 3: Write the artifact + verify + commit**

Use the same artifact template as previous probes. Commit message: `chore(decom): probe 08 — env-var reach`.

---

## Task 10: Probe 9 — Test-target orphan probe

**Files:**
- Create: `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-09-test-target-orphan.md`

- [ ] **Step 1: Enumerate `app/tests/**` files importing modules already flagged**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-bootstrap && {
  echo "## A. Test files importing @/lib/ai/orchestrator/*"
  rg -ln "from ['\"]@/lib/ai/orchestrator" app/tests/ 2>/dev/null || echo "(none)"
  echo
  echo "## B. Test files importing useOrchestrator"
  rg -ln "useOrchestrator" app/tests/ 2>/dev/null || echo "(none)"
  echo
  echo "## C. Test files importing legacy lib/ai root modules (cross-reference probe 05 results)"
  for mod in compliance-engine compliance-validator deadline-intelligence document-analyzer enhanced-proposal-generator eu-ai-act eu-knowledge-base fact-checker grant-matcher knowledge-engine proposal-generator reporting-engine risk-assessment; do
    files=$(rg -l "@/lib/ai/$mod" app/tests/ 2>/dev/null)
    if [ -n "$files" ]; then echo "### $mod"; echo "$files"; fi
  done
  echo
  echo "## D. e2e specs that goto a route not in the (dashboard)/ tree"
  rg -n "page\.goto\(['\"][^'\"]*['\"]" app/e2e/ 2>/dev/null | sort -u || echo "(none)"
} > /tmp/probe-09-output.txt
cat /tmp/probe-09-output.txt
```
Expected: per-section file lists. Section D produces all goto targets; manual cross-reference against the actual route tree decides which are orphan.

- [ ] **Step 2: Write the artifact + verify + commit**

Same template pattern. Commit message: `chore(decom): probe 09 — test-target orphan`.

---

## Task 11: Probe 10 — Re-export / type-dependency probe

**Files:**
- Create: `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-10-reexport-type-dependency.md`

- [ ] **Step 1: Run the type/re-export sweep**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-bootstrap && {
  echo "## A. Re-exports from @/lib/ai/orchestrator"
  rg -n "export.*from ['\"]@/lib/ai/orchestrator" app/src/ 2>/dev/null || echo "(none)"
  echo
  echo "## B. Type-only imports from orchestrator (import type)"
  rg -n "import type.*from ['\"]@/lib/ai/orchestrator" app/src/ 2>/dev/null || echo "(none)"
  echo
  echo "## C. All imports from @/lib/ai/orchestrator/types specifically"
  rg -n "from ['\"]@/lib/ai/orchestrator/types" app/src/ 2>/dev/null || echo "(none)"
  echo
  echo "## D. All imports from @/lib/ai/orchestrator/section-specs"
  rg -n "from ['\"]@/lib/ai/orchestrator/section-specs" app/src/ 2>/dev/null || echo "(none)"
  echo
  echo "## E. V3 agent code importing orchestrator (any path)"
  rg -ln "@/lib/ai/orchestrator" app/src/lib/ai/agent/ 2>/dev/null || echo "(none)"
} > /tmp/probe-10-output.txt
cat /tmp/probe-10-output.txt
```
Expected: per-pattern lists. Critical because this probe identifies the rehoming work that blocks orchestrator folder deletion.

- [ ] **Step 2: Write the artifact**

Template emphasizes the "rehome before delete" classification. Each cited file becomes a sub-task in Plan 3. Commit message: `chore(decom): probe 10 — re-export / type-dependency`.

---

## Task 12: Probe 11 — Public-surface probe

**Files:**
- Create: `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-11-public-surface.md`

- [ ] **Step 1: Enumerate every public-surface declaration**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-bootstrap && {
  echo "## A. middleware.ts publicPaths array"
  rg -n "publicPaths" app/src/middleware.ts || echo "(no publicPaths declaration)"
  echo
  echo "## B. next.config.* rewrites and redirects"
  rg -n "rewrites|redirects" app/next.config.mjs app/next.config.js 2>/dev/null || echo "(none)"
  echo
  echo "## C. sitemap.ts entries"
  cat app/src/app/sitemap.ts 2>/dev/null || echo "(no sitemap.ts)"
  echo
  echo "## D. robots.ts entries"
  cat app/src/app/robots.ts 2>/dev/null || echo "(no robots.ts)"
  echo
  echo "## E. Layout/nav config — Sidebar, MobileNav, TopNav route references"
  rg -n "/ro/|/en/|router\.push|<Link " app/src/components/layout/ 2>/dev/null || echo "(none)"
  echo
  echo "## F. i18n locale + slug map"
  cat app/src/lib/i18n.ts app/src/i18n.ts 2>/dev/null | head -50 || echo "(no i18n config)"
} > /tmp/probe-11-output.txt
cat /tmp/probe-11-output.txt
```
Expected: comprehensive snapshot of every URL-aware surface.

- [ ] **Step 2: Write the artifact + verify + commit**

Template should classify each enumerated entry by axis (route layer / runtime / capability) and flag any entry that points at a delete-candidate URL. Commit message: `chore(decom): probe 11 — public-surface probe`.

---

## Task 13: Synthesize per-track candidate lists

**Files:**
- Create: `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/track-candidates.md`

This is the central downstream contract — plans 3, 4, 5 consume this file's tables directly.

- [ ] **Step 1: Read every probe artifact**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-bootstrap && ls docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/ && cat docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-*.md | wc -l
```
Expected: 11 probe files plus README, sizable line count.

- [ ] **Step 2: Write the synthesis file**

Create `/home/godja/Dev/EU-Funds-decom-bootstrap/docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/track-candidates.md`:

```markdown
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
| <fill from probe 03 classification table> | useOrchestrator | useAgent |

### Sub-step (b): shared-type rehoming

Source: probe 10.

| Type/module to rehome | Current location | Importers (must update) | Target location |
|----------------------|------------------|------------------------|-----------------|
| <fill from probe 10> | @/lib/ai/orchestrator/types | <importer list> | <target path — name in Plan 3> |
| <fill from probe 10> | @/lib/ai/orchestrator/section-specs | <importer list> | <target path> |

### Sub-step (c): hook delete

Source: probe 03 (after sub-step (a) leaves zero importers).

- File to delete: `app/src/hooks/useOrchestrator.ts`
- Pre-delete check: re-run probe 03 to confirm zero remaining importers.

### Sub-step (d): orchestrator route deletion

Source: probe 04 + probe 11 cross-reference.

| Route file to delete | Frontend refs (must be 0) | Notes |
|---------------------|---------------------------|-------|
| <fill from probe 04> | 0 | <if non-zero, escalate to migration sub-step> |

### Sub-step (e): folder deletion

Source: probe 01 + probe 10 (after sub-steps (b)–(d) leave zero external importers).

- Directory to delete: `app/src/lib/ai/orchestrator/` (entire subtree)
- Pre-delete check: re-run probes 01 and 10.

### Sub-step (f): client-v2 sweep

Source: probe 01 part A.

- File: `app/src/lib/ai/client-v2.ts`
- Resolution: deletion if external refs == 0; migration PR if > 0.
- Cite probe 01 reference count when Plan 3 is written.

---

## Track B — Orphaned AI modules (consumed by Plan 4)

Source: probe 05.

### Confirmed delete candidates (zero external refs)

| Module | External refs | Drizzle/migration cleanup needed |
|--------|--------------|----------------------------------|
| <fill from probe 05 rows where count == 0> | 0 | <none / list> |

### Migration candidates (non-zero refs)

| Module | Importer files | Replacement target | Notes |
|--------|---------------|--------------------|-------|
| <fill from probe 05 rows where count > 0> | <list> | <Managed tool / V3 tool / keeper module> | <classification rationale> |

### Route candidates (from probe 04, scoped to Plan 4)

| Route | Frontend refs | Test refs | Classification |
|-------|--------------|-----------|----------------|
| /api/ai/check-eligibility | <count> | <count> | <delete / migrate> |
| /api/ai/generate-insights | <count> | <count> | <delete / migrate> |
| /api/ai/generate-proposal | <count> | <count> | <delete / migrate> |
| /api/ai/generate-proposal-enhanced | <count> | <count> | <delete / migrate> |
| /api/ai/generate-report | <count> | <count> | <delete / migrate> |
| /api/ai/ghid-to-tasks | <count> | <count> | <delete / migrate> |
| /api/ai/match-grants | <count> | <count> | <delete / migrate> |
| /api/ai/search-calls | <count> | <count> | <delete / migrate> |

---

## Track C — Diagnostic sweep (consumed by Plan 5)

Source: probe 04 (single-route slice).

- Route: `app/src/app/api/ai/diagnostic/route.ts`
- Frontend refs: <count from probe 04>
- Test refs: <count from probe 04>
- Classification: independent — does not import orchestrator (per spec Section 2). Plan 5 evaluates against its own evidence.
- Decision rule: ref count == 0 → delete; ref count > 0 → keep with rationale documented (it may be ops-only, called via curl/Cloud Monitoring, never frontend).

---

## Cross-cutting — Cleanup carried in retirement PRs

Per rubric items 4 and 7, the following ride along with whichever PR retires their owning surface. These tables are populated from probes 07 and 08.

### Feature flags retiring with surfaces

| Flag | Owning surface (retires with) |
|------|------------------------------|
| <from probe 07 classification rows marked "retire-with-surface"> | <surface> |

### Env vars retiring with surfaces

| Env var | Owning surface |
|---------|----------------|
| <from probe 08 unread-vars list> | <surface> |

### Tests retiring with surfaces

| Test file | Owning surface |
|-----------|----------------|
| <from probe 09 sections A, B, C> | <surface> |

---

## Bridge legacy — handed to retention register, not to plans 3/4/5

These are listed for inventory completeness. The retention register file is the authoritative record.

- V1 dark-glass token files: see probe 06 sections C and D. Retention entry "V1 dark-glass tokens" covers them.
- V3 runtime modules: not surfaced by these probes (V3 is the keeper for write paths). Retention entry "V3 runtime" covers them.
```

- [ ] **Step 3: Fill all `<fill from probe ...>` placeholders by reading the probe artifacts**

Open each probe artifact, copy classified rows into the matching synthesis tables. Every placeholder must be replaced with concrete data; no `<fill>` survives this step.

- [ ] **Step 4: Verify zero placeholders remain**

Run:
```bash
grep -c "<fill" /home/godja/Dev/EU-Funds-decom-bootstrap/docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/track-candidates.md
```
Expected: `0`.

- [ ] **Step 5: Commit**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-bootstrap && git add docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/track-candidates.md && git -c commit.gpgsign=false commit -m "chore(decom): synthesize per-track candidate lists

Downstream contract for plans 3 (orchestrator), 4 (orphaned AI), 5 (diagnostic).
Synthesized from probes 01-11."
```

---

## Task 14: Create retention register file

**Files:**
- Create: `docs/superpowers/legacy-retention-register.md`

- [ ] **Step 1: Write the register with seed entries**

Create `/home/godja/Dev/EU-Funds-decom-bootstrap/docs/superpowers/legacy-retention-register.md`:

```markdown
# Legacy Retention Register

**Authority:** `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md` Section 6.
**Created:** 2026-04-14 by plan `2026-04-14-decom-program-bootstrap.md`.
**Maintenance:** entries with `last_verified` older than 60 days become presumptively invalid and must be re-justified before the next decommission PR touching that axis lands.

## Schema

Each entry has:

- `surface` — short name and reference (file glob, module path, or token-set name)
- `axis` — one of: route / visual / runtime / capability
- `category` — `bridge-legacy` (waiting on external workstream) or `temporary-retention` (blocker internal to an active retirement track)
- `blocking_workstream` — the replacement program this retention waits on
- `replacement_spec` — URL or path to the spec scoping the workstream, or `none` (with note)
- `conversion_trigger` — the concrete observable event that converts surface from bridge to delete candidate
- `last_verified` — ISO date

---

## Bridge-legacy entries

### V1 dark-glass tokens

- **surface:** files matching `g-card | glass-panel | #06060A | liquid-glass` (see `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-06-design-token-coexistence.md` sections C and D)
- **axis:** visual
- **category:** bridge-legacy
- **blocking_workstream:** V2 visual completion
- **replacement_spec:** none (not yet written as of 2026-04-14)
- **conversion_trigger:** every file in probe-06 sections C and D is off the list
- **last_verified:** 2026-04-14

### V3 runtime

- **surface:** `app/src/lib/ai/agent/runtime.ts`, `app/src/lib/ai/agent/tools/*`, `app/src/lib/ai/agent/policies.ts`, `app/src/lib/ai/agent/transitions.ts`, `app/src/hooks/useAgent.ts`, `app/src/app/api/ai/agent/route.ts`
- **axis:** runtime
- **category:** bridge-legacy
- **blocking_workstream:** Managed Agents Phase 3
- **replacement_spec:** referenced in `docs/superpowers/specs/2026-04-09-managed-agents-architecture.md` Section 5 (Phase 3 not yet scoped in a standalone spec)
- **conversion_trigger:** Managed write tools land, `agent_v3_enabled=false` holds for one release with circuit breaker closed
- **last_verified:** 2026-04-14

---

## Temporary retention entries during active retirement

### Orchestrator-owned shared types

- **surface:** modules under `app/src/lib/ai/orchestrator/` re-exported as types/helpers (see `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-10-reexport-type-dependency.md`)
- **axis:** runtime
- **category:** temporary-retention
- **blocking_workstream:** internal — Plan 3 (`2026-04-14-decom-orchestrator-retirement.md`, deferred), sub-step (b) shared-type rehoming
- **replacement_spec:** `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md` (this program)
- **conversion_trigger:** last external import of `@/lib/ai/orchestrator/types` and `@/lib/ai/orchestrator/section-specs` removed (probe 10 returns zero)
- **last_verified:** 2026-04-14

---

## Adding new entries

Any retirement PR that produces a "needs to be retained for reason X" finding adds an entry here. The PR description must cite the entry. If the finding has no entry and no proposal to add one, the surface is a delete candidate by default per spec Section 6.
```

- [ ] **Step 2: Verify and commit**

Run:
```bash
test -s /home/godja/Dev/EU-Funds-decom-bootstrap/docs/superpowers/legacy-retention-register.md && \
  grep -q "Bridge-legacy entries" /home/godja/Dev/EU-Funds-decom-bootstrap/docs/superpowers/legacy-retention-register.md && \
  grep -q "Temporary retention entries" /home/godja/Dev/EU-Funds-decom-bootstrap/docs/superpowers/legacy-retention-register.md && \
  cd /home/godja/Dev/EU-Funds-decom-bootstrap && \
  git add docs/superpowers/legacy-retention-register.md && \
  git -c commit.gpgsign=false commit -m "chore(decom): create retention register with seed entries

V1 dark-glass tokens, V3 runtime (bridge-legacy);
orchestrator-owned shared types (temporary retention).
Per spec 2026-04-11-legacy-decommissioning-design.md Section 6."
```
Expected: file passes both grep checks, one new commit.

---

## Task 15: Final README update — lock in commit SHA and downstream contract paths

**Files:**
- Modify: `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/README.md`

- [ ] **Step 1: Capture the current HEAD SHA**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-bootstrap && git rev-parse HEAD
```
Expected: 7-char or full SHA. Record it for the next step.

- [ ] **Step 2: Edit README to fill in the validity SHA**

Open the README and replace `<filled in at Task 16>` with the SHA from Step 1. The line should now read e.g. `**Validity:** snapshot of master at commit abc1234, run on 2026-04-14.`

- [ ] **Step 3: Append a "Downstream contract paths (locked)" section to the README**

Append this section verbatim:

```markdown
## Downstream contract paths (locked)

Plans 3, 4, 5 consume the artifacts at these exact paths. Path drift between this commit and the deferred-plan writing session breaks the contract — re-run this plan whole rather than rebasing artifact paths.

- `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-NN-*.md` — 11 probe artifacts
- `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/track-candidates.md` — synthesized per-track candidate lists
- `docs/superpowers/legacy-retention-register.md` — retention register
```

- [ ] **Step 4: Verify and commit**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-bootstrap && \
  grep -q "Downstream contract paths (locked)" docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/README.md && \
  ! grep -q "<filled in at Task 16>" docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/README.md && \
  git add docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/README.md && \
  git -c commit.gpgsign=false commit -m "chore(decom): lock README with validity SHA and downstream contract paths"
```
Expected: README contains the new section, no placeholder remaining, one new commit.

---

## Task 16: Open PR for the bootstrap branch

**Files:** none modified — branch ready for PR.

- [ ] **Step 1: Push branch to origin**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-bootstrap && git push -u origin chore/decom-program-bootstrap
```
Expected: branch pushed, upstream tracking set.

- [ ] **Step 2: Open PR via gh**

Run:
```bash
gh pr create --title "chore(decom): probe outputs + retention register bootstrap" --body "$(cat <<'EOF'
## Summary

Bootstrap artifacts for the legacy decommissioning program (spec `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md`).

- Runs all 11 Section 2 probes against post-cascade master, captures outputs as tracked artifacts under \`docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/\`.
- Synthesizes per-track candidate lists in \`track-candidates.md\` — the downstream contract for plans 3, 4, 5.
- Creates the retention register at \`docs/superpowers/legacy-retention-register.md\` with three seed entries (V1 dark-glass, V3 runtime, orchestrator-owned shared types).
- No application code modified.

## Test plan

- [ ] Spot-check 3 random probe artifacts: each has a non-empty Raw output section and a populated Classification section.
- [ ] \`grep -c "<fill" docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/track-candidates.md\` returns 0.
- [ ] Retention register has all three seed entries with all six required fields.
- [ ] README validity SHA matches \`HEAD~N\` for the synthesis commits.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Expected: PR created, URL printed.

- [ ] **Step 3: Confirm CI passes under the gating policy established by the companion spec's rollout**

Wait for CI on the PR. The bootstrap touches only docs and adds no application code, so quality + security-gates + build-and-test should pass trivially.

- [ ] **Step 4: Merge once approved**

Merge via squash or merge commit per repo convention. After merge, the artifacts live on master and plans 3, 4, 5 can be written by the next writing-plans session.

---

## Self-review checklist

After all tasks complete, verify before considering the plan done:

- [ ] All 11 probe artifacts exist on master with non-empty Raw output and populated Classification sections.
- [ ] `track-candidates.md` exists with zero `<fill...>` placeholders.
- [ ] Retention register exists with three seed entries, each with all six required fields.
- [ ] README validity SHA points at a commit in this PR.
- [ ] No file under `app/src/`, `app/tests/`, `app/e2e/`, or any CI workflow was modified by this PR.
- [ ] PR landed; downstream contract paths are stable on master.

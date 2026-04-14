# PR #1 Bundle — Reference Sweep (Pre-delete)

Plan: `docs/superpowers/plans/2026-04-14-decom-orphaned-ai-modules.md` — PR #1.
Base: `origin/master` @ `1097c1f`.
Branch: `chore/decom-orphan-bundle1`.

## 1. Route URL sweep

Scope: `app/src`, `app/tests`, `app/e2e`, `app/scripts`, `docs`.

```
## /api/ai/generate-proposal-enhanced
docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/track-candidates.md:101:| `/api/ai/generate-proposal-enhanced` | 0 | 0 | Delete candidate |
docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-04-api-route-orphan.md:213:| `/api/ai/generate-proposal-enhanced` | 0 | 0 | Orphan candidate |
docs/superpowers/plans/2026-04-14-decom-orphaned-ai-modules.md:148:- `/api/ai/generate-proposal-enhanced` (→ `app/src/app/api/ai/generate-proposal-enhanced/route.ts`)
docs/superpowers/plans/2026-04-14-decom-orphaned-ai-modules.md:155:- `enhanced-proposal-generator.ts` — imported only by `/api/ai/generate-proposal-enhanced`; will be 0-ref after its route is deleted.
docs/superpowers/plans/2026-04-14-decom-orphaned-ai-modules.md:466:- `/api/ai/generate-proposal-enhanced`

## /api/ai/generate-report
(only docs: probe-04, track-candidates, plan)

## /api/ai/ghid-to-tasks
(only docs: probe-04, track-candidates, plan)

## /api/ai/search-calls
(only docs: probe-04, track-candidates, plan)
```

**Verdict:** zero frontend refs, zero test refs, zero script refs for all four routes. The only hits are the probe/plan/track-candidates docs that catalog these routes as orphans — self-referential. Bootstrap probe 04 confirmed.

## 2. Four-part helper sweep (pre-delete)

| Helper | Direct `@/lib/ai/<mod>` | Relative `./<mod>` in lib/ai/ | Barrel re-export in index.ts |
|---|---|---|---|
| `enhanced-proposal-generator` | 1 (only route being deleted) | 1 (index.ts only) | 1 (line 8) |
| `reporting-engine` | 1 (only route being deleted) | 1 (index.ts only) | 1 (line 18) |
| `fact-checker` | 2 (generate-proposal-enhanced + generate-proposal) | 0 | (not re-exported) |
| `eu-knowledge-base` | 1 (generate-insights) | 3 (enhanced-proposal-generator, knowledge-engine, fact-checker) + index.ts | 1 (line 17) |

Raw output archived under `/tmp/orphan-pr1-helper-refs.txt` during sweep.

## 3. Barrel consumer sweep (per symbol, via `@/lib/ai`)

Pattern: `import .*\bSYMBOL\b.* from ['"]@/lib/ai['"]` across `app/src`, `app/tests`, `app/scripts`.

### enhanced-proposal-generator symbols
| Symbol | Barrel consumers |
|---|---|
| `generateEnhancedProposal` | 0 |
| `EnhancedProposalInput` | 0 |
| `EUProposal` | 0 |
| `EnhancedProposalOutput` | 0 |

### reporting-engine symbols
| Symbol | Barrel consumers |
|---|---|
| `generateReport` | 0 |
| `quickReportSummary` | 0 |
| `ReportGeneration` | 0 |
| `ReportInput` | 0 |
| `FinancialReport` | 0 |
| `ProgressReport` | 0 |
| `RiskReport` | 0 |
| `PartnerReport` | 0 |
| `ComplianceReport` | 0 |

### eu-knowledge-base symbols
| Symbol | Barrel consumers |
|---|---|
| `EU_PROGRAMS` | 0 |
| `getProgramInfo` | 0 |
| `getEvaluationCriteria` | 0 |
| `getBudgetCategories` | 0 |
| `getProposalSections` | 0 |
| `getRomanianAdvantages` | 0 |
| `findBestProgram` | 0 |
| `EUProgramKey` | 0 |

### fact-checker
Not re-exported through the barrel — skipped. Direct-path consumers documented above.

## 4. Expected post-delete helper classification

After deleting the 4 routes (Task 1.2):

| Helper | Direct path (post) | Relative (post) | Barrel re-export (post, before index.ts edit) | Barrel consumers | Disposition in PR #1 |
|---|---|---|---|---|---|
| `enhanced-proposal-generator` | 0 | 1 (index.ts self-ref) | 1 | 0 | **DELETE** (remove index.ts line 8 + rm file, one commit) |
| `reporting-engine` | 0 | 1 (index.ts self-ref) | 1 | 0 | **DELETE** (remove index.ts line 18 + rm file, one commit) |
| `fact-checker` | 1 (generate-proposal still uses it) | 0 | 0 | 0 | **LEAVE** — retires in PR #4 with /api/ai/generate-proposal |
| `eu-knowledge-base` | 1 (generate-insights) | 3 (enhanced-proposal-generator deleted; still knowledge-engine + fact-checker) | 1 | 0 | **LEAVE** — transitive consumers remain |

**Classification rule applied:** a helper is a PR-#1 delete candidate only when, after route deletions, (direct path == 0) AND (relative inside lib/ai == only the barrel self-ref) AND (barrel consumers per symbol == 0 for every exported symbol). Both `enhanced-proposal-generator` and `reporting-engine` meet all three.

Note on eu-knowledge-base relative count: `enhanced-proposal-generator.ts` will be deleted in this PR, so its `./eu-knowledge-base` import goes away, but `knowledge-engine.ts` and `fact-checker.ts` remain.

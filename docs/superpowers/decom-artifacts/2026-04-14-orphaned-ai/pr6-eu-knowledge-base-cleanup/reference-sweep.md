# Reference sweep — `eu-knowledge-base.ts` cleanup

Pre-retirement reference sweep confirming zero external consumers remain after PRs #1, #3, #4 retired all direct/transitive importers.

## Probe 1 — Direct-path imports (`@/lib/ai/eu-knowledge-base`)

Command:
```
rg -n "from ['\"]@/lib/ai/eu-knowledge-base" app/src app/tests app/scripts
```

Result: **0 matches**.

## Probe 2 — Relative importers inside `lib/ai/`

Command:
```
rg -n "from ['\"]\./eu-knowledge-base" app/src/lib/ai
```

Result: **1 match** — only `app/src/lib/ai/index.ts:14` (the barrel re-export itself). No other relative importer.

## Probe 3 — Barrel consumers of the 8 re-exported symbols

Symbols: `EU_PROGRAMS`, `getProgramInfo`, `getEvaluationCriteria`, `getBudgetCategories`, `getProposalSections`, `getRomanianAdvantages`, `findBestProgram`, `EUProgramKey`.

Command:
```
rg -n "EU_PROGRAMS|getProgramInfo|getEvaluationCriteria|getBudgetCategories|getProposalSections|getRomanianAdvantages|findBestProgram|EUProgramKey" app/src app/tests app/scripts
```

Result: matches only inside `eu-knowledge-base.ts` itself (definitions) and the single barrel re-export line in `lib/ai/index.ts:14`. **Zero external consumers** across all 8 symbols.

## Probe 4 — CLAUDE.md / docs

Command:
```
rg -n "eu-knowledge-base" CLAUDE.md
```

Result: **0 matches**. No stale references in project instructions.

## Conclusion

The module is fully orphaned. Retirement removes the file and the single barrel line — no consumer migration required.

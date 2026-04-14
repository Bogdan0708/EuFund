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

```bash
git worktree add -b chore/decom-bootstrap-replay <path> origin/master
cd <path>
# Run each probe's commands per its artifact file, capture output, regenerate.
```

## Validity windows

Per spec Section 6, retention register entries older than 60 days without a `last_verified` update become presumptively invalid. These probe outputs follow the same convention: if more than 60 days elapse before plans 3, 4, 5 are written, re-run this plan whole rather than consuming stale outputs.

# Probe 02 — Route-tree diff

**Run on:** 2026-04-14 against `master` at commit `1040228`.
**Spec reference:** Section 2, probe 2.
**Purpose:** Identify `(app)/*` routes that have a matching `(dashboard)/*` route (delete candidates) versus unmatched `(app)/*` routes (migration candidate or genuine feature deletion, declared per PR).

## Commands

```bash
find "app/src/app/[locale]/(app)" -type d
find "app/src/app/[locale]/(dashboard)" -type d
comm -12 <(...) <(...)  # overlap
```

## Raw output

```text
## A. (app)/ subtree (English-named legacy)

## B. (dashboard)/ subtree (Romanian-named target)
app/src/app/[locale]/(dashboard)
app/src/app/[locale]/(dashboard)/asistent-ai
app/src/app/[locale]/(dashboard)/asistent-ai/components
app/src/app/[locale]/(dashboard)/documente
app/src/app/[locale]/(dashboard)/panou
app/src/app/[locale]/(dashboard)/proiecte
app/src/app/[locale]/(dashboard)/proiecte/[id]
app/src/app/[locale]/(dashboard)/proiecte/[id]/components
app/src/app/[locale]/(dashboard)/proiecte/[id]/sectiuni
app/src/app/[locale]/(dashboard)/proiecte/[id]/sectiuni/[sectionId]
app/src/app/[locale]/(dashboard)/proiecte/nou
app/src/app/[locale]/(dashboard)/setari

## C. Diff (segment-name overlap)
```

## Classification

| `(app)/` segment | Matching `(dashboard)/` segment | Classification |
|------------------|--------------------------------|----------------|
| `(entire subtree absent on current master)` | `(dashboard)/*` only | Plan 2 is a no-op on current `master`; the English route layer has already been removed |

## Notes

- This probe closed the route-deletion question mechanically: there is no surviving `app/src/app/[locale]/(app)` subtree to delete.
- Future route-surface cleanup is still possible, but it is public-surface cleanup, not `(app)` subtree removal.

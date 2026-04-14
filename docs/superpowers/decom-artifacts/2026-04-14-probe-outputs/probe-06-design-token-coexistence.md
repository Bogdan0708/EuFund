# Probe 06 — Design-token coexistence grep

**Run on:** 2026-04-14 against `master` at commit `1040228`.
**Spec reference:** Section 2, probe 6.
**Purpose:** Files matching both V1 and V2 design tokens are bridge-legacy (cannot retire until V2 visual completion finishes). Files with V1-only are pure legacy waiting on the same workstream. Files with V2-only are clean.

## Commands

```bash
rg -l "g-card|glass-panel|#06060A|liquid-glass" app/src/
rg -l "surface-container|#faf8fe|#0071E3" app/src/
comm -12 /tmp/probe-06-v1.txt /tmp/probe-06-v2.txt
comm -23 /tmp/probe-06-v1.txt /tmp/probe-06-v2.txt
comm -13 /tmp/probe-06-v1.txt /tmp/probe-06-v2.txt
```

## Raw output

```text
## A. Files with V1 dark-glass tokens (g-card | glass-panel | #06060A | liquid-glass)
app/src/components/ui/breadcrumbs.tsx
app/src/components/ui/card.tsx
app/src/components/ui/page-header.tsx
app/src/components/ui/toast-stack.tsx

## B. Files with V2 Stitch tokens (surface-container | #faf8fe | #0071E3)
app/src/app/[locale]/(auth)/autentificare/page.tsx
app/src/app/[locale]/(auth)/bun-venit/page.tsx
app/src/app/[locale]/(auth)/interese/page.tsx
app/src/app/[locale]/(dashboard)/asistent-ai/components/CanvasTabs.tsx
app/src/app/[locale]/(dashboard)/asistent-ai/components/CheckpointRenderers.tsx
app/src/app/[locale]/(dashboard)/asistent-ai/components/ProposalTab.tsx
app/src/app/[locale]/(dashboard)/asistent-ai/components/StepProgressBar.tsx
app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx
app/src/app/[locale]/(dashboard)/documente/page.tsx
app/src/app/[locale]/(dashboard)/panou/page.tsx
app/src/app/[locale]/(dashboard)/proiecte/[id]/components/SectionsTabContent.tsx
app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx
app/src/app/[locale]/(dashboard)/proiecte/[id]/sectiuni/[sectionId]/page.tsx
app/src/app/[locale]/(dashboard)/proiecte/page.tsx
app/src/app/[locale]/(dashboard)/setari/page.tsx
app/src/components/editor/section-editor.tsx
app/src/components/files/UploadZone.tsx
app/src/components/landing/ProjectsPreview.tsx
app/src/components/layout/CommandPalette.tsx
app/src/components/layout/HelpPanel.tsx
app/src/components/layout/LocaleSwitcher.tsx
app/src/components/layout/MobileNav.tsx
app/src/components/layout/NotificationsPanel.tsx
app/src/components/layout/Sidebar.tsx
app/src/components/layout/SidebarItem.tsx
app/src/components/layout/TopNav.tsx
app/src/components/projects/ProjectGrid.tsx
app/src/components/settings/AIPreferencesCard.tsx
app/src/components/ui/LiveBackground.tsx
app/src/components/ui/ds-button.tsx
app/src/components/ui/ds-card.tsx
app/src/components/ui/ds-chip.tsx
app/src/components/ui/ds-input.tsx
app/src/components/ui/markdown-render.tsx
app/src/components/ui/section-state-badge.tsx
app/src/components/workspace/ChatPanel.tsx
app/src/components/workspace/MessageBubble.tsx
app/src/styles/tokens.css

## C. Coexistence (intersection of A and B)

## D. V1-only (still on legacy)
app/src/components/ui/breadcrumbs.tsx
app/src/components/ui/card.tsx
app/src/components/ui/page-header.tsx
app/src/components/ui/toast-stack.tsx

## E. V2-only (already migrated)
app/src/app/[locale]/(auth)/autentificare/page.tsx
app/src/app/[locale]/(auth)/bun-venit/page.tsx
app/src/app/[locale]/(auth)/interese/page.tsx
app/src/app/[locale]/(dashboard)/asistent-ai/components/CanvasTabs.tsx
app/src/app/[locale]/(dashboard)/asistent-ai/components/CheckpointRenderers.tsx
app/src/app/[locale]/(dashboard)/asistent-ai/components/ProposalTab.tsx
app/src/app/[locale]/(dashboard)/asistent-ai/components/StepProgressBar.tsx
app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx
app/src/app/[locale]/(dashboard)/documente/page.tsx
app/src/app/[locale]/(dashboard)/panou/page.tsx
app/src/app/[locale]/(dashboard)/proiecte/[id]/components/SectionsTabContent.tsx
app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx
app/src/app/[locale]/(dashboard)/proiecte/[id]/sectiuni/[sectionId]/page.tsx
app/src/app/[locale]/(dashboard)/proiecte/page.tsx
app/src/app/[locale]/(dashboard)/setari/page.tsx
app/src/components/editor/section-editor.tsx
app/src/components/files/UploadZone.tsx
app/src/components/landing/ProjectsPreview.tsx
app/src/components/layout/CommandPalette.tsx
app/src/components/layout/HelpPanel.tsx
app/src/components/layout/LocaleSwitcher.tsx
app/src/components/layout/MobileNav.tsx
app/src/components/layout/NotificationsPanel.tsx
app/src/components/layout/Sidebar.tsx
app/src/components/layout/SidebarItem.tsx
app/src/components/layout/TopNav.tsx
app/src/components/projects/ProjectGrid.tsx
app/src/components/settings/AIPreferencesCard.tsx
app/src/components/ui/LiveBackground.tsx
app/src/components/ui/ds-button.tsx
app/src/components/ui/ds-card.tsx
app/src/components/ui/ds-chip.tsx
app/src/components/ui/ds-input.tsx
app/src/components/ui/markdown-render.tsx
app/src/components/ui/section-state-badge.tsx
app/src/components/workspace/ChatPanel.tsx
app/src/components/workspace/MessageBubble.tsx
app/src/styles/tokens.css
```

## Classification

### Coexistence (V1 ∩ V2) — bridge legacy, retain with retention entry

No files matched both token families on current `master`.

### V1-only — pure legacy, blocked on same workstream

| File | Notes |
|------|-------|
| `app/src/components/ui/breadcrumbs.tsx` | Pure dark-glass token usage |
| `app/src/components/ui/card.tsx` | Pure dark-glass token usage |
| `app/src/components/ui/page-header.tsx` | Pure dark-glass token usage |
| `app/src/components/ui/toast-stack.tsx` | Pure dark-glass token usage |

### V2-only — clean

`38` files matched V2 tokens without V1 overlap; these are already on the keeper visual system.

## Retention register impact

The seed retention entry `V1 dark-glass tokens` covers the four V1-only files above. Because the coexistence set is empty, the register is carrying pure residual V1 surface rather than mixed-token bridge files.

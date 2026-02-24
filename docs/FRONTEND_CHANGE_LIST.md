# Frontend Change List

## Updated Files
- `app/src/app/globals.css`
- `app/src/app/[locale]/(dashboard)/layout.tsx`
- `app/src/app/[locale]/(dashboard)/panou/page.tsx`
- `app/src/app/[locale]/(dashboard)/proiecte/page.tsx`
- `app/src/app/[locale]/(dashboard)/finantari/live/page.tsx`
- `app/src/app/[locale]/(dashboard)/documente/incarca/page.tsx`
- `app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx`
- `app/src/app/[locale]/(dashboard)/proiecte/[id]/reports/page.tsx`
- `app/src/components/ai/DocumentUpload.tsx`

## Added Files
- `app/src/components/ui/status-badge.tsx`
- `app/src/components/ui/page-states.tsx`
- `app/src/components/ui/page-header.tsx`
- `app/src/components/ui/breadcrumbs.tsx`
- `app/src/components/ui/toast-stack.tsx`
- `app/src/app/[locale]/(dashboard)/audit/page.tsx`
- `app/src/app/[locale]/(dashboard)/aprobari/page.tsx`
- `app/src/app/[locale]/(dashboard)/setari/page.tsx`
- `docs/FRONTEND_UPGRADE_PLAN.md`
- `docs/FRONTEND_QA_CHECKLIST.md`

## Functional Changes
- Introduced role-aware navigation with responsive sidebar.
- Added global search in shell (projects + key shortcuts).
- Added consistent breadcrumbs and page header pattern.
- Added reusable status badges with consistent definitions.
- Added reusable loading/empty/error states.
- Redesigned dashboard with KPI cards, status chart, action list, and activity feed.
- Redesigned calls and applications lists with sticky header tables, filters, and quick actions.
- Redesigned project overview with lifecycle stepper, milestones snapshot, and budget summary.
- Reworked evidence upload flow with drag-drop, validation, upload progress, document list, tags, and linkage.
- Implemented report wizard flow with section steps, inline validation, autosave draft, review screen, and submit notifications.
- Added Approvals, Audit Log, and Settings pages to complete the new IA.

# Frontend Upgrade Plan

## 1) Discovery Summary

### Stack and entrypoints
- Framework: Next.js 14 (`app/` router), React 18, TypeScript.
- Styling/UI: Tailwind CSS + custom `components/ui` (button, input, table, tabs, badge, card).
- Routing shell: `app/src/app/[locale]/(dashboard)/layout.tsx`.
- App root: `app/src/app/layout.tsx` and locale root `app/src/app/[locale]/layout.tsx`.

### Existing architecture
- Auth/session: `next-auth` credentials flow (`app/src/lib/auth/index.ts`) with JWT strategy.
- Roles/permissions: `admin`, `org_admin`, `project_manager`, `viewer` (`app/src/lib/auth/helpers.ts`, `app/src/lib/db/schema.ts`).
- i18n: `next-intl` with `ro` and `en` message bundles.
- State/data fetching: mostly local page state + `fetch` calls to API routes.

### Data and contracts used
- Projects list/detail: `/api/v1/projects`, `/api/v1/projects/[id]`.
- Work packages/timeline: `/api/v1/projects/[id]/work-packages`, `/api/v1/projects/[id]/timeline`.
- Funding calls: `/api/integrations/funding-calls`.
- Upload documents: `/api/documents/upload`.

### Primary user journeys mapped
1. Dashboard -> calls/projects/documents overview.
2. Browse calls & applications -> filter/search and quick actions.
3. Project setup -> overview, lifecycle, milestones, work packages.
4. Budget/costs -> budget snapshots and risk cues.
5. Reporting -> step-based report completion and submit.
6. Review/approval -> approvals queue.
7. Audit/compliance -> audit trail visibility and source-of-truth cues.

### Top UX pain points found in prior code
- Sidebar/nav mixed emojis with weak IA and no role-aware item gating.
- No consistent breadcrumbs/page header pattern.
- Tables had inconsistent filtering/searching and no sticky header pattern.
- Empty/loading/error states varied by page and often lacked retry/context.
- Dashboard metrics/actionability were limited.
- Documents upload lacked evidence linkage and missing-evidence callouts.
- Reporting was not stepwise and lacked autosave + clear section validation.

## 2) IA Changes

New dashboard IA:
- Dashboard
- Calls & Applications
- Projects
- Tasks & Milestones
- Budget & Costs
- Reports
- Documents
- Approvals (role-aware: admin/org_admin)
- Audit Log
- Settings

Added global breadcrumbs and standardized page headers.

## 3) Design Tokens Summary

Updated in `app/src/app/globals.css`:
- Revised core colors for enterprise contrast (`primary`, `muted`, `accent`, `destructive`).
- Added semantic tokens: `success`, `warning`, `info`.
- Increased base radius (`--radius: 0.75rem`) and stronger focus ring behavior.
- Typography uses Geist variable stack for consistency.
- Added subtle multi-layer background gradients for platform identity.

## 4) Component Inventory (new/updated)

Added shared components:
- `status-badge.tsx`: unified status visuals + tooltip descriptions.
- `page-states.tsx`: loading/error/empty state primitives.
- `page-header.tsx`: consistent page title/subtitle/action shell.
- `breadcrumbs.tsx`: route-based breadcrumbs.
- `toast-stack.tsx`: lightweight notification toasts.

Updated shell:
- `app/src/app/[locale]/(dashboard)/layout.tsx`: role-aware nav, global search, responsive sidebar, breadcrumbs.

## 5) Page Prioritization and Why

1. Dashboard (`panou`) - highest visibility and decision-making impact.
2. Project Overview (`proiecte/[id]`) - central execution workflow.
3. Calls & Applications (`proiecte`, `finantari/live`) - intake and pipeline quality.
4. Documents (`documente/incarca`) - compliance and evidence reliability.
5. Reports (`proiecte/[id]/reports`) - regulatory submission quality and completion.

## 6) Implementation Notes

- No backend contract changes were introduced.
- Existing API endpoints and auth patterns were preserved.
- New pages (`audit`, `aprobari`, `setari`) were added without changing existing contracts.

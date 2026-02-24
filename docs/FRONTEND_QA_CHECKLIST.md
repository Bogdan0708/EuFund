# QA Checklist

## 1) Smoke Flows

- [ ] Dashboard loads KPIs, chart, actions, and recent activity without console errors.
- [ ] Calls page loads and filters by status (`open`, `forthcoming`, `all`).
- [ ] Applications page supports search, saved filters, column visibility, pagination.
- [ ] Project overview loads lifecycle, budget summary, milestones, tabs.
- [ ] Work package status updates (`complete`, `delay`) refresh correctly.
- [ ] Documents upload accepts valid files and rejects invalid/oversized files.
- [ ] Uploaded evidence appears in list with status/tags/linking metadata.
- [ ] Reports wizard allows step navigation, validates required fields, saves draft.
- [ ] Report review step shows section summaries and supports submit action.

## 2) Accessibility Checks

- [ ] Keyboard-only navigation works for sidebar, top search, tabs, and form controls.
- [ ] Visible focus ring appears on interactive elements.
- [ ] Icon-only controls have `aria-label` where needed.
- [ ] Status badges and banner messages are readable with sufficient contrast.
- [ ] Toasts are announced via `aria-live` region.

## 3) Responsive Checks

- [ ] Sidebar collapses correctly on small screens and can be toggled.
- [ ] Tables remain usable with horizontal scroll on mobile.
- [ ] Dashboard cards stack cleanly on smaller viewports.
- [ ] Forms in documents and reports remain usable on narrow widths.

## 4) Error/Empty/Loading Checks

- [ ] Loading states appear while API requests are in-flight.
- [ ] Error states provide clear message + retry where applicable.
- [ ] Empty states show contextual action guidance.
- [ ] Network failures do not break page shell/navigation context.

## 5) Contract & Security Checks

- [ ] Existing API endpoints still called with expected payloads.
- [ ] No auth flow changes introduced.
- [ ] No backend schema/API contract modifications required.
